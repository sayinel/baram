// §close-guard: Unsaved-changes guard for app close (red X) / quit (Cmd+Q, Quit menu).
// Rust intercepts the close/quit and emits `app://close-requested`; the frontend
// decides whether to quit immediately (no dirty file tabs) or prompt the user.
// The same save helpers back the single-tab close confirmation (see TabBar).
import { useEffect } from "react";

import { listen } from "@tauri-apps/api/event";

import type { EditorTab } from "../stores/editor/editor";

import { confirmQuit, updateFileIndex, writeFile } from "../ipc/invoke";
import { isFileTab, useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { useFileStore } from "../stores/file/file";
import { useUIStore } from "../stores/ui/ui";
import { isMarkdownFile } from "../utils/file-type";
import { basename } from "../utils/path-utils";

/**
 * Deps required to save the active tab (its content lives in the live editor).
 *
 * ‼️ `handleSave` 하나뿐이다. 예전에는 `editor`/`isSourceMode`/`sourceContentRef`도 받았지만
 * 이 파일도 UnsavedChangesModal도 그 셋을 **한 번도 읽지 않았다** — 활성 탭 저장을 통째로
 * `handleSave`에 위임하기 때문이다. §287에서 소스 버퍼가 탭별로 바뀌면서 드러났다.
 */
export interface CloseGuardDeps {
  handleSave: () => Promise<void>;
}

/**
 * §close-guard: Persist every dirty file tab so the app can safely quit.
 * Saves the active tab first (flush its live editor), then the rest.
 * @returns `true` when all dirty tabs were saved (safe to quit), `false` when
 *   the user aborted a Save As dialog (stay open, changes preserved).
 */
export async function saveAllDirtyForQuit({
  handleSave,
}: CloseGuardDeps): Promise<boolean> {
  const { activeTabId, tabs } = useEditorStore.getState();
  const dirty = tabs.filter((t) => t.isDirty && isFileTab(t));
  // Active tab first so its live editor content is flushed before the others.
  const ordered = [
    ...dirty.filter((t) => t.id === activeTabId),
    ...dirty.filter((t) => t.id !== activeTabId),
  ];
  for (const tab of ordered) {
    const ok = await saveDirtyTab(tab, activeTabId, handleSave);
    if (!ok) return false;
  }
  return true;
}

/**
 * §close-guard: Persist a single dirty tab.
 * - Active tab → `handleSave` (covers source mode, code files, Untitled Save As).
 * - Other file tab → write its cached `openFiles` content directly.
 * - Other Untitled tab → prompt for a destination path (Save As).
 * @returns `false` when an Untitled Save As was cancelled (caller must NOT
 *   close/quit); `true` otherwise.
 *
 * Known limitation (v1): a non-active tab backed by the large-doc keep-alive
 * editor pool has its latest edits in that pool, not in `openFiles`, so this
 * writes the last-synced content for such tabs.
 */
export async function saveDirtyTab(
  tab: EditorTab,
  activeTabId: null | string,
  handleSave: () => Promise<void>,
): Promise<boolean> {
  // Active tab — flush the live editor via the shared save path.
  if (tab.id === activeTabId) {
    await handleSave();
    // A still-dirty active tab means an Untitled Save As was cancelled.
    const after = useEditorStore.getState().tabs.find((t) => t.id === tab.id);
    return !after?.isDirty;
  }

  // Non-active file tab — write the cached content.
  if (tab.filePath) {
    const content = useFileStore.getState().openFiles.get(tab.filePath) ?? "";
    await writeFile(tab.filePath, content);
    useFileStore.getState().updateLastSaveMtime(tab.filePath, Date.now());
    useEditorStore.getState().markDirty(tab.id, false);
    if (isMarkdownFile(tab.filePath)) {
      updateFileIndex(tab.filePath)
        .then(() => useLinkStore.getState().invalidate())
        .catch(() => {});
    }
    return true;
  }

  // Non-active Untitled tab — prompt for a destination path.
  const { save } = await import("@tauri-apps/plugin-dialog");
  const savePath = await save({
    filters: [
      { name: "Markdown", extensions: ["md"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (!savePath) return false;

  const content = useFileStore.getState().openFiles.get(tab.id) ?? "";
  await writeFile(savePath, content);
  useFileStore.getState().updateLastSaveMtime(savePath, Date.now());
  useEditorStore.setState((state) => ({
    tabs: state.tabs.map((t) =>
      t.id === tab.id
        ? {
            ...t,
            filePath: savePath,
            isDirty: false,
            title: basename(savePath),
          }
        : t,
    ),
  }));
  useFileStore.getState().setFileContent(savePath, content);
  if (isMarkdownFile(savePath)) {
    updateFileIndex(savePath)
      .then(() => useLinkStore.getState().invalidate())
      .catch(() => {});
  }
  return true;
}

/**
 * §close-guard §479: View > Reload / CmdOrCtrl+R. Reload discards the whole
 * window (no tab state survives `window.location.reload()` — `editor.ts` has
 * no persist middleware), so it checks every tab exactly like quit rather
 * than just the active one. No dirty tab → reload immediately; otherwise
 * open the shared modal (intent "reload") so the user can save first.
 */
export function requestReload(): void {
  const { tabs } = useEditorStore.getState();
  const dirty = tabs.filter((t) => t.isDirty && isFileTab(t));
  if (dirty.length === 0) {
    window.location.reload();
    return;
  }
  useUIStore.getState().openUnsavedModal({ intent: "reload" });
}

/**
 * §81 File > Close Workspace. It closes every tab and drops every context, so —
 * like reload — it answers for ALL dirty tabs, not just the active one. Nothing
 * dirty → close straight away; otherwise open the shared modal so the user can
 * save first. Before this, `closeAllTabs()` discarded unsaved tabs silently.
 *
 * ‼️ Shares one blind spot with quit and reload: a markdown tab in source mode
 * deliberately does not raise `isDirty` (see `components/tasks/use-archive-done.ts`),
 * so unsaved source-buffer text does not trip this prompt. Widening the predicate
 * HERE alone would make the "Save & Close" button lie — `saveDirtyTab` writes the
 * cached `openFiles` content for a non-active tab, which is not what that buffer
 * holds. One gap, shared by three paths; it closes in the save path, not here.
 */
export function requestCloseWorkspace(): void {
  const { tabs } = useEditorStore.getState();
  const dirty = tabs.filter((t) => t.isDirty && isFileTab(t));
  if (dirty.length === 0) {
    useFileStore.getState().closeFolder();
    return;
  }
  useUIStore.getState().openUnsavedModal({ intent: "closeWorkspace" });
}

/**
 * §close-guard: Listen for the Rust close/quit interception. If no file tab is
 * dirty, confirm the quit immediately; otherwise open the shared modal.
 */
export function useCloseGuard(): void {
  useEffect(() => {
    const unlisten = listen<void>("app://close-requested", () => {
      void (async () => {
        const { tabs } = useEditorStore.getState();
        const dirty = tabs.filter((t) => t.isDirty && isFileTab(t));
        if (dirty.length === 0) {
          await confirmQuit();
          return;
        }
        useUIStore.getState().openUnsavedModal({ intent: "quit" });
      })();
    });

    return () => {
      unlisten.then((f) => f()).catch(() => {});
    };
  }, []);
}

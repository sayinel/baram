// §close-guard: Unsaved-changes guard for app close (red X) / quit (Cmd+Q, Quit menu).
// Rust intercepts the close/quit and emits `app://close-requested`; the frontend
// decides whether to quit immediately (no dirty file tabs) or prompt the user.
// The same save helpers back the single-tab close confirmation (see TabBar).
import { useEffect } from "react";

import { listen } from "@tauri-apps/api/event";

import type { EditorTab } from "../stores/editor/editor";

import { confirmQuit, updateFileIndex, writeFile } from "../ipc/invoke";
import { closeContexts } from "../services/close-context";
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
 * §82 Does this tab hold work that is not on disk?
 *
 * ‼️ `isDirty` alone misses markdown typed in SOURCE MODE. That path deliberately
 * does not raise dirty (`tab-surface-renderers.tsx` — `use-auto-save` is the single
 * owner of markdown dirty), so a tab holding unsaved text looked clean to every close
 * guard and its buffer went out silently with `closeTab`.
 *
 * ‼️ Deliberately NOT `sourceModeTabs`. That set means "this tab is showing source",
 * which is true after zero keystrokes — a guard built on it prompts on every quit with
 * a source tab merely open. `sourceEditedTabs` is only set when CodeMirror reports a
 * real user edit.
 */
export function isTabUnsaved(
  tab: EditorTab,
  sourceEditedTabs: readonly string[],
): boolean {
  return isFileTab(tab) && (tab.isDirty || sourceEditedTabs.includes(tab.id));
}

/** The open tabs holding unsaved work, optionally narrowed by `match`. */
function unsavedTabs(match: (tab: EditorTab) => boolean = () => true) {
  const { sourceEditedTabs, tabs } = useEditorStore.getState();
  return tabs.filter((t) => isTabUnsaved(t, sourceEditedTabs) && match(t));
}

/**
 * §close-guard: Persist every dirty file tab so the app can safely quit.
 * Saves the active tab first (flush its live editor), then the rest.
 * @returns `true` when all dirty tabs were saved (safe to quit), `false` when
 *   the user aborted a Save As dialog (stay open, changes preserved).
 */
export async function saveAllDirtyForQuit(
  deps: CloseGuardDeps,
): Promise<boolean> {
  return saveDirtyTabsWhere(() => true, deps);
}

/**
 * §82 Persist every dirty file tab belonging to the given contexts — the scoped
 * variant `closeContexts` needs. Saving ALL dirty tabs there would write files the
 * user never asked to touch: closing one folder must not save another's edits.
 * @returns `false` when an Untitled Save As was aborted (caller must NOT close).
 */
export async function saveDirtyTabsForContexts(
  contextIds: readonly string[],
  deps: CloseGuardDeps,
): Promise<boolean> {
  const wanted = new Set(contextIds);
  return saveDirtyTabsWhere((t) => wanted.has(t.contextId), deps);
}

/**
 * The shared body of the two save-many helpers: dirty file tabs matching `match`,
 * active one first so its live editor is flushed before the cached-content writes.
 */
async function saveDirtyTabsWhere(
  match: (tab: EditorTab) => boolean,
  { handleSave }: CloseGuardDeps,
): Promise<boolean> {
  const { activeTabId } = useEditorStore.getState();
  const dirty = unsavedTabs(match);
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
    const saved = !after?.isDirty;
    // `handleSave` reads the source buffer for a source-mode tab, so a clean result
    // means that buffer reached disk.
    if (saved) useEditorStore.getState().markSourceEdited(tab.id, false);
    return saved;
  }

  // Non-active file tab — write the cached content.
  if (tab.filePath) {
    // ‼️ §82 A tab edited in source mode holds its text in the source buffer, NOT in
    // `openFiles`. Writing the cache here would save the pre-edit content and then
    // report success — the silent loss this guard exists to stop, dressed up as a
    // save. `sourceBufferAccess` is registered for the app's lifetime and keyed by
    // tab id, so it answers for background tabs too.
    const { sourceBufferAccess, sourceEditedTabs } = useEditorStore.getState();
    const fromBuffer =
      sourceBufferAccess !== null && sourceEditedTabs.includes(tab.id);
    const content = fromBuffer
      ? sourceBufferAccess.getSourceBuffer(tab.id)
      : (useFileStore.getState().openFiles.get(tab.filePath) ?? "");
    await writeFile(tab.filePath, content);
    useFileStore.getState().updateLastSaveMtime(tab.filePath, Date.now());
    // Keep the cache in step with what just went to disk, so a later read of
    // `openFiles` does not hand back the pre-edit text.
    if (fromBuffer)
      useFileStore.getState().setFileContent(tab.filePath, content);
    useEditorStore.getState().markDirty(tab.id, false);
    useEditorStore.getState().markSourceEdited(tab.id, false);
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
  if (unsavedTabs().length === 0) {
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
  if (unsavedTabs().length === 0) {
    useFileStore.getState().closeFolder();
    return;
  }
  useUIStore.getState().openUnsavedModal({ intent: "closeWorkspace" });
}

/**
 * §82 Closing contexts. Nothing dirty in them → close; otherwise open the shared
 * modal, once, scoped to exactly those contexts.
 *
 * ‼️ Four user-reachable "close this folder" actions had three implementations
 * between them: the tab's x, its context menu's Close and Close Others, and
 * Settings > Vault's remove. None asked about unsaved work. Two also skipped the
 * active/last-context handling entirely, so closing the last context from the
 * context menu reproduced the empty-workspace surface that §81 fixed on the
 * File-menu path. All four enter here now — a guard on one button leaves the other
 * three doors open. (Two further removals stay outside on purpose because they are
 * not a close: the Folder<->Vault convert and §335's revoke — see close-context.ts.)
 *
 * ‼️ The prompt comes BEFORE the close, not after: once a context is removed there
 * is nothing for Cancel to put back.
 */
export async function requestCloseContexts(
  contextIds: readonly string[],
): Promise<void> {
  if (contextIds.length === 0) return;
  const wanted = new Set(contextIds);
  if (unsavedTabs((t) => wanted.has(t.contextId)).length === 0) {
    await closeContexts(contextIds);
    return;
  }
  useUIStore
    .getState()
    .openUnsavedModal({ contextIds: [...contextIds], intent: "closeContext" });
}

/**
 * §close-guard: Listen for the Rust close/quit interception. If no file tab is
 * dirty, confirm the quit immediately; otherwise open the shared modal.
 */
export function useCloseGuard(): void {
  useEffect(() => {
    const unlisten = listen<void>("app://close-requested", () => {
      void (async () => {
        if (unsavedTabs().length === 0) {
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

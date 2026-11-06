// §close-guard: Unsaved-changes guard for app close (red X) / quit (Cmd+Q, Quit menu).
// Rust intercepts the close/quit and emits `app://close-requested`; the frontend
// decides whether to quit immediately (no dirty file tabs) or prompt the user.
// The same save helpers back the single-tab close confirmation (see TabBar).
import { useEffect } from "react";

import { listen } from "@tauri-apps/api/event";

import type { EditorTab } from "../stores/editor/editor";

import { updateFileIndex, writeFile } from "../ipc/invoke";
import { quitApp, reloadWindow } from "../services/app-exit";
import { closeContexts } from "../services/close-context";
import { useContextStore } from "../stores/context/context";
import { isTabUnsaved, useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { useFileStore } from "../stores/file/file";
import { useUIStore } from "../stores/ui/ui";
import { awaitBlockIdRenames } from "../utils/editor/block-id-rename-landing";
import {
  serializeEditorState,
  serializeLiveDoc,
} from "../utils/editor/serialize-live-doc";
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
 * §82 Whether closing these contexts takes every tab with it, not only their own: closing the last
 * one ends in `closeFolder` (`services/close-context.ts`), and a tab opened with no context active
 * belongs to none, which is how an untitled tab can escape the question.
 */
export function closesEveryTab(contextIds: readonly string[]): boolean {
  return useContextStore
    .getState()
    .contexts.every((c) => contextIds.includes(c.id));
}

/**
 * The text a background tab holds, or `null` if nothing here holds it any more.
 * - In source mode, or edited there: the source buffer, which `sourceBufferAccess` answers for any
 *   tab. A task write raises `isDirty` on a source-mode tab, so the edited mark alone misses it.
 * - In the keep-alive pool: the pool's own editor, unless the pool never finished filling it, or
 *   the file changed underneath it and its document is not to be trusted (`staleContentTabs`).
 * - Otherwise `openFiles`, where the tab's text is kept while it is away (`save-outgoing-tab.ts`).
 * - A file deleted on disk loses that entry, while the state kept for coming back to the tab still
 *   has its text. With neither, writing `""` would report an empty file as saved.
 */
function backgroundText(tab: EditorTab): null | string {
  const {
    documentSurfaceAccess,
    sourceBufferAccess,
    sourceEditedTabs,
    sourceModeTabs,
    staleContentTabs,
  } = useEditorStore.getState();
  if (
    sourceBufferAccess !== null &&
    (sourceEditedTabs.includes(tab.id) || sourceModeTabs.includes(tab.id))
  ) {
    return sourceBufferAccess.getSourceBuffer(tab.id);
  }
  const pooled = documentSurfaceAccess?.keepaliveEditor(tab.id);
  if (
    pooled &&
    documentSurfaceAccess?.isKeepaliveComplete(tab.id) &&
    !staleContentTabs.includes(tab.id)
  ) {
    return serializeLiveDoc(pooled);
  }
  const kept = useFileStore.getState().openFiles.get(tab.filePath || tab.id);
  if (kept !== undefined) return kept;
  const state = documentSurfaceAccess?.editorStateCache.get(tab.id);
  return state ? serializeEditorState(state) : null;
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
 *   one was not — see `saveDirtyTab` (stay open, changes preserved).
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
 * @returns `false` when a tab was not saved — see `saveDirtyTab` (caller must NOT close).
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
 * - Other file tab → write the text it holds (`backgroundText`) directly.
 * - Other Untitled tab → prompt for a destination path (Save As).
 * @returns `false` when the active tab is still unsaved after `handleSave`, a non-active tab's text
 *   could not be found, or a non-active Untitled tab's Save As was cancelled (the caller must not
 *   close or quit); `true` otherwise.
 */
export async function saveDirtyTab(
  tab: EditorTab,
  activeTabId: null | string,
  handleSave: () => Promise<void>,
): Promise<boolean> {
  // Active tab — flush the live editor via the shared save path.
  if (tab.id === activeTabId) {
    await handleSave();
    // A still-unsaved active tab was not saved, or not all of it — `handleSave` resolves either
    // way. An Untitled Save As was cancelled, the save gave up or failed, or (§392 D15 · D17)
    // the text changed during the write — an editable viewer's change, or typing in a code
    // tab — and the save left the tab dirty. Each must stop the quit or the close: the tab
    // holds text that is not on disk.
    //
    // ‼️ `isTabUnsaved`, not `isDirty`: an edit made in source mode never raises `isDirty`, so
    // that alone reads every failure above as saved for such a tab. `handleSave` lowers the
    // source-edited mark once its write has succeeded.
    const { sourceEditedTabs, tabs } = useEditorStore.getState();
    return !isTabUnsaved(
      tabs.find((t) => t.id === tab.id),
      sourceEditedTabs,
    );
  }

  // Non-active file tab — write the cached content.
  if (tab.filePath) {
    // issue 594: a block ID rename of this tab still in flight lands in its
    // cached content a moment from now; write after it, not before.
    await awaitBlockIdRenames(tab.id);
    // ‼️ §82 A tab edited in source mode holds its text in the source buffer, NOT in
    // `openFiles`. Writing the cache here would save the pre-edit content and then
    // report success — the silent loss this guard exists to stop, dressed up as a
    // save.
    const content = backgroundText(tab);
    if (content === null) return false;
    await writeFile(tab.filePath, content);
    useFileStore.getState().updateLastSaveMtime(tab.filePath, Date.now());
    // Keep the cache in step with what just went to disk, so a later read of
    // `openFiles` does not hand back the pre-edit text.
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

  // Read after the dialog, which can stay open for as long as the user likes.
  const content = backgroundText(tab);
  if (content === null) return false;
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
  useEditorStore.getState().markSourceEdited(tab.id, false);
  useFileStore.getState().removeFileContent(tab.id);
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
export async function requestReload(): Promise<void> {
  // issue 594: same barrier as quit — a block ID rename still in flight
  // marks its tab dirty only once it lands.
  await awaitBlockIdRenames();
  if (unsavedTabs().length === 0) {
    await reloadWindow();
    return;
  }
  useUIStore.getState().openUnsavedModal({ intent: "reload" });
}

/**
 * §81 File > Close Workspace. It closes every tab and drops every context, so —
 * like reload — it answers for ALL dirty tabs, not just the active one. Nothing
 * dirty → close straight away; otherwise open the shared modal so the user can
 * save first. Before this, `closeAllTabs()` discarded unsaved tabs silently.
 */
export async function requestCloseWorkspace(): Promise<void> {
  // issue 594: same barrier as quit and reload.
  await awaitBlockIdRenames();
  if (unsavedTabs().length === 0) {
    useFileStore.getState().closeFolder();
    return;
  }
  useUIStore.getState().openUnsavedModal({ intent: "closeWorkspace" });
}

/**
 * §82 Closing contexts. Nothing dirty in them → close; otherwise open the shared
 * modal, once, scoped to exactly those contexts, or to every tab if they are the last
 * (`closesEveryTab`).
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
  // issue 594: a block ID rename still in flight marks its tab dirty when it
  // lands; decide "nothing unsaved" only after it has.
  await awaitBlockIdRenames();
  const everyTab = closesEveryTab(contextIds);
  if (unsavedTabs((t) => everyTab || wanted.has(t.contextId)).length === 0) {
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
        // issue 594: a block ID rename still in flight lands — and marks its
        // tab dirty — a moment from now; quitting before it would leave the
        // other files renamed and this document not.
        await awaitBlockIdRenames();
        if (unsavedTabs().length === 0) {
          await quitApp();
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

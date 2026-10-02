// §89 Open a file by absolute path — shared by the file-op hook, the "+" menu,
// and recent-item reopening. Throws on failure so callers can self-heal; a refused
// context switch (§81) resolves "refused" instead, since nothing is broken.
import { readFile } from "../ipc/fs";
import { switchContext } from "../services/vault-context-loader";
import { useContextStore } from "../stores/context/context";
import {
  contextSwitchNeeded,
  isFileTab,
  useEditorStore,
} from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { dropPendingScroll } from "./editor/pending-scroll";
import { isBinaryViewerFile } from "./file-type";
import { basename } from "./path-utils";

/**
 * Open `filePath` in a tab, or select the tab already showing it.
 *
 * Resolves "opened" when the file is on screen, and "refused" when it would have
 * meant switching to a context and that switch was refused (§333: the approval
 * dialog was declined, or the root no longer resolves). `switchContext` has told
 * the user why, so a refusal is not a failure: nothing is read, nothing is shown,
 * a scroll target set up for this open is dropped, and callers must not treat it
 * as "not found". Any other failure throws.
 */
export async function openFileByPath(
  filePath: string,
): Promise<"opened" | "refused"> {
  const { tabs } = useEditorStore.getState();
  const existing = tabs.find((t) => t.filePath === filePath);
  if (existing) {
    // §81 Switch first and wait for it, so `setActiveTab` finds the seat already
    // there instead of starting its own switch that nobody waits for — and, when
    // the switch was refused, select nothing: `setActiveTab` would start the
    // same switch again and the same approval dialog with it.
    if (
      isFileTab(existing) &&
      contextSwitchNeeded(existing.contextId) &&
      !(await switchForOpen(existing.contextId))
    ) {
      dropPendingScroll(filePath);
      return "refused";
    }
    useEditorStore.getState().setActiveTab(existing.id);
    return "opened";
  }

  // §89 Ensure a context exists (vault/folder for internal, FileContext for
  // external) BEFORE readFile so the Rust check_vault guard passes.
  const context = await useContextStore.getState().ensureFileContext(filePath);

  // §89 A standalone external file gets its own FileContext. Make it the active
  // context so the sidebar (which follows the active context's rootPath) hides
  // for the single-file focus view; clicking a Vault Tab reactivates that vault
  // and restores its file tree.
  //
  // §81 A file that lives in a vault or folder resolves to that context here, and
  // the app switches to it by the rule a selected tab follows
  // (`contextSwitchNeeded`) — not at all for the context already on screen. Before,
  // it never switched: a file of another vault opened as the active tab in front of
  // the previous vault's tree. Switching BEFORE the read also lets a context the
  // launch skipped (§334, not approved yet) ask for approval first.
  if (context.contextType === "file") {
    await switchContext(context.id);
  } else if (
    contextSwitchNeeded(context.id) &&
    !(await switchForOpen(context.id))
  ) {
    // Refused: reading now would hit a root Rust refuses — or, for a context
    // nested in the one on screen, succeed through the parent and show the
    // refused context's tab in front of the parent's tree.
    dropPendingScroll(filePath);
    return "refused";
  }

  // PDFs/images are binary — never read through the UTF-8 IPC; viewers load
  // them via the asset: protocol. Cache "" so tab switching treats the tab
  // as loaded.
  const content = isBinaryViewerFile(filePath) ? "" : await readFile(filePath);
  const fileName = basename(filePath);

  useFileStore.getState().setFileContent(filePath, content);
  useEditorStore.getState().openTab({
    contextId: context.id,
    id: crypto.randomUUID(),
    filePath,
    title: fileName,
    isDirty: false,
    isPinned: false,
  });
  useSettingsStore.getState().addRecentFile(filePath);
  useSettingsStore.getState().setLastOpenedFile(filePath);
  return "opened";
}

/**
 * §81 Switch to `contextId` for an open, and say whether the seat got there. A
 * refused switch returns normally with the seat put back (§333), so the rule is
 * asked again. A context no longer in the store is not a refusal — `switchContext`
 * ignores it, as `setActiveTab` always has, and the open goes ahead.
 *
 * ‼️ A tree that fails to load is not a refusal either. `_loadContextFileTree`
 * reports it (toast, load error) and rethrows with the seat already moved — the
 * state a tab-bar click leaves — and one unreadable subfolder is enough to fail
 * the whole recursive listing. The file can still be read, so the open goes on.
 * Only that throw is taken: the seat on the context and the load error naming its
 * root. Any other throw is passed on — not known to be reported, nor the seat to
 * have moved.
 */
async function switchForOpen(contextId: string): Promise<boolean> {
  try {
    await switchContext(contextId);
  } catch (err) {
    if (!treeLoadFailed(contextId)) throw err;
  }
  return (
    !contextSwitchNeeded(contextId) ||
    !useContextStore.getState().contexts.some((c) => c.id === contextId)
  );
}

/** The switch to `contextId` reached its tree load, and that load failed. */
function treeLoadFailed(contextId: string): boolean {
  const { activeContextId, contexts } = useContextStore.getState();
  const ctx = contexts.find((c) => c.id === contextId);
  return (
    !!ctx &&
    activeContextId === contextId &&
    useFileStore.getState().loadError?.path === ctx.path
  );
}

// §82 Closing contexts — the single implementation behind the context tab's x, its
// context menu's Close and Close Others, and Settings > Vault's remove.
//
// ‼️ This was written three ways across those four entry points and they had drifted:
// only the tab bar closed the context's editor tabs, and only two of them handled the
// active-or-last context at all. A tab left behind names a context that no longer
// exists — `stores/editor/editor.ts` calls it an invisible orphan — and a removal that
// skips the active-context handling strands the app on the empty-workspace surface
// that §81 fixed on the File-menu path.
//
// ‼️ Two more removals deliberately do NOT come through here, because they are not
// "close this folder": Settings > Vault's Folder<->Vault convert (removes and re-adds
// under a new id) and §335's approved-root revoke (a security action that must proceed
// whether or not the user likes it). Both have their own gaps; see dev/backlog.md.
import { useContextStore } from "../stores/context/context";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { useWorkspaceStore } from "../stores/file/workspace";
import { switchContext } from "./vault-context-loader";

/**
 * Close one context. Thin wrapper over `closeContexts` so a single-id caller reads
 * naturally; the ordering guarantees live there.
 *
 * ‼️ Discards unsaved work in that context's tabs. Reach it through
 * `requestCloseContexts` (`hooks/use-close-guard.ts`) from anything a user can click;
 * that guard is what asks first. This is the "user already answered" half.
 */
export async function closeContext(contextId: string): Promise<void> {
  await closeContexts([contextId]);
}

/**
 * Close several contexts: their tabs, the contexts, then ONE resolution of what to
 * show next.
 *
 * ‼️ Deliberately not a loop of independent closes. `removeContext` hands
 * `activeContextId` to the next survivor, so closing N one at a time and switching
 * after each would load — and, per §334, pop an approval dialog for — a vault that the
 * very next iteration closes. That is the same "intermediate states nobody asked for"
 * trap `contextStore.clearAllContexts` was written to avoid. Tabs go first (while the
 * ids still resolve), then every removal, then a single switch or workspace clear.
 */
export async function closeContexts(
  contextIds: readonly string[],
): Promise<void> {
  const store = useContextStore.getState();
  // Drop ids that no longer exist. The modal can be answered long after it opened,
  // and a stale id would otherwise spend a `removeContext` no-op state transition and
  // report an `undefined` vaultType that silently skips the space revert below.
  const live = new Set(store.contexts.map((c) => c.id));
  const ids = contextIds.filter((id) => live.has(id));
  if (ids.length === 0) return;

  const wanted = new Set(ids);
  // Read the vault types BEFORE removal — `removeContext` drops them from state.
  const closedVaultTypes = store.contexts
    .filter((c) => wanted.has(c.id))
    .map((c) => c.vaultType);
  const closingActive =
    store.activeContextId !== null && wanted.has(store.activeContextId);

  useEditorStore.getState().closeTabsForContexts(wanted);

  for (const id of ids) {
    // Per-item tolerance: one failed removal must not strand the rest half-closed,
    // with their tabs already gone. The previous "Close Others" had the same
    // `.catch(() => {})` for the same reason.
    try {
      await useContextStore.getState().removeContext(id);
    } catch {
      /* already logged by the store; keep closing the others */
    }
  }

  if (closingActive) {
    const newActive = useContextStore.getState().activeContextId;
    if (newActive) {
      await switchContext(newActive);
    } else {
      // Nothing left to show — clear everything and land on the home screen.
      useFileStore.getState().closeFolder();
    }
  }

  // §82 Revert to Writing if a closed context backed the current space. After
  // `switchContext`, so the file tree stays loaded.
  for (const vaultType of closedVaultTypes) {
    useWorkspaceStore.getState().revertSpaceIfContextClosed(vaultType);
  }
}

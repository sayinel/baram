// issue 598 — what the rest of the app does when a space's directory setting
// moves. The context store decides THAT the journal or zettelkasten space
// moved (`ensureSpaceContext`: the new directory is registered, the old one is
// still held) and delegates the consequences here: the old registration is
// retired, its open tabs are re-homed, the space tab is pinned back to the
// front, and the view switches the way the tab bar does (or, when nothing is
// switching, the new directory's link index is rebuilt).
//
// Here the editor store and the loader are ordinary imports. The context store
// reaches this module by dynamic import — the way `editor.ts` and `file.ts`
// reach `switchContext` — so no static cycle forms.
import type { ContextInfo, VaultType } from "../ipc/types";

import { type Locale, t } from "../i18n";
import { useContextStore } from "../stores/context/context";
import { SpaceDirectoryTakenError } from "../stores/context/errors";
import { useEditorStore } from "../stores/editor/editor";
import { useSettingsStore } from "../stores/settings/store";
import { useUIStore } from "../stores/ui/ui";
import { logger } from "../utils/logger";
import {
  refreshInactiveContextIndex,
  switchContext,
} from "./vault-context-loader";

interface RetireMovedSpaceOptions {
  /** Whether the caller asked for the space to become active. */
  activate: boolean;
  vaultType: VaultType;
}

/**
 * Tell the user why a space's directory setting did not take effect. Returns
 * whether `err` was that refusal; any other error is the caller's to report.
 */
export function reportSpaceDirectoryTaken(err: unknown): boolean {
  if (!(err instanceof SpaceDirectoryTakenError)) return false;
  const { locale } = useSettingsStore.getState();
  const key =
    err.vaultType === "journal"
      ? "space.journal.directoryTaken"
      : "space.zettel.directoryTaken";
  useUIStore
    .getState()
    .showToast(
      t(key, locale as Locale, { dir: err.dir, label: err.takenBy.label }),
      "error",
    );
  return true;
}

/**
 * Retire `existing`, the space context at the directory the setting moved
 * away from, now that `created` is registered at the new one.
 */
export async function retireMovedSpaceContext(
  existing: ContextInfo,
  created: ContextInfo,
  { activate, vaultType }: RetireMovedSpaceOptions,
): Promise<void> {
  const wasActive = useContextStore.getState().activeContextId === existing.id;
  await useContextStore.getState().removeContext(existing.id);

  // §85/§93 The space tabs sit in front. `addContext` pinned nothing when the
  // new directory was registered — the old context still sat in front, so the
  // order looked right and the new one stayed where it was appended. Pin now
  // that the old one is gone, or the space's tab lands at the end of the bar
  // and stays there across restarts (the order is persisted).
  useContextStore.getState().pinSpaceTabs();

  if (wasActive || activate) {
    // Retiring the old context handed the active seat to whichever context
    // came next — `file.ts` mirrors that into `rootPath` at once — and, in
    // Rust, cleared or moved the vault root. Switch the way the tab bar does,
    // BEFORE the tabs are re-homed below, so the seat, Rust's root, the tree
    // and the link index point at the new directory rather than at some
    // unrelated vault for the duration of that loop. A local activation
    // alone would have left Rust's root and the tree on the old directory.
    // The move itself is complete by now; a failed tree load is reported,
    // not thrown, as the tab bar treats it.
    try {
      await switchContext(created.id);
    } catch (err) {
      logger.warn("[space] switch after the directory move failed:", err);
    }
  } else {
    // Not switching: nothing else builds the new directory's link index
    // (issue 263, as the Folder↔Vault convert of an inactive tab).
    refreshInactiveContextIndex(
      created.path,
      "issue 598 retireMovedSpaceContext",
    );
  }

  // The tabs that belonged to the retired context keep working: a file under
  // the OLD directory is now outside every context, so each such tab gets a
  // FileContext of its own (§89 — as a file opened from outside a vault
  // would), and any other tab of the space follows the space. Without this
  // every open tab of the old directory points at an id nothing resolves:
  // selecting it switches to nothing, closing by context misses it, and
  // saving is refused as outside every context. Homes are resolved first
  // and the tabs moved in one transition, not one per tab.
  const homes = new Map<string, string>();
  for (const tab of useEditorStore.getState().tabs) {
    if (tab.contextId !== existing.id || !tab.filePath) continue;
    try {
      const home = await useContextStore
        .getState()
        .ensureFileContext(tab.filePath);
      homes.set(tab.id, home.id);
    } catch (err) {
      // The backend refuses a home for a file that no longer exists (deleted
      // or moved outside the app since the tab opened). The old context is
      // already gone, so stopping here would leave this and every later tab
      // holding an id nothing resolves, for good. This tab follows the space
      // with the others below instead; a save is then refused as outside the
      // space, which at least names the problem.
      logger.warn(
        `[space] no context for ${tab.filePath}; the tab follows the ${vaultType} space`,
        err,
      );
    }
  }
  useEditorStore.getState().setTabContexts(homes);
  useEditorStore.getState().rekeyTabsContext(existing.id, created.id);
}

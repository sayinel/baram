// §82 Switching an open context between Folder and Vault.
//
// ‼️ Extracted from `VaultTab` because the two directions were written twice and
// differed only in one IPC call — and both were missing the same thing.
import type { ContextInfo } from "../ipc/types";

import { initVault, setVaultConfigByPath } from "../ipc/context";
import { useContextStore } from "../stores/context/context";
import { useEditorStore } from "../stores/editor/editor";
import {
  refreshInactiveContextIndex,
  switchContext,
} from "./vault-context-loader";

/**
 * Convert `ctx` to the other type, in place as far as the user is concerned.
 *
 * ‼️ There is no backend "change the type", so this removes the context and adds it
 * back — and `addContext` mints a NEW id. Every editor tab carries the id of the
 * context it belongs to, so the re-key below is not housekeeping: without it, one
 * click on Convert silently orphans every open tab of that folder. `setActiveTab`
 * then asks `switchContext` for an id nothing resolves, and `closeContexts` can no
 * longer find those tabs to close.
 */
export async function convertContextType(ctx: ContextInfo): Promise<void> {
  const toVault = ctx.contextType === "folder";
  const wasActive = useContextStore.getState().activeContextId === ctx.id;

  // Write the on-disk marker first: if this fails, the context is left untouched
  // rather than removed and re-added as a type its directory does not back up.
  if (toVault) await initVault(ctx.path, ctx.label);
  else await setVaultConfigByPath(ctx.path, {});

  await useContextStore.getState().removeContext(ctx.id);
  const added = await useContextStore
    .getState()
    .addContext(toVault ? "vault" : "folder", ctx.path, {
      color: ctx.color,
      label: ctx.label,
      ...(toVault ? { alias: ctx.label } : {}),
    });

  useEditorStore.getState().rekeyTabsContext(ctx.id, added.id);

  if (wasActive) {
    // `switchContext` rebuilds the index itself, through `_loadContextFileTree`.
    await switchContext(added.id);
    return;
  }

  // issue 263: an INACTIVE context comes back with an empty link-index slot
  // that nobody fills (see `refreshInactiveContextIndex`). `added.path`, not
  // `ctx.path`: `add_context` dedups by CANONICAL path and can hand back an
  // entry registered under a different spelling (or the enclosing vault).
  // Refreshing a root Rust does not know publishes a subtree-only scan under
  // whatever context does contain it.
  refreshInactiveContextIndex(added.path, "§82 convertContextType");
}

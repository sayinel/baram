// §393 — "this context's files changed", for BOTH tiers (spec 0072 §6, D11).
//
// The shape of `settings-change-notifier.ts`: WHO may be told (`files` or `files:readonly`, not
// `events` — the capability of the data the event is about, §0054's rule) and WHEN (once per
// context per synced batch, after the index caught up — `useVaultChangeSync` decides that) are
// tier-neutral and live here; only the delivery differs, so `deliver` is a callback. No debounce
// here: the batcher already sends one batch per quiet window (plan 0122 P10).
import type { PluginCapability, VaultChange } from "./types";

import { subscribeVaultChanges } from "../services/vault-changes";
import { logger } from "../utils/logger";

export const VAULT_CHANGED_EVENT = "vault:changed";

export interface WatchVaultChangesOptions {
  capabilities: readonly PluginCapability[];
  /** Tier-specific: a frame to the sandbox, or this plugin's own handlers in this realm. */
  deliver: (change: VaultChange) => void;
  /** Names the tier in the debug log. */
  label: string;
  pluginId: string;
  /** Injectable for tests; defaults to the app's publisher. */
  subscribe?: (listener: (contextId: string) => void) => () => void;
}

/** Whether `capabilities` may hear `vault:changed` — the two that may read the files it is about. */
export function canHearVaultChanges(
  capabilities: readonly PluginCapability[],
): boolean {
  return (
    capabilities.includes("files") || capabilities.includes("files:readonly")
  );
}

/**
 * Tell one plugin when a context's notes change. Returns an unsubscriber. A plugin without a file
 * capability is not subscribed at all: it could not read what changed.
 */
export function watchVaultChanges(
  options: WatchVaultChangesOptions,
): () => void {
  const { capabilities, deliver, label, pluginId } = options;
  if (!canHearVaultChanges(capabilities)) return () => undefined;
  const subscribe = options.subscribe ?? subscribeVaultChanges;
  return subscribe((context) => {
    try {
      deliver({ context });
    } catch (err) {
      // A closed session is the ordinary case: a publish that races an unload.
      logger.debug(`[${label}] ${pluginId}: vault change notify skipped`, err);
    }
  });
}

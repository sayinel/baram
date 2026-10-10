// §393 "Notes in this context changed, and the link index has caught up" (spec 0072 §6).
//
// Published by `useVaultChangeSync` once per context per synced batch, AFTER
// `sync_index_paths` resolved — so a listener that reads the index on hearing it reads the new
// state. Read by the plugin notifier (`plugins/vault-change-notifier.ts`). A module-level set
// rather than a store: nothing renders from it, and nothing needs the last value later.
import { logger } from "../utils/logger";

type Listener = (contextId: string) => void;

const listeners = new Set<Listener>();

/** Tell every listener that `contextId`'s notes changed. A throwing listener is logged and the rest still hear. */
export function publishVaultChange(contextId: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(contextId);
    } catch (err) {
      logger.error("[vault-changes] listener failed", err);
    }
  }
}

/** Subscribe; returns the unsubscriber. */
export function subscribeVaultChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

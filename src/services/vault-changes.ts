// §393 "Files in this context changed, and the link index has caught up" (spec 0072 §6).
//
// Published by `useVaultChangeSync` once per context per synced batch, AFTER
// `sync_index_paths` resolved — so a listener that reads the index on hearing it reads the new
// state. Read by the plugin notifier (`plugins/vault-change-notifier.ts`). A module-level set
// rather than a store: nothing renders from it, and nothing needs the last value later.
//
// §395 spec 0074 D12 — held back while an app file operation touches that context. The operation
// raises a hold on every context holding a path it touches (`beginFileOperation` in
// `plugins/file-decorations/operation-notices.ts` calls `holdVaultChanges`); a publish for a held
// context is kept, and the context's last release publishes it once — after the operation told plugins
// `file:rename` / `file:delete`. Released by the operation ending, never by time: an IPC that never
// ends keeps that context's `vault:changed` held, and no other context's.
import { logger } from "../utils/logger";

type Listener = (contextId: string) => void;

const listeners = new Set<Listener>();
/** How many running operations hold each context. */
const holds = new Map<string, number>();
/** Held contexts that `publishVaultChange` named while held. */
const heldBack = new Set<string>();

/** Tests only — drop every hold and every held change. */
export function __resetVaultChangeHolds(): void {
  holds.clear();
  heldBack.clear();
}

/**
 * D12 — hold `vault:changed` for `contextIds` until the returned release runs. Holds add up: a context
 * stays held until its last hold is released, and then publishes once if it was named meanwhile.
 * Calling a release twice releases once.
 */
export function holdVaultChanges(contextIds: readonly string[]): () => void {
  const held = [...new Set(contextIds)];
  for (const id of held) holds.set(id, (holds.get(id) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const id of held) {
      const left = (holds.get(id) ?? 1) - 1;
      if (left > 0) {
        holds.set(id, left);
        continue;
      }
      holds.delete(id);
      if (heldBack.delete(id)) tell(id);
    }
  };
}

/**
 * Tell every listener that `contextId`'s notes changed — or, while an app file operation holds
 * `contextId` (D12), keep it until the last hold is released. A throwing listener is logged and the
 * rest still hear.
 */
export function publishVaultChange(contextId: string): void {
  if (holds.has(contextId)) {
    heldBack.add(contextId);
    return;
  }
  tell(contextId);
}

/** Subscribe; returns the unsubscriber. */
export function subscribeVaultChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function tell(contextId: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(contextId);
    } catch (err) {
      logger.error("[vault-changes] listener failed", err);
    }
  }
}

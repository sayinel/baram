// §393 Batch the file watcher's events into `sync_index_paths` calls (spec 0072 §6, D12 · D13).
//
// The watcher coalesces nothing — one atomic save is two or more events — so events are kept as
// a SET OF PATHS plus one bit each: whether every event for it was `file:changed`. What happened
// otherwise does not matter; Rust judges each path by what it is on disk when the batch is synced.
// A batch goes out when no event arrived for `quietMs`, or `maxWaitMs` after its first event, so
// a steady stream of writes still syncs. Batches are SERIAL: events that arrive while one is
// syncing form the next, and a timer that fires meanwhile sends it once the current one settles.
// `onSynced` runs only after `sync` resolved — what lets a listener read the index on hearing — and
// only for an answer that names a context; the batcher reads nothing else of the answer.
import type { IndexSyncAnswer, IndexSyncPath } from "../ipc/types";

import { logger } from "../utils/logger";

export const VAULT_SYNC_MAX_WAIT_MS = 2000;
export const VAULT_SYNC_QUIET_MS = 500;

export interface VaultChangeBatcher {
  dispose(): void;
  touch(path: string, kind: VaultEventKind): void;
}

export interface VaultChangeBatcherOptions {
  maxWaitMs?: number;
  /**
   * The batch's answer — called only when it names a context. That loses no `linksChanged`: an
   * answer with it set names one (Rust `SyncAnswer`).
   */
  onSynced: (answer: IndexSyncAnswer) => void;
  quietMs?: number;
  sync: (paths: IndexSyncPath[]) => Promise<IndexSyncAnswer>;
}

export type VaultEventKind = "changed" | "created" | "deleted";

export function createVaultChangeBatcher(
  options: VaultChangeBatcherOptions,
): VaultChangeBatcher {
  const quietMs = options.quietMs ?? VAULT_SYNC_QUIET_MS;
  const maxWaitMs = options.maxWaitMs ?? VAULT_SYNC_MAX_WAIT_MS;
  /** Path → whether every event for it so far was `file:changed`. */
  let pending = new Map<string, boolean>();
  let quietTimer: null | ReturnType<typeof setTimeout> = null;
  let maxTimer: null | ReturnType<typeof setTimeout> = null;
  let syncing = false;
  let dueAfterSync = false;
  let disposed = false;

  const clearTimers = () => {
    if (quietTimer) clearTimeout(quietTimer);
    if (maxTimer) clearTimeout(maxTimer);
    quietTimer = null;
    maxTimer = null;
  };

  const send = async (): Promise<void> => {
    if (disposed || pending.size === 0) return;
    const batch = [...pending].map(([path, changedOnly]) => ({
      changedOnly,
      path,
    }));
    pending = new Map();
    syncing = true;
    let answer: IndexSyncAnswer | null = null;
    try {
      answer = await options.sync(batch);
    } catch (err) {
      // Plan 0122 P8 — dropped, not re-queued: the next watcher event sends the path again.
      logger.warn("[vault-sync] sync_index_paths failed; batch dropped", err);
    } finally {
      syncing = false;
    }
    if (!disposed && answer !== null && answer.contexts.length > 0) {
      try {
        options.onSynced(answer);
      } catch (err) {
        // A throwing listener must not strand the batch whose timer fired during this sync.
        logger.error("[vault-sync] onSynced failed", err);
      }
    }
    if (dueAfterSync) {
      dueAfterSync = false;
      void send();
    }
  };

  const fire = () => {
    clearTimers();
    if (syncing) {
      dueAfterSync = true;
      return;
    }
    void send();
  };

  return {
    dispose() {
      disposed = true;
      clearTimers();
      pending.clear();
    },
    touch(path, kind) {
      if (disposed) return;
      const changed = kind === "changed";
      const before = pending.get(path);
      pending.set(path, before === undefined ? changed : before && changed);
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(fire, quietMs);
      maxTimer ??= setTimeout(fire, maxWaitMs);
    },
  };
}

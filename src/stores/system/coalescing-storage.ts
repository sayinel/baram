// §44 A persist storage that writes at most once per interval (#800).
//
// zustand's `persist` calls `setItem` after EVERY `set`, and `createJSONStorage` stringifies
// the whole persisted state each time. For the AI chat that is one stringify of every
// session and one rewrite of `config.json` (Rust reads, parses and rewrites the whole file —
// settings, vaults and every other store's value with it) per streamed token. This storage
// keeps only the newest value per key and serializes and writes it once per interval, or at
// once on `flush()`.
//
// ‼️ What it gives up: a crash or a kill loses up to one interval of changes. The store
// that uses it flushes where a change must not wait (see `stores/ai/chat.ts`).
import type {
  PersistStorage,
  StateStorage,
  StorageValue,
} from "zustand/middleware";

import { logger } from "../../utils/logger";

export interface CoalescingStorage<S> extends PersistStorage<S> {
  /** Write every pending value now; resolves once that write and every one queued before it settled. */
  flush: () => Promise<void>;
}

/**
 * Wrap a string storage so writes coalesce.
 *
 * - `setItem` only records the value and arms one timer; the timer is NOT reset by later
 *   calls, so a long stream still saves every `intervalMs` rather than only at its end.
 * - Writes run one at a time, each after the previous one settles, and each writes the
 *   newest value at the moment it starts — an older write cannot land after a newer one.
 * - `flush()` drains: it resolves once nothing is left pending, including values set while
 *   its writes were running.
 * - `removeItem` drops a pending value for that key and is queued behind earlier writes.
 */
export function createCoalescingStorage<S>(
  storage: StateStorage,
  intervalMs: number,
): CoalescingStorage<S> {
  const pending = new Map<string, StorageValue<S>>();
  let timer: null | ReturnType<typeof setTimeout> = null;
  let chain: Promise<void> = Promise.resolve();

  const enqueue = (step: () => Promise<void> | void): Promise<void> => {
    chain = chain.then(step).catch((e: unknown) => {
      logger.error("[coalescing-storage] write failed:", e);
    });
    return chain;
  };

  // Drain until nothing is pending: a value set while a write is awaited is written by the
  // same drain, so `flush()` resolves only once every value set before it RESOLVES is on
  // disk — a barrier, not a snapshot. Updates that never stop (a stream still running)
  // keep it going; the exit path bounds its wait (`services/app-exit.ts`).
  const writePending = async () => {
    for (let next = pending.entries().next(); !next.done;) {
      const [name, value] = next.value;
      pending.delete(name);
      await storage.setItem(name, JSON.stringify(value));
      next = pending.entries().next();
    }
  };

  // The drain below writes what the timer would have, so the timer goes. Left armed it
  // would only fire on an empty map — but it would also keep `setItem` from arming a fresh
  // one, so the next change would be saved on the OLD timer's schedule.
  const flush = (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    return enqueue(writePending);
  };

  return {
    flush,
    getItem: async (name) => {
      const raw = await storage.getItem(name);
      return raw === null ? null : (JSON.parse(raw) as StorageValue<S>);
    },
    removeItem: (name) => {
      pending.delete(name);
      return enqueue(() => storage.removeItem(name) as Promise<void> | void);
    },
    setItem: (name, value) => {
      pending.set(name, value);
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          void enqueue(writePending);
        }, intervalMs);
      }
    },
  };
}

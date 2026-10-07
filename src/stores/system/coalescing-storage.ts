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
 * - Each drain writes what is pending when it STARTS — the newest value per key at that
 *   point — and returns. A value that arrives during it waits for the next interval, so a
 *   continuous stream is written about once per interval, not as fast as the IPC allows.
 * - `flush()` is a barrier for everything set before it is called: its drain is queued
 *   behind any drain already running and starts no earlier than the call, so it sees those
 *   values. Values set after the call are not waited for.
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

  // One drain: take what is pending now, write it, return. Chasing values that arrive
  // during the awaited writes would keep a drain running for a whole streamed reply and
  // make an exit wait for its bound; those values are left for the next interval instead —
  // `setItem` arms a fresh timer for them, because the timer that started this drain (or
  // the flush) has already cleared itself.
  const writePending = async () => {
    const batch = [...pending];
    pending.clear();
    for (const [name, value] of batch) {
      await storage.setItem(name, JSON.stringify(value));
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

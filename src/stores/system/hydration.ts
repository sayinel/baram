// Waiting for a persisted store to finish rehydrating (issue 597).
//
// Every persisted store here rehydrates ASYNCHRONOUSLY through `tauriStorage`
// (a Rust IPC round trip). Until that lands, `getState()` returns the slice
// DEFAULTS — an empty context list, the default `onLaunch` — not what the
// user saved. Code that reads a store ONCE at startup and then locks its
// decision in (the launch restore: "no contexts → legacy path, done") must
// wait, or it decides on the defaults and never revisits.
//
// `useSettingsHydrated` is the React-side form of the same gate; this is the
// imperative one for async startup code. It never starts a second storage
// read: a `rehydrate()` after mount would supersede the in-flight one and
// merge the older snapshot over anything the user changed meanwhile.
//
// ‼️ zustand's `onFinishHydration` fires only when hydration SUCCEEDS. A read
// that throws (a corrupt config.json, `JSON.parse` on something that is not
// JSON) leaves `hasHydrated()` false for good and notifies nobody. The stores
// therefore report that failure through `noteHydrationFailure` from their
// `onRehydrateStorage` callback, and the wait ends there too — with the
// defaults, which is what the app did before it waited at all.

/** The persist-api members the wait needs — `useXStore.persist` satisfies it. */
export interface HydrationApi {
  hasHydrated: () => boolean;
  onFinishHydration: (listener: (state: unknown) => void) => () => void;
}

const failed = new WeakSet<HydrationApi>();
const waiters = new WeakMap<HydrationApi, Set<() => void>>();

/**
 * Called by a store's `onRehydrateStorage` when hydration failed: the store is
 * on its defaults and will stay there, so everyone waiting on it may proceed.
 */
export function noteHydrationFailure(api: HydrationApi): void {
  failed.add(api);
  const pending = waiters.get(api);
  if (!pending) return;
  waiters.delete(api);
  for (const wake of pending) wake();
}

/**
 * Resolves once the store has hydrated, or once its hydration has failed.
 * Immediately if either is already the case.
 *
 * ‼️ Re-checks AFTER subscribing: `onFinishHydration` fires once, so a
 * hydration that lands between the first check and the subscription would
 * otherwise never be observed, and the caller would wait forever.
 */
export function waitForHydration(api: HydrationApi): Promise<void> {
  if (api.hasHydrated() || failed.has(api)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      unsubscribe();
      waiters.get(api)?.delete(finish);
      resolve();
    };
    const unsubscribe = api.onFinishHydration(finish);
    const pending = waiters.get(api) ?? new Set<() => void>();
    pending.add(finish);
    waiters.set(api, pending);
    if (api.hasHydrated() || failed.has(api)) finish();
  });
}

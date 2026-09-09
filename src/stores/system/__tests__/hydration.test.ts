// issue 597 — `waitForHydration` resolves once the persisted store has
// rehydrated, or once its hydration has FAILED (reported by the store's
// `onRehydrateStorage`), and never starts a second storage read.
import { describe, expect, it, vi } from "vitest";

import {
  type HydrationApi,
  noteHydrationFailure,
  waitForHydration,
} from "../hydration";

function fakeApi(hydrated: boolean) {
  const listeners = new Set<(s: unknown) => void>();
  const api: HydrationApi = {
    hasHydrated: () => hydrated,
    onFinishHydration: vi.fn((cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }),
  };
  return {
    api,
    finish: () => {
      hydrated = true;
      for (const cb of listeners) cb({});
    },
    listeners,
  };
}

describe("waitForHydration", () => {
  it("resolves at once, without subscribing, when the store has hydrated", async () => {
    const { api } = fakeApi(true);
    await expect(waitForHydration(api)).resolves.toBeUndefined();
    expect(api.onFinishHydration).not.toHaveBeenCalled();
  });

  it("waits for hydration to finish, then unsubscribes", async () => {
    const { api, finish, listeners } = fakeApi(false);
    let settled = false;
    const waiting = waitForHydration(api).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(listeners.size).toBe(1);
    finish();
    await waiting;
    expect(settled).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it("does not wait forever when hydration lands between the check and the subscription", async () => {
    let hydrated = false;
    const api: HydrationApi = {
      hasHydrated: () => hydrated,
      onFinishHydration: (cb) => {
        hydrated = true; // landed "meanwhile"; the listener never fires
        void cb;
        return () => {};
      },
    };
    await expect(waitForHydration(api)).resolves.toBeUndefined();
  });

  it("ends the wait when the store reports a failed hydration", async () => {
    const { api } = fakeApi(false);
    let settled = false;
    const waiting = waitForHydration(api).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    noteHydrationFailure(api);
    await waiting;
    expect(settled).toBe(true);
    // A store known to have failed does not make a later caller wait either.
    await expect(waitForHydration(api)).resolves.toBeUndefined();
  });
});

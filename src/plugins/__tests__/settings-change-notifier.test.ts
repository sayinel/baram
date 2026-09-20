// §0054 — WHEN a plugin is told its own settings moved.
//
// Moved here from `sandbox/__tests__/host-settings-bridge.test.ts` with the watcher itself:
// the rule is tier-neutral now, and `deliver` is the only part either tier supplies. What a
// delivery CARRIES is asserted at the two call sites — `settings-end-to-end.test.ts` for the
// sandbox frame, `trusted-settings-changed.test.ts` for the trusted call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePluginStore } from "../../stores/system/plugin";
import {
  SETTINGS_NOTIFY_DEBOUNCE_MS,
  watchPluginSettings,
} from "../settings-change-notifier";

describe("watchPluginSettings", () => {
  const wait = (ms: number) =>
    new Promise((resolve) => globalThis.setTimeout(resolve, ms));

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A subscription this test drives by hand, standing in for the store's. */
  function fakeSubscribe() {
    const listeners: Array<() => void> = [];
    return {
      change: () => listeners.forEach((l) => l()),
      stopped: () => listeners.length === 0,
      subscribe: (listener: () => void) => {
        listeners.push(listener);
        return () => void listeners.splice(listeners.indexOf(listener), 1);
      },
    };
  }

  it("tells the plugin its settings changed, once, after the values settle", () => {
    // A string field writes on every keystroke; undebounced, that is one notification per
    // character — a frame and a pull in the sandbox, a stylesheet rebuild in the main realm.
    const deliver = vi.fn();
    const store = fakeSubscribe();
    watchPluginSettings({
      capabilities: ["settings"],
      deliver,
      label: "Test",
      pluginId: "p",
      subscribe: store.subscribe,
    });

    store.change();
    store.change();
    store.change();
    expect(deliver).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SETTINGS_NOTIFY_DEBOUNCE_MS);

    expect(deliver).toHaveBeenCalledTimes(1);
    // The WATCHER carries nothing — not even which keys moved. Both tiers' deliveries are
    // payload-free, and this is the half of that property that lives here: a `deliver`
    // implementation has nothing to forward even if it wanted to.
    expect(deliver).toHaveBeenCalledWith();
  });

  it("does not subscribe a plugin without the settings capability", () => {
    // It could not read the values, so the notification would only invite a call that refuses.
    const deliver = vi.fn();
    const store = fakeSubscribe();
    watchPluginSettings({
      capabilities: ["storage"],
      deliver,
      label: "Test",
      pluginId: "p",
      subscribe: store.subscribe,
    });

    store.change();
    vi.advanceTimersByTime(SETTINGS_NOTIFY_DEBOUNCE_MS);

    expect(deliver).not.toHaveBeenCalled();
    expect(store.stopped()).toBe(true);
  });

  it("drops a pending notification when the plugin unloads", () => {
    // The debounce can outlive an unload by up to its delay; delivering then would reach a
    // session the loader has already torn down, or a trusted handler whose plugin is gone.
    const deliver = vi.fn();
    const store = fakeSubscribe();
    const stop = watchPluginSettings({
      capabilities: ["settings"],
      deliver,
      label: "Test",
      pluginId: "p",
      subscribe: store.subscribe,
    });

    store.change();
    stop();
    vi.advanceTimersByTime(SETTINGS_NOTIFY_DEBOUNCE_MS * 4);

    expect(deliver).not.toHaveBeenCalled();
    expect(store.stopped()).toBe(true);
  });

  it("wakes the right plugin, once, against the REAL store", async () => {
    // §260 Phase 4c code review (L9) — every other test in this file injects `subscribe`,
    // so the production half was unpinned: zustand's two-argument listener contract, the
    // slice-identity predicate, and "one plugin's edit does not wake another". That is this
    // project's own "a test double hides the defect" class, so this one drives the real
    // store and lets the real `liveSubscribe` run.
    vi.useRealTimers();
    usePluginStore.setState({ pluginSettings: {} });
    const mine = vi.fn();
    const stop = watchPluginSettings({
      capabilities: ["settings"],
      deliver: mine,
      label: "Test",
      pluginId: "p",
    });

    usePluginStore.getState().setPluginSetting("other", "k", 1);
    await wait(SETTINGS_NOTIFY_DEBOUNCE_MS * 2);
    expect(mine).not.toHaveBeenCalled(); // another plugin's slice is a different object

    usePluginStore.getState().setPluginSetting("p", "k", 1);
    await wait(SETTINGS_NOTIFY_DEBOUNCE_MS * 2);
    expect(mine).toHaveBeenCalledTimes(1);

    stop();
    usePluginStore.getState().setPluginSetting("p", "k", 2);
    await wait(SETTINGS_NOTIFY_DEBOUNCE_MS * 2);
    expect(mine).toHaveBeenCalledTimes(1); // unsubscribed for real, not just debounced
  });

  it("survives a delivery that throws", () => {
    // A closed sandbox session, or a trusted handler that threw. Neither is worth failing a
    // store update over.
    const deliver = vi.fn(() => {
      throw new Error("session is closed");
    });
    const store = fakeSubscribe();
    watchPluginSettings({
      capabilities: ["settings"],
      deliver,
      label: "Test",
      pluginId: "p",
      subscribe: store.subscribe,
    });

    store.change();
    expect(() =>
      vi.advanceTimersByTime(SETTINGS_NOTIFY_DEBOUNCE_MS),
    ).not.toThrow();
  });
});

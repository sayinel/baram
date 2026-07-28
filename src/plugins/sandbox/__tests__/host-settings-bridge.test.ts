// §260 Phase 4c — the host side of `settings`: what a plugin may read, when it is told,
// and what never rides a frame.
import type { PluginCapability, PluginSettingField } from "../../types";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePluginStore } from "../../../stores/system/plugin";
import {
  createSettingsRequestHandler,
  SETTINGS_CHANGED_EVENT,
  SETTINGS_NOTIFY_DEBOUNCE_MS,
  watchPluginSettings,
} from "../host-settings-bridge";

const DECLARED: PluginSettingField[] = [
  { default: true, key: "compact", label: "Compact", type: "boolean" },
  { default: 3, key: "depth", label: "Depth", type: "number" },
];

function handler(
  capabilities: PluginCapability[],
  persisted: Record<string, unknown> | undefined = undefined,
  declaredSettings: PluginSettingField[] = DECLARED,
) {
  const staged: string[] = [];
  const call = createSettingsRequestHandler({
    capabilities,
    declaredSettings,
    persisted: () => persisted,
    pluginId: "p",
    stage: async (_pluginId, payload) => void staged.push(payload),
  });
  return { call, staged };
}

describe("createSettingsRequestHandler", () => {
  it("stages the resolved values and answers with nothing", async () => {
    // The answer does NOT ride the response: `MAX_SETTING_FIELDS` × the per-string cap is
    // already over tauri's 8 KiB channel-data threshold.
    const { call, staged } = handler(["settings"], { depth: 9 });

    const answer = await call({ kind: "settings_read" });

    expect(answer).toBeUndefined();
    expect(staged).toEqual([JSON.stringify({ compact: true, depth: 9 })]);
  });

  it("refuses without the settings capability, naming it", async () => {
    const { call, staged } = handler(["storage"]);
    await expect(call({ kind: "settings_read" })).rejects.toThrow(
      /requires the "settings" capability/,
    );
    // Refused BEFORE the work: nothing staged, so a denied plugin cannot leave a payload
    // sitting in its slot for its next legitimate pull to collect.
    expect(staged).toEqual([]);
  });

  it("stages only DECLARED keys, whatever the persisted record holds", async () => {
    // The manifest is the payload's bound. A key the plugin no longer declares — after an
    // update that renamed it — must not come back under the old name.
    const { call, staged } = handler(["settings"], {
      compact: false,
      removedInV2: "secret",
    });

    await call({ kind: "settings_read" });

    expect(JSON.parse(staged[0])).toEqual({ compact: false, depth: 3 });
  });

  it("re-resolves on every call, so a value changed mid-session is seen", async () => {
    let persisted: Record<string, unknown> = { depth: 1 };
    const staged: string[] = [];
    const call = createSettingsRequestHandler({
      capabilities: ["settings"],
      declaredSettings: DECLARED,
      persisted: () => persisted,
      pluginId: "p",
      stage: async (_pluginId, payload) => void staged.push(payload),
    });

    await call({ kind: "settings_read" });
    persisted = { depth: 2 };
    await call({ kind: "settings_read" });

    expect(
      staged.map((s) => (JSON.parse(s) as { depth: number }).depth),
    ).toEqual([1, 2]);
  });

  it("stages an empty object for a plugin that declares no fields", async () => {
    // No special case: the same one path, so there is no threshold or emptiness branch to
    // get wrong, and the client's parse always has something to parse.
    const { call, staged } = handler(["settings"], undefined, []);
    await call({ kind: "settings_read" });
    expect(staged).toEqual(["{}"]);
  });
});

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
    // A string field writes on every keystroke; undebounced, that is one frame per
    // character and a pull for each.
    const deliverEvent = vi.fn();
    const store = fakeSubscribe();
    watchPluginSettings({
      capabilities: ["settings"],
      pluginId: "p",
      session: { deliverEvent },
      subscribe: store.subscribe,
    });

    store.change();
    store.change();
    store.change();
    expect(deliverEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SETTINGS_NOTIFY_DEBOUNCE_MS);

    expect(deliverEvent).toHaveBeenCalledTimes(1);
    // No payload: the values travel only as a staged pull the plugin asks for.
    expect(deliverEvent).toHaveBeenCalledWith(SETTINGS_CHANGED_EVENT, []);
  });

  it("does not subscribe a plugin without the settings capability", () => {
    // It could not read the values, so the frame would only invite a call that refuses.
    const deliverEvent = vi.fn();
    const store = fakeSubscribe();
    watchPluginSettings({
      capabilities: ["storage"],
      pluginId: "p",
      session: { deliverEvent },
      subscribe: store.subscribe,
    });

    store.change();
    vi.advanceTimersByTime(SETTINGS_NOTIFY_DEBOUNCE_MS);

    expect(deliverEvent).not.toHaveBeenCalled();
    expect(store.stopped()).toBe(true);
  });

  it("drops a pending notification when the plugin unloads", () => {
    // The debounce can outlive an unload by up to its delay; delivering then would reach a
    // session the loader has already torn down.
    const deliverEvent = vi.fn();
    const store = fakeSubscribe();
    const stop = watchPluginSettings({
      capabilities: ["settings"],
      pluginId: "p",
      session: { deliverEvent },
      subscribe: store.subscribe,
    });

    store.change();
    stop();
    vi.advanceTimersByTime(SETTINGS_NOTIFY_DEBOUNCE_MS * 4);

    expect(deliverEvent).not.toHaveBeenCalled();
    expect(store.stopped()).toBe(true);
  });

  it("wakes the right plugin, once, against the REAL store", async () => {
    // §260 Phase 4c code review (L9) — every other test in this file injects `subscribe`,
    // so the production half was unpinned: zustand's two-argument listener contract, the
    // slice-identity predicate, and "one plugin's edit does not wake another sandbox". That
    // is this project's own "a test double hides the defect" class, so this one drives the
    // real store and lets the real `liveSubscribe` run.
    vi.useRealTimers();
    usePluginStore.setState({ pluginSettings: {} });
    const mine = vi.fn();
    const stop = watchPluginSettings({
      capabilities: ["settings"],
      pluginId: "p",
      session: { deliverEvent: mine },
    });

    usePluginStore.getState().setPluginSetting("other", "k", 1);
    await wait(SETTINGS_NOTIFY_DEBOUNCE_MS * 2);
    expect(mine).not.toHaveBeenCalled(); // another plugin's slice is a different object

    usePluginStore.getState().setPluginSetting("p", "k", 1);
    await wait(SETTINGS_NOTIFY_DEBOUNCE_MS * 2);
    expect(mine).toHaveBeenCalledTimes(1);
    expect(mine).toHaveBeenCalledWith(SETTINGS_CHANGED_EVENT, []);

    stop();
    usePluginStore.getState().setPluginSetting("p", "k", 2);
    await wait(SETTINGS_NOTIFY_DEBOUNCE_MS * 2);
    expect(mine).toHaveBeenCalledTimes(1); // unsubscribed for real, not just debounced
  });

  it("survives a session that rejects the delivery", () => {
    const deliverEvent = vi.fn(() => {
      throw new Error("session is closed");
    });
    const store = fakeSubscribe();
    watchPluginSettings({
      capabilities: ["settings"],
      pluginId: "p",
      session: { deliverEvent },
      subscribe: store.subscribe,
    });

    store.change();
    expect(() =>
      vi.advanceTimersByTime(SETTINGS_NOTIFY_DEBOUNCE_MS),
    ).not.toThrow();
  });
});

// §0054 — `settings:changed` in the TRUSTED tier, end to end through the real store.
//
// ‼️ WHAT WOULD MAKE THIS FAIL, stated before it was written, because a passing test that
// cannot answer that is a test that proves nothing:
//
// - Restore the `events`-only gate on `ctx.events` and `subscribes…` throws instead of
//   registering — the exact state a `["extensions", "settings"]` plugin was in.
// - Route the event through the shared `eventListeners` and `does not wake another plugin`
//   fails, because both contexts' handlers land in one `Set`.
// - Drop the `watchPluginSettings` call from `createExtensionContext` and every delivery
//   assertion fails while the subscription assertions still pass — which is the shape the
//   bug had: the API was there, nothing fed it.
//
// The user-visible symptom this closes: editing a Bullet Threading setting did nothing until
// the plugin was toggled off and on.
import type { ExtensionContext, PluginManifest } from "../types";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePluginStore } from "../../stores/system/plugin";
import { createExtensionContext } from "../extension-context";
import { SETTINGS_NOTIFY_DEBOUNCE_MS } from "../settings-change-notifier";

function makeManifest(id: string, capabilities: string[]): PluginManifest {
  return {
    id,
    name: id,
    description: "fixture",
    version: "1.0.0",
    author: "Test",
    license: "MIT",
    main: "index.mjs",
    engines: { baram: ">=0.7.0" },
    capabilities: capabilities as PluginManifest["capabilities"],
    trust: "trusted",
    contributions: {
      settings: [{ default: 2, key: "width", label: "Width", type: "number" }],
    },
  };
}

/** Longer than the debounce, so a notification that is coming has arrived. */
const settle = () =>
  new Promise((resolve) =>
    globalThis.setTimeout(resolve, SETTINGS_NOTIFY_DEBOUNCE_MS * 2),
  );

describe("a trusted plugin is told when its own settings change", () => {
  const live: ExtensionContext[] = [];

  /**
   * A context that is torn down after the test, the way `unloadPlugin` tears one down.
   *
   * ‼️ Not a convenience. Without it, a context left alive by an earlier test keeps its store
   * watcher, and because the scoped bus is keyed by PLUGIN ID a later test reusing that id
   * receives that watcher's deliveries too — which is how the first draft of the last case
   * here saw two calls it had not asked for. Leaking a live plugin between tests is the
   * hazard, so the fixture removes it rather than the tests dodging it with unique ids.
   */
  function context(id: string, capabilities: string[]) {
    const ctx = createExtensionContext(makeManifest(id, capabilities), "/test");
    live.push(ctx);
    return ctx;
  }

  beforeEach(() => usePluginStore.setState({ pluginSettings: {} }));
  afterEach(() => {
    live.splice(0).forEach((ctx) => {
      ctx.subscriptions.forEach((d) => d.dispose());
    });
    usePluginStore.setState({ pluginSettings: {} });
  });

  it('subscribes with only "settings" — the capability Bullet Threading declares', async () => {
    // ‼️ No "events" here. That is the whole point: requiring it would make the install
    // dialog say this plugin subscribes to what the user does to their files, for a plugin
    // that only wants to know its own colour moved.
    const ctx = context("p", ["extensions", "settings"]);
    const heard = vi.fn();
    ctx.events.on("settings:changed", heard);

    usePluginStore.getState().setPluginSetting("p", "width", 4);
    await settle();

    expect(heard).toHaveBeenCalledTimes(1);
    // Payload-free, like the sandbox frame: the values are re-read, never pushed.
    expect(heard).toHaveBeenCalledWith();
    // …and re-reading is what shows the new value.
    expect(ctx.settings.getAll()).toEqual({ width: 4 });
  });

  it("does not wake another plugin", async () => {
    // The trusted event bus is a module-level Map shared by every plugin, so this is the
    // assertion that the settings event does NOT ride it.
    const mine = context("mine", ["settings"]);
    const other = context("other", ["settings"]);
    const heardMine = vi.fn();
    const heardOther = vi.fn();
    mine.events.on("settings:changed", heardMine);
    other.events.on("settings:changed", heardOther);

    usePluginStore.getState().setPluginSetting("mine", "width", 3);
    await settle();

    expect(heardMine).toHaveBeenCalledTimes(1);
    expect(heardOther).not.toHaveBeenCalled();
  });

  it("stops when the plugin's subscriptions are disposed", async () => {
    const ctx = context("p", ["settings"]);
    const heard = vi.fn();
    ctx.events.on("settings:changed", heard);
    // What `unloadPlugin` does: dispose everything the context collected. That list holds
    // both the plugin's own handler and the store watcher.
    ctx.subscriptions.forEach((d) => d.dispose());

    usePluginStore.getState().setPluginSetting("p", "width", 5);
    await settle();

    expect(heard).not.toHaveBeenCalled();
  });

  it('still refuses every OTHER event without "events"', () => {
    // The settings grant buys one payload-free notification about this plugin's own
    // configuration. It is not a way around the events capability.
    const ctx = context("p", ["settings"]);
    expect(() => ctx.events.on("file:opened", vi.fn())).toThrow(/"events"/u);
    expect(() => ctx.events.emit("settings:changed")).toThrow(/"events"/u);
  });

  it("gives a plugin with neither capability the denied proxy, unchanged", () => {
    const ctx = context("p", ["storage"]);
    expect(() => ctx.events.on("settings:changed", vi.fn())).toThrow(
      /"events"/u,
    );
  });

  it('accepts the subscription without "settings" and simply never fires it', async () => {
    // ‼️ Deliberately NOT a throw. The sandboxed guest's `events.on` is a local registry and
    // its host declines to watch, so a sandboxed plugin in this state is silent — making the
    // trusted tier throw instead would reintroduce the tier asymmetry §0054 exists to remove.
    // The author's real error surfaces from `settings.getAll()`, which names the capability.
    const ctx = context("p", ["events"]);
    const heard = vi.fn();
    expect(() => ctx.events.on("settings:changed", heard)).not.toThrow();

    usePluginStore.getState().setPluginSetting("p", "width", 6);
    await settle();

    expect(heard).not.toHaveBeenCalled();
    expect(() => ctx.settings.getAll()).toThrow(/"settings"/u);
  });
});

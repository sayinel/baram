// §69 — the loader's user-visible refusals reach the user in their own language.
//
// ‼️ WHY THESE THREE. Every throw out of `loadPlugin` is written to `pluginErrors` verbatim —
// `plugin-lifecycle.ts` and `PluginMarketplace` both do `setError(id, String(err))` — and the
// Installed row renders it. The manifest-validation throw is deliberately left in English (the
// schema text names a field, and no shipped registry can produce such a manifest), but these
// three are ordinary failures:
//
//   * an ESM that does not import on this build — a plugin bug, any user can hit it
//   * activation that hangs — the same
//   * a plugin update that raises its trust tier — the escalation guard §260 Phase 5 exists for
//
// ‼️ AND WHY IN KOREAN. A test that asks for `en` cannot tell a translated message from a
// hardcoded English one, because English is what a hardcoded sentence returns. Only a
// non-English locale discriminates. Two of these three had no test at all before this file.
import type { PluginManifest, PluginModule } from "../types";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `invoke` as well as `convertFileSrc`: the plugin store persists through tauri storage, and a
// mock missing it makes every refusal read "[vitest] No \"invoke\" export is defined" — which is
// what the first version of this file asserted against.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: () => Promise.resolve(null),
}));
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginSandboxDeregister: () => Promise.resolve(),
  pluginSandboxRegister: () => Promise.resolve(),
  pluginSandboxStage: () => Promise.resolve(),
}));

import { t } from "../../i18n";
import { useSettingsStore } from "../../stores/settings/store";
import { usePluginStore } from "../../stores/system/plugin";
import { PluginLoader } from "../plugin-loader";

const BASE: PluginManifest = {
  author: "test",
  capabilities: [],
  description: "d",
  engines: { baram: ">=0.5.0" },
  id: "demo",
  license: "MIT",
  main: "index.mjs",
  name: "Demo",
  trust: "sandboxed",
  version: "1.0.0",
};

/**
 * A loader with a stub sandbox host.
 *
 * ‼️ THE IMPORTER PATH IS THE TRUSTED TIER'S. A sandboxed plugin never reaches
 * `this.importer` — it is staged into a WebviewWindow through the host — so the two module
 * cases below declare `trust: "trusted"`. Without the host the loader dies with "Cannot read
 * properties of undefined" long before any refusal, which is what the first version asserted.
 */
function loaderWith(importer: () => Promise<PluginModule>): PluginLoader {
  const host = {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    stopAll: () => Promise.resolve(),
  };
  return new PluginLoader(
    importer,
    host as unknown as ConstructorParameters<typeof PluginLoader>[1],
  );
}

/** The message `loadPlugin` threw, or null if it loaded. */
async function refusal(
  loader: PluginLoader,
  manifest: PluginManifest = BASE,
): Promise<null | string> {
  try {
    await loader.loadPlugin("/p/demo", manifest);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe("the loader's refusals are translated (§69)", () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: "ko" });
    usePluginStore.setState({ installedPlugins: {}, pluginErrors: {} });
  });

  afterEach(() => {
    useSettingsStore.setState({ locale: "en" });
    vi.useRealTimers();
  });

  it("says a module failed to load, in Korean, and keeps the engine's own text", async () => {
    const loader = loaderWith(() =>
      Promise.reject(new Error("Unexpected token '<'")),
    );

    const message = await refusal(loader, { ...BASE, trust: "trusted" });

    expect(message).toBe(
      t("plugin.error.moduleLoadFailed", "ko", {
        error: "Error: Unexpected token '<'",
        id: "demo",
      }),
    );
    // The wrapper is ours and is translated; the cause comes from the engine and must survive,
    // because it is the only part that says WHAT is wrong with the module.
    expect(message).toContain("Unexpected token '<'");
    expect(message).not.toContain("Failed to load plugin module");
  });

  it("says activation timed out, in Korean", async () => {
    vi.useFakeTimers();
    const loader = loaderWith(
      () =>
        Promise.resolve({
          // Never settles, which is what a hung activate is.
          activate: () => new Promise<void>(() => {}),
        }) as Promise<PluginModule>,
    );
    const pending = refusal(loader, { ...BASE, trust: "trusted" });
    // `withTimeout` rejects on a `setTimeout`, so the clock has to be driven. 5000 is
    // `ACTIVATE_TIMEOUT`; advancing further would also pass, advancing less must not.
    await vi.advanceTimersByTimeAsync(5000);

    const message = await pending;

    expect(message).toBe(
      t("plugin.error.activationTimeout", "ko", { id: "demo", ms: "5000" }),
    );
    expect(message).not.toContain("activation timed out");
  });

  it("refuses a tier escalation in Korean, naming the tier by its LABEL", async () => {
    usePluginStore.setState({
      installedPlugins: {
        demo: {
          checksum: "c",
          consent: { capabilities: [], trust: "sandboxed" },
          enabled: true,
          installedAt: 0,
          installPath: "/p/demo",
          manifest: BASE,
          updatedAt: 0,
        },
      } as unknown as Record<string, never>,
    });
    const loader = loaderWith(() => Promise.resolve({ activate: () => {} }));

    const message = await refusal(loader, { ...BASE, trust: "trusted" });

    // "샌드박스", not "sandboxed": the tier's UI label is what the user saw when approving, and
    // its internal name in the middle of a Korean sentence is a leak of an implementation term.
    expect(message).toContain(t("plugin.trust.sandboxed", "ko"));
    expect(message).not.toContain("sandboxed");
    expect(message).toBe(
      t("plugin.error.trustEscalated", "ko", {
        approved: t("plugin.trust.sandboxed", "ko"),
        id: "demo",
      }),
    );
  });

  it("still speaks English when the UI is English", async () => {
    // The complement: a translated message must not mean a Korean message for everyone. Without
    // this, wiring every key to the ko table would pass every case above.
    useSettingsStore.setState({ locale: "en" });
    const loader = loaderWith(() => Promise.reject(new Error("boom")));

    const message = await refusal(loader, { ...BASE, trust: "trusted" });

    expect(message).toBe(
      t("plugin.error.moduleLoadFailed", "en", {
        error: "Error: boom",
        id: "demo",
      }),
    );
    expect(message).toContain("Failed to load plugin module");
  });
});

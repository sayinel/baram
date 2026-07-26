// §260 Phase 3c-3 — enabling a plugin that previously failed must clear its error.
//
// Same defect the dev-plugin card had (fixed alongside this): `pluginErrors` was
// written on failure and never removed, and the store is persisted — so a plugin the
// user has since fixed and successfully enabled kept advertising why it once failed.
// Found by sweeping the other success paths after the live smoke surfaced the first
// instance.
import type { InstalledPlugin, RegistryIndex } from "../../../plugins/types";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadPlugin = vi.fn();
const unloadPlugin = vi.fn();

vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: {
    loadPlugin: (...a: unknown[]) => loadPlugin(...a),
    unloadPlugin: (...a: unknown[]) => unloadPlugin(...a),
  },
}));
vi.mock("../../../plugins/registry-client", () => ({
  checkForUpdates: () => Promise.resolve({}),
  fetchRegistryIndex: () =>
    Promise.resolve({ plugins: [] } satisfies RegistryIndex),
  searchRegistry: () => [],
}));

import { usePluginStore } from "../../../stores/system/plugin";
import { PluginMarketplace } from "../PluginMarketplace";

const disabledPlugin = {
  checksum: "abc",
  enabled: false,
  installedAt: 0,
  installPath: "/p/demo",
  manifest: {
    author: "Baram",
    capabilities: [],
    dependencies: [],
    description: "a plugin that failed once",
    engines: { baram: "*" },
    id: "demo",
    license: "MIT",
    main: "index.mjs",
    name: "Demo",
    trust: "sandboxed",
    version: "1.0.0",
  },
  updatedAt: 0,
} as unknown as InstalledPlugin;

/** Render, switch to the Installed tab, and return the enable toggle. */
async function installedToggle() {
  render(<PluginMarketplace />);
  fireEvent.click(screen.getByRole("button", { name: /^Installed / }));
  return await screen.findByRole("checkbox");
}

describe("marketplace enable toggle (§260 3c-3)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_ENABLE_PLUGINS", "1");
    loadPlugin.mockReset().mockResolvedValue(undefined);
    unloadPlugin.mockReset().mockResolvedValue(undefined);
    usePluginStore.setState({
      installedPlugins: { demo: disabledPlugin },
      pluginErrors: { demo: "Sandbox activate timed out for demo" },
      updateAvailable: {},
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs(); // siblings all unstub; vitest does not do it for us
  });

  it("clears the stale error when enabling succeeds", async () => {
    fireEvent.click(await installedToggle());
    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo ?? null).toBeNull(),
    );
    expect(loadPlugin).toHaveBeenCalledWith("/p/demo", disabledPlugin.manifest);
  });

  it("records the error and rolls back `enabled` when the load fails", async () => {
    // The other half: clearing must be tied to success. A failed enable must leave
    // the plugin off, not silently on with no error.
    loadPlugin.mockRejectedValue(new Error("activate timed out"));
    fireEvent.click(await installedToggle());
    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain(
        "activate timed out",
      ),
    );
    expect(usePluginStore.getState().installedPlugins.demo?.enabled).toBe(
      false,
    );
  });

  it("ignores a second click while the first is still in flight", async () => {
    // §260 3c-3 review (M5): the store flips immediately, so a double-click used to
    // read the already-flipped value and call `unloadPlugin` mid-load. That unload
    // early-returned (nothing in `loaded` yet), the load then completed, and the
    // session ended with a running, GRANTED sandbox the UI showed as disabled — and
    // nothing would tear it down, because a later toggle-on early-returns too.
    let finishLoad: () => void = () => {};
    loadPlugin.mockReturnValue(
      new Promise<void>((resolve) => {
        finishLoad = resolve;
      }),
    );
    const toggle = await installedToggle();
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(unloadPlugin).not.toHaveBeenCalled();
    expect(loadPlugin).toHaveBeenCalledTimes(1);
    finishLoad();
    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo ?? null).toBeNull(),
    );
  });

  it("does not leave an unhandled rejection when disabling fails", async () => {
    // `unloadPlugin` awaits sandbox teardown, so it can reject; it used to be a
    // floating promise. A rejection must surface as the plugin's error instead.
    usePluginStore.setState({
      installedPlugins: { demo: { ...disabledPlugin, enabled: true } },
      pluginErrors: {},
    });
    unloadPlugin.mockRejectedValue(new Error("teardown wedged"));
    fireEvent.click(await installedToggle());
    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain(
        "teardown wedged",
      ),
    );
  });
});

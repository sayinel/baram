// §260 Phase 3c-3 — a load that SUCCEEDS must clear the previous failure.
//
// Found by the live smoke: the dev-plugin card showed "Sandbox activate timed out"
// while the plugin was demonstrably working (its command ran, its brokered ops
// answered). Nothing ever cleared `pluginErrors`, and the store is persisted, so one
// transient failure described a healthy plugin indefinitely — and it is exactly the
// message a maintainer would chase.
import type { InstalledPlugin } from "../types";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isLoaded: vi.fn().mockReturnValue(false),
  liveSandboxIds: vi.fn().mockReturnValue([]),
  loadPlugin: vi.fn().mockResolvedValue(undefined),
  pluginListDev: vi.fn().mockResolvedValue([]),
  pluginSandboxDeregister: vi.fn().mockResolvedValue(undefined),
  pluginPrepareScopes: vi.fn().mockResolvedValue(undefined),
  reloadPlugin: vi.fn().mockResolvedValue(undefined),
  unloadAll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../plugin-loader", () => ({
  pluginLoader: {
    isLoaded: mocks.isLoaded,
    liveSandboxIds: mocks.liveSandboxIds,
    loadPlugin: mocks.loadPlugin,
    reloadPlugin: mocks.reloadPlugin,
    unloadAll: mocks.unloadAll,
  },
}));

vi.mock("../../ipc/plugin-invoke", () => ({
  pluginListDev: mocks.pluginListDev,
  pluginSandboxDeregister: mocks.pluginSandboxDeregister,
  pluginPrepareScopes: mocks.pluginPrepareScopes,
  toInstalledDevPlugin: (r: unknown) => r,
}));

import { usePluginStore } from "../../stores/system/plugin";
import { initializePlugins } from "../plugin-lifecycle";

const devPlugin = {
  checksum: "",
  enabled: true,
  installedAt: 0,
  installPath: "/dev/smoke",
  isDev: true,
  manifest: {
    author: "Baram",
    capabilities: [],
    dependencies: [],
    description: "fixture",
    engines: { baram: "*" },
    id: "smoke",
    license: "Apache-2.0",
    main: "index.mjs",
    name: "Smoke",
    trust: "sandboxed",
    version: "1.0.0",
  },
  updatedAt: 0,
} as unknown as InstalledPlugin;

describe("dev plugin error lifecycle (§260 3c-3)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_ENABLE_PLUGINS", "1");
    usePluginStore.setState({ installedPlugins: {}, pluginErrors: {} });
    mocks.loadPlugin.mockClear().mockResolvedValue(undefined);
    mocks.isLoaded.mockReturnValue(false);
    mocks.pluginListDev.mockResolvedValue([devPlugin]);
  });

  afterEach(() => {
    vi.unstubAllEnvs(); // siblings all unstub; vitest does not do it for us
  });

  it("clears a stale error once the plugin loads successfully", async () => {
    usePluginStore.getState().setError("smoke", "Sandbox activate timed out");
    await initializePlugins();
    expect(mocks.loadPlugin).toHaveBeenCalled();
    expect(usePluginStore.getState().pluginErrors.smoke ?? null).toBeNull();
  });

  it("keeps the error when the load fails", async () => {
    // The other half: clearing must be tied to success, not merely to trying.
    mocks.loadPlugin.mockRejectedValue(new Error("activate timed out"));
    await initializePlugins();
    expect(usePluginStore.getState().pluginErrors.smoke).toContain(
      "activate timed out",
    );
  });
});

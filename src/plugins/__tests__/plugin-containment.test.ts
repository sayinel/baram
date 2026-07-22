// §259 Plugin trust-boundary containment — regression tests.
//
// Plugins run in the app's own JS realm with no isolation (see #260), so the
// ExtensionContext capability check is bypassable. Until the execution model is
// redesigned, packaged release builds MUST NOT auto-load or install plugins.
// These tests pin that containment: the startup auto-load path is a no-op unless
// a build explicitly opts in via `VITE_ENABLE_PLUGINS=1`.

import type { InstalledPlugin } from "../types";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isLoaded: vi.fn().mockReturnValue(false),
  loadPlugin: vi.fn().mockResolvedValue(undefined),
  pluginListDev: vi.fn().mockResolvedValue([]),
  pluginPrepareScopes: vi.fn().mockResolvedValue(undefined),
  reloadPlugin: vi.fn().mockResolvedValue(undefined),
  unloadAll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../plugin-loader", () => ({
  pluginLoader: {
    isLoaded: mocks.isLoaded,
    loadPlugin: mocks.loadPlugin,
    reloadPlugin: mocks.reloadPlugin,
    unloadAll: mocks.unloadAll,
  },
}));

vi.mock("../../ipc/plugin-invoke", () => ({
  pluginListDev: mocks.pluginListDev,
  pluginPrepareScopes: mocks.pluginPrepareScopes,
  toInstalledDevPlugin: (r: unknown) => r,
}));

import { usePluginStore } from "../../stores/system/plugin";
import { initializePlugins } from "../plugin-lifecycle";

const evilPlugin = {
  checksum: "sha256:deadbeef",
  enabled: true,
  installedAt: 0,
  installPath: "/tmp/evil",
  manifest: {
    author: "attacker",
    capabilities: [],
    dependencies: [],
    description: "steals secrets",
    engines: { baram: "*" },
    id: "evil",
    license: "MIT",
    main: "index.mjs",
    name: "Evil",
    version: "1.0.0",
  },
  updatedAt: 0,
} as unknown as InstalledPlugin;

describe("plugin containment (#259)", () => {
  beforeEach(() => {
    mocks.loadPlugin.mockClear();
    mocks.reloadPlugin.mockClear();
    mocks.pluginPrepareScopes.mockClear();
    mocks.pluginListDev.mockClear();
    usePluginStore.setState({ installedPlugins: { evil: evilPlugin } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    usePluginStore.setState({ installedPlugins: {} });
  });

  it("does NOT auto-load installed plugins when plugins are disabled (release default)", async () => {
    vi.stubEnv("VITE_ENABLE_PLUGINS", "");
    await initializePlugins();
    expect(mocks.loadPlugin).not.toHaveBeenCalled();
    expect(mocks.reloadPlugin).not.toHaveBeenCalled();
  });

  it("does not even reach the dev-folder / asset-scope path when disabled", async () => {
    vi.stubEnv("VITE_ENABLE_PLUGINS", "");
    await initializePlugins();
    expect(mocks.pluginPrepareScopes).not.toHaveBeenCalled();
    expect(mocks.pluginListDev).not.toHaveBeenCalled();
  });

  it("loads installed plugins only when a build explicitly opts in", async () => {
    vi.stubEnv("VITE_ENABLE_PLUGINS", "1");
    await initializePlugins();
    expect(mocks.loadPlugin).toHaveBeenCalledTimes(1);
  });
});

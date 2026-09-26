// §379 — the dev folders Rust lists, loaded the way this build allows.
import type { DevModeSnapshot } from "../../ipc/plugin-invoke";
import type { PluginConsent, PluginManifest } from "../types";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isLoaded: vi.fn().mockReturnValue(false),
  loadPlugin: vi.fn().mockResolvedValue(undefined),
  pluginListDev: vi.fn(),
  reloadPlugin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../plugin-loader", () => ({
  pluginLoader: {
    isLoaded: mocks.isLoaded,
    loadPlugin: mocks.loadPlugin,
    reloadPlugin: mocks.reloadPlugin,
  },
}));
// Spread, so the real `toInstalledDevPlugin` mapper runs; only the invoke is replaced.
vi.mock("../../ipc/plugin-invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/plugin-invoke")>()),
  pluginListDev: mocks.pluginListDev,
}));

import en from "../../i18n/en.json";
import { useSettingsStore } from "../../stores/settings/store";
import { usePluginStore } from "../../stores/system/plugin";
import { devConsentToAsk, refreshDevPlugins } from "../dev-plugins";

const MANIFEST: PluginManifest = {
  author: "",
  capabilities: ["statusbar"],
  description: "",
  engines: { baram: ">=0.2.0" },
  id: "dev-x",
  license: "MIT",
  main: "index.mjs",
  name: "Dev X",
  trust: "sandboxed",
  version: "1.0.0",
};

const APPROVED: PluginConsent = {
  capabilities: ["statusbar"],
  trust: "sandboxed",
};

function snapshot(
  over: Partial<DevModeSnapshot>,
  row: Partial<DevModeSnapshot["folders"][number]> = {},
): DevModeSnapshot {
  return {
    active: true,
    devBuild: false,
    enabled: true,
    folders: [
      {
        consent: null,
        error: null,
        ids: [],
        path: "/dev/dev-x",
        plugin: {
          checksum: "",
          install_path: "/dev/dev-x",
          is_dev: true,
          manifest: MANIFEST,
        },
        ...row,
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isLoaded.mockReturnValue(false);
  useSettingsStore.setState({ locale: "en" });
  usePluginStore.setState({
    devFolderIssues: [],
    devPlugins: {},
    pluginErrors: {},
  });
});

describe("refreshDevPlugins (§379)", () => {
  it("records what Rust said about developer mode", async () => {
    mocks.pluginListDev.mockResolvedValue(
      snapshot({ active: true, devBuild: true, enabled: false }),
    );
    await refreshDevPlugins();
    expect(usePluginStore.getState().devMode).toEqual({
      active: true,
      devBuild: true,
      enabled: false,
    });
  });

  it("loads a dev build's folder without asking, as before §379", async () => {
    mocks.pluginListDev.mockResolvedValue(snapshot({ devBuild: true }));
    await refreshDevPlugins();
    expect(mocks.loadPlugin).toHaveBeenCalledWith("/dev/dev-x", MANIFEST, {
      devConsent: undefined,
      isDev: true,
    });
  });

  it("does not load a release folder whose permissions were never approved", async () => {
    mocks.pluginListDev.mockResolvedValue(snapshot({}));
    await refreshDevPlugins();
    expect(mocks.loadPlugin).not.toHaveBeenCalled();
    expect(usePluginStore.getState().pluginErrors["dev-x"]).toBe(
      en["plugin.dev.error.consentNeeded"],
    );
    // Still listed, so Reload (which asks) and Remove stay reachable.
    expect(usePluginStore.getState().devPlugins["dev-x"]?.installPath).toBe(
      "/dev/dev-x",
    );
  });

  it("loads a release folder under the consent Rust recorded", async () => {
    mocks.pluginListDev.mockResolvedValue(snapshot({}, { consent: APPROVED }));
    await refreshDevPlugins();
    expect(mocks.loadPlugin).toHaveBeenCalledWith("/dev/dev-x", MANIFEST, {
      devConsent: APPROVED,
      isDev: true,
    });
    expect(usePluginStore.getState().pluginErrors["dev-x"] ?? null).toBeNull();
  });

  it("does not load a release folder that now asks for more than was approved", async () => {
    mocks.pluginListDev.mockResolvedValue(
      snapshot({}, { consent: { capabilities: [], trust: "sandboxed" } }),
    );
    await refreshDevPlugins();
    expect(mocks.loadPlugin).not.toHaveBeenCalled();
    expect(usePluginStore.getState().pluginErrors["dev-x"]).toBe(
      en["plugin.dev.error.consentNeeded"],
    );
  });

  it("lists a folder Rust refused as an issue row, with its code", async () => {
    mocks.pluginListDev.mockResolvedValue(
      snapshot({}, { error: "DEV_PLUGIN_NOT_SANDBOXED", plugin: null }),
    );
    await refreshDevPlugins();
    expect(usePluginStore.getState().devFolderIssues).toEqual([
      { error: "DEV_PLUGIN_NOT_SANDBOXED", ids: [], path: "/dev/dev-x" },
    ]);
    expect(usePluginStore.getState().devPlugins).toEqual({});
    expect(mocks.loadPlugin).not.toHaveBeenCalled();
  });
});

describe("devConsentToAsk (§379 F2)", () => {
  it("never asks in a dev build", () => {
    expect(devConsentToAsk(true, null, MANIFEST)).toBeNull();
  });

  it("asks in a release build when nothing was approved", () => {
    expect(devConsentToAsk(false, null, MANIFEST)).toEqual(APPROVED);
  });

  it("does not ask again for what was approved — a readonly narrowing included", () => {
    expect(devConsentToAsk(false, APPROVED, MANIFEST)).toBeNull();
    expect(
      devConsentToAsk(
        false,
        { capabilities: ["files"], trust: "sandboxed" },
        { ...MANIFEST, capabilities: ["files:readonly"] },
      ),
    ).toBeNull();
  });

  it("leaves a manifest with no tier to the loader's schema refusal", () => {
    expect(
      devConsentToAsk(false, null, { ...MANIFEST, trust: undefined as never }),
    ).toBeNull();
  });
});

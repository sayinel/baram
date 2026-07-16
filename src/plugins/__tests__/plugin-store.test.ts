import type { InstalledPlugin } from "../types";

// §69 Plugin Store state transition tests
import { beforeEach, describe, expect, it, test } from "vitest";

import { usePluginStore } from "../../stores/system/plugin";

function makePlugin(id: string, version = "1.0.0"): InstalledPlugin {
  return {
    manifest: {
      id,
      name: `Plugin ${id}`,
      description: "Test plugin",
      version,
      author: "Test",
      license: "MIT",
      main: "index.mjs",
      engines: { baram: ">=0.2.0" },
      capabilities: ["editor:readonly"],
    },
    installPath: `/test/plugins/${id}`,
    enabled: true,
    installedAt: Date.now(),
    updatedAt: Date.now(),
    checksum: "abc123",
  };
}

describe("usePluginStore", () => {
  beforeEach(() => {
    // Reset store state
    usePluginStore.setState({
      installedPlugins: {},
      pluginSettings: {},
      pluginErrors: {},
      registryCache: null,
      registryCacheTime: 0,
      updateAvailable: {},
      installing: {},
    });
  });

  describe("addPlugin / removePlugin", () => {
    test("addPlugin adds to installedPlugins", () => {
      const plugin = makePlugin("test-plugin");
      usePluginStore.getState().addPlugin(plugin);
      expect(
        usePluginStore.getState().installedPlugins["test-plugin"],
      ).toBeDefined();
      expect(
        usePluginStore.getState().installedPlugins["test-plugin"].manifest.name,
      ).toBe("Plugin test-plugin");
    });

    test("removePlugin removes from installedPlugins", () => {
      const plugin = makePlugin("test-plugin");
      usePluginStore.getState().addPlugin(plugin);
      usePluginStore.getState().removePlugin("test-plugin");
      expect(
        usePluginStore.getState().installedPlugins["test-plugin"],
      ).toBeUndefined();
    });

    test("removePlugin also cleans up settings and errors", () => {
      const plugin = makePlugin("test-plugin");
      usePluginStore.getState().addPlugin(plugin);
      usePluginStore.getState().setPluginSetting("test-plugin", "key", "value");
      usePluginStore.getState().setError("test-plugin", "some error");

      usePluginStore.getState().removePlugin("test-plugin");
      expect(
        usePluginStore.getState().pluginSettings["test-plugin"],
      ).toBeUndefined();
      expect(
        usePluginStore.getState().pluginErrors["test-plugin"],
      ).toBeUndefined();
    });
  });

  describe("setEnabled", () => {
    test("toggles enabled state", () => {
      const plugin = makePlugin("test-plugin");
      usePluginStore.getState().addPlugin(plugin);
      expect(
        usePluginStore.getState().installedPlugins["test-plugin"].enabled,
      ).toBe(true);

      usePluginStore.getState().setEnabled("test-plugin", false);
      expect(
        usePluginStore.getState().installedPlugins["test-plugin"].enabled,
      ).toBe(false);

      usePluginStore.getState().setEnabled("test-plugin", true);
      expect(
        usePluginStore.getState().installedPlugins["test-plugin"].enabled,
      ).toBe(true);
    });

    test("no-ops for non-existent plugin", () => {
      const before = usePluginStore.getState().installedPlugins;
      usePluginStore.getState().setEnabled("nonexistent", true);
      expect(usePluginStore.getState().installedPlugins).toBe(before);
    });
  });

  describe("setError / clearError", () => {
    test("sets error for plugin", () => {
      usePluginStore.getState().setError("test-plugin", "activation failed");
      expect(usePluginStore.getState().pluginErrors["test-plugin"]).toBe(
        "activation failed",
      );
    });

    test("clears error with null", () => {
      usePluginStore.getState().setError("test-plugin", "error");
      usePluginStore.getState().setError("test-plugin", null);
      expect(
        usePluginStore.getState().pluginErrors["test-plugin"],
      ).toBeUndefined();
    });
  });

  describe("installing state", () => {
    test("tracks installing status", () => {
      usePluginStore.getState().setInstalling("test-plugin", true);
      expect(usePluginStore.getState().installing["test-plugin"]).toBe(true);

      usePluginStore.getState().setInstalling("test-plugin", false);
      expect(
        usePluginStore.getState().installing["test-plugin"],
      ).toBeUndefined();
    });
  });

  describe("updatePluginVersion", () => {
    test("updates version and checksum", () => {
      const plugin = makePlugin("test-plugin", "1.0.0");
      usePluginStore.getState().addPlugin(plugin);

      usePluginStore
        .getState()
        .updatePluginVersion("test-plugin", "2.0.0", "newchecksum");
      const updated = usePluginStore.getState().installedPlugins["test-plugin"];
      expect(updated.manifest.version).toBe("2.0.0");
      expect(updated.checksum).toBe("newchecksum");
      expect(updated.updatedAt).toBeGreaterThan(0);
    });

    test("no-ops for non-existent plugin", () => {
      const before = usePluginStore.getState().installedPlugins;
      usePluginStore
        .getState()
        .updatePluginVersion("nonexistent", "2.0.0", "abc");
      expect(usePluginStore.getState().installedPlugins).toBe(before);
    });
  });

  describe("update availability", () => {
    test("tracks available updates", () => {
      usePluginStore.getState().setUpdateAvailable("test-plugin", "2.0.0");
      expect(usePluginStore.getState().updateAvailable["test-plugin"]).toBe(
        "2.0.0",
      );
    });

    test("clears update availability", () => {
      usePluginStore.getState().setUpdateAvailable("test-plugin", "2.0.0");
      usePluginStore.getState().clearUpdateAvailable("test-plugin");
      expect(
        usePluginStore.getState().updateAvailable["test-plugin"],
      ).toBeUndefined();
    });
  });

  describe("plugin settings", () => {
    test("sets and gets plugin settings", () => {
      usePluginStore
        .getState()
        .setPluginSetting("test-plugin", "theme", "dark");
      usePluginStore.getState().setPluginSetting("test-plugin", "fontSize", 14);

      const settings = usePluginStore
        .getState()
        .getPluginSettings("test-plugin");
      expect(settings).toEqual({ theme: "dark", fontSize: 14 });
    });

    test("returns empty object for unknown plugin", () => {
      const settings = usePluginStore
        .getState()
        .getPluginSettings("nonexistent");
      expect(settings).toEqual({});
    });
  });

  describe("registry cache", () => {
    test("stores registry cache with timestamp", () => {
      const index = { plugins: [], updatedAt: "2024-01-01" };
      usePluginStore.getState().setRegistryCache(index);
      expect(usePluginStore.getState().registryCache).toEqual(index);
      expect(usePluginStore.getState().registryCacheTime).toBeGreaterThan(0);
    });
  });

  describe("registry URL", () => {
    test("has default registry URL", () => {
      expect(usePluginStore.getState().registryUrl).toBe(
        "https://sayinel.github.io/baram-plugins/index.json",
      );
    });

    test("allows custom registry URL", () => {
      usePluginStore
        .getState()
        .setRegistryUrl("https://custom-registry.example.com/index.json");
      expect(usePluginStore.getState().registryUrl).toBe(
        "https://custom-registry.example.com/index.json",
      );
    });
  });
});

function devPlugin(id: string): InstalledPlugin {
  return {
    checksum: "",
    enabled: true,
    installedAt: 0,
    installPath: `/dev/${id}`,
    isDev: true,
    updatedAt: 0,
    manifest: {
      id,
      name: id,
      description: "",
      version: "1.0.0",
      author: "",
      license: "MIT",
      main: "index.mjs",
      engines: { baram: ">=0.2.0" },
      capabilities: [],
    },
  };
}

describe("plugin store dev plugins", () => {
  it("sets, adds, and removes dev plugins without persisting", () => {
    usePluginStore.getState().setDevPlugins([devPlugin("a"), devPlugin("b")]);
    expect(Object.keys(usePluginStore.getState().devPlugins)).toEqual([
      "a",
      "b",
    ]);
    usePluginStore.getState().removeDevPlugin("a");
    expect(Object.keys(usePluginStore.getState().devPlugins)).toEqual(["b"]);
    usePluginStore.getState().addDevPlugin(devPlugin("c"));
    expect(Object.keys(usePluginStore.getState().devPlugins).sort()).toEqual([
      "b",
      "c",
    ]);
  });
});

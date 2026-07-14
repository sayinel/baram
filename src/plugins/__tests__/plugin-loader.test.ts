import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import type { ExtensionContext, PluginManifest } from "../types";

import { PluginLoader } from "../plugin-loader";
import { usePluginUIStore } from "../plugin-ui-store";

const manifest: PluginManifest = {
  id: "dev-x",
  name: "Dev X",
  description: "test",
  version: "1.0.0",
  author: "test",
  license: "MIT",
  main: "index.mjs",
  engines: { baram: ">=0.2.0" },
  capabilities: ["commands"],
};

describe("PluginLoader.reloadPlugin", () => {
  it("unloads then reloads with a cache-busted url", async () => {
    const urls: string[] = [];
    let activateCount = 0;
    let deactivateCount = 0;
    const importer = vi.fn(async (url: string) => {
      urls.push(url);
      return {
        activate: () => {
          activateCount++;
        },
        deactivate: () => {
          deactivateCount++;
        },
      };
    });
    const loader = new PluginLoader(importer);

    await loader.loadPlugin("/dev/dev-x", manifest);
    await loader.reloadPlugin("/dev/dev-x", manifest);

    expect(activateCount).toBe(2); // loaded twice
    expect(deactivateCount).toBe(1); // unloaded once between
    expect(urls).toHaveLength(2);
    expect(urls[0]).not.toBe(urls[1]); // cache-busted
    expect(urls[1]).toContain("?v=");
  });
});

describe("PluginLoader unload auto-cleanup (§69 Phase B)", () => {
  beforeEach(() => {
    usePluginUIStore.setState({ statusBarItems: [] });
    document.head
      .querySelectorAll("style[data-baram-plugin]")
      .forEach((n) => n.remove());
  });

  it("disposes and sweeps plugin-registered UI (status-bar item + style) on unload", async () => {
    const uiManifest: PluginManifest = {
      ...manifest,
      capabilities: ["statusbar"],
    };
    const importer = vi.fn(async () => ({
      activate: (context: ExtensionContext) => {
        context.ui.showStatusBarItem("hi", "left");
        context.ui.addStyle(".plugin-x { color: red }");
      },
    }));
    const loader = new PluginLoader(importer);

    await loader.loadPlugin("/dev/dev-x", uiManifest);

    // Registered by activate()
    expect(usePluginUIStore.getState().statusBarItems).toHaveLength(1);
    expect(
      document.head.querySelector('style[data-baram-plugin="dev-x"]'),
    ).not.toBeNull();

    await loader.unloadPlugin("dev-x");

    // Disposed + swept on unload
    expect(usePluginUIStore.getState().statusBarItems).toHaveLength(0);
    expect(
      document.head.querySelector('style[data-baram-plugin="dev-x"]'),
    ).toBeNull();
  });
});

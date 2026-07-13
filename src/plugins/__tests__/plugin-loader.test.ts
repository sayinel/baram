import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import type { PluginManifest } from "../types";

import { PluginLoader } from "../plugin-loader";

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

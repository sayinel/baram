import type { PluginManifest } from "../types";

import { beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.fn(async () => "value");
const write = vi.fn(async () => {});
const list = vi.fn(async () => ["a", "b"]);
const remove = vi.fn(async () => {});
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginStorageRead: (...a: unknown[]) => read(...(a as [])),
  pluginStorageWrite: (...a: unknown[]) => write(...(a as [])),
  pluginStorageList: (...a: unknown[]) => list(...(a as [])),
  pluginStorageRemove: (...a: unknown[]) => remove(...(a as [])),
}));

import { createExtensionContext } from "../extension-context";

function mf(caps: string[]): PluginManifest {
  return {
    id: "store-plugin",
    name: "Store",
    description: "",
    version: "1.0.0",
    author: "",
    license: "MIT",
    main: "index.mjs",
    engines: { baram: ">=0.2.0" },
    capabilities: caps as PluginManifest["capabilities"],
  };
}

describe("ExtensionContext storage API", () => {
  beforeEach(() => {
    read.mockClear();
    write.mockClear();
    list.mockClear();
    remove.mockClear();
  });

  it("denies storage without the 'storage' capability", () => {
    const ctx = createExtensionContext(mf(["commands"]), "/p");
    expect(() => ctx.storage.read("k")).toThrow(/storage/i);
  });

  it("read/write/list/remove pass the pluginId through to the wrappers", async () => {
    const ctx = createExtensionContext(mf(["storage"]), "/p");
    await expect(ctx.storage.read("k")).resolves.toBe("value");
    expect(read).toHaveBeenCalledWith("store-plugin", "k");
    await ctx.storage.write("k", "v");
    expect(write).toHaveBeenCalledWith("store-plugin", "k", "v");
    await expect(ctx.storage.list()).resolves.toEqual(["a", "b"]);
    expect(list).toHaveBeenCalledWith("store-plugin");
    await ctx.storage.remove("k");
    expect(remove).toHaveBeenCalledWith("store-plugin", "k");
  });
});

// §394 plan 0125 P10 — a trusted load claims its declared languages before `activate`; a failed
// activate gives them back, and an unload does.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import type { ExtensionContext, PluginManifest } from "../types";

import { PluginLoader } from "../plugin-loader";
import {
  __resetCodeBlockRegistry,
  codeBlockRendererFor,
} from "../rendered/code-block-registry";
import { claimCodeBlocks } from "../rendered/code-blocks-api";

const base: PluginManifest = {
  author: "t",
  capabilities: ["codeblocks"],
  contributions: { codeBlocks: [{ lang: "x" }] },
  description: "t",
  engines: { baram: ">=0.2.0" },
  id: "a",
  license: "MIT",
  main: "index.mjs",
  name: "A",
  trust: "trusted",
  version: "1.0.0",
};

afterEach(() => __resetCodeBlockRegistry());

describe("PluginLoader and code block languages", () => {
  /** What fails this: claims made by `createExtensionContext` left behind when `activate` throws —
   *  the language would stay held by a plugin that is not running. The pair: an unload of a
   *  running plugin releases too. */
  it("gives the languages back when activate throws, and on unload", async () => {
    const failing = new PluginLoader(async () => ({
      activate: () => {
        throw new Error("boom");
      },
    }));
    await expect(failing.loadPlugin("/p/a", base)).rejects.toThrow("boom");
    expect(claimCodeBlocks({ ...base, id: "b", name: "B" }, "trusted")).toEqual(
      [{ drawnBy: null, lang: "x" }],
    );
    __resetCodeBlockRegistry();

    const working = new PluginLoader(async () => ({
      activate: (ctx: ExtensionContext) => {
        ctx.codeBlocks.register("x", () => ({ html: "<p>x</p>" }));
      },
    }));
    await working.loadPlugin("/p/a", base);
    expect(codeBlockRendererFor("x")?.pluginId).toBe("a");
    await working.unloadPlugin("a");
    expect(codeBlockRendererFor("x")).toBeNull();
  });
});

import type { PluginManifest } from "../types";

import { beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.fn(async () => [] as unknown);
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginIndexRead: (...a: unknown[]) => read(...(a as [])),
}));

import { createExtensionContext } from "../extension-context";

function mf(caps: string[]): PluginManifest {
  return {
    id: "index-plugin",
    name: "Index",
    description: "",
    version: "1.0.0",
    author: "",
    license: "MIT",
    main: "index.mjs",
    engines: { baram: ">=0.2.0" },
    capabilities: caps as PluginManifest["capabilities"],
    trust: "trusted",
  };
}

// §393 — the trusted tier's `ctx.index` (spec 0072 §5.3): open with `files` or `files:readonly`
// (D3), a denied proxy otherwise, and every read sent to `plugin_index_read` in the shape Rust's
// `IndexRead` takes (`plugin_index_cmd.rs`'s `plugin_index_read_is_dispatchable_by_name` reads
// the same tag on the other side).
describe("ExtensionContext index API (§393)", () => {
  beforeEach(() => {
    read.mockClear();
  });

  it("denies ctx.index without a files grant, naming files", () => {
    const ctx = createExtensionContext(mf(["commands"]), "/p");
    expect(() => ctx.index.tags()).toThrow(
      /"files" capability to access index\.tags/,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it.each([["files"], ["files:readonly"]])(
    "opens ctx.index with %s",
    async (cap) => {
      const ctx = createExtensionContext(mf([cap]), "/p");
      await ctx.index.backlinks("/v/a.md");
      expect(read).toHaveBeenCalledWith(undefined, {
        path: "/v/a.md",
        read: "backlinks",
      });
    },
  );

  it("sends each read in the command's shape, the context apart from the options", async () => {
    const ctx = createExtensionContext(mf(["files:readonly"]), "/p");
    await ctx.index.links("/v/a.md", { context: "c1" });
    await ctx.index.notesWithTag("#work");
    await ctx.index.search("needle", {
      context: "c1",
      folder: "/v/docs",
      word: true,
    });
    await ctx.index.tags({ context: "c1" });
    await ctx.index.tasks({ file: "/v/a.md", status: "done" });
    expect(read.mock.calls).toEqual([
      ["c1", { path: "/v/a.md", read: "links" }],
      [undefined, { read: "notesWithTag", tag: "#work" }],
      [
        "c1",
        {
          options: { folder: "/v/docs", word: true },
          query: "needle",
          read: "search",
        },
      ],
      ["c1", { read: "tags" }],
      [undefined, { file: "/v/a.md", read: "tasks", status: "done" }],
    ]);
  });
});

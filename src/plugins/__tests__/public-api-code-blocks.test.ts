// §394 — `public-api.ts` is a hand-written `export type {…}` barrel. A name left out still
// regenerates cleanly, so `types:plugin:check` stays green while authors cannot import the type
// (the §385 and §393 guards' reason). What fails this: one of these names missing from the barrel.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DTS = resolve(__dirname, "../../../examples/plugins/plugin-api.d.ts");

describe("the published plugin API names ctx.codeBlocks's types", () => {
  it.each([
    "CodeBlockInfo",
    "CodeBlockRenderer",
    "CodeBlocksAPI",
    "RenderedAction",
    "RenderedContent",
  ])("names %s", (name) => {
    expect(readFileSync(DTS, "utf8")).toMatch(new RegExp(`\\b${name}\\b`, "u"));
  });
});

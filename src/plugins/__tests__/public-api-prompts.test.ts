// §385 — `public-api.ts` is a hand-written `export type {…}` barrel. Leaving a name out still
// regenerates cleanly, so `types:plugin:check` stays green while authors cannot name the type.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DTS = resolve(__dirname, "../../../examples/plugins/plugin-api.d.ts");

describe("the published plugin API", () => {
  it.each([
    "InputBoxOptions",
    "PromptsAPI",
    "QuickPickItem",
    "QuickPickOptions",
  ])("names %s", (name) => {
    expect(readFileSync(DTS, "utf8")).toMatch(new RegExp(`\\b${name}\\b`, "u"));
  });
});

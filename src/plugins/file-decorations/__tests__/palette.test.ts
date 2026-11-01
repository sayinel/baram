// §395 spec 0074 D5 — every palette name is drawn with a semantic token that exists, so it follows the
// theme. What fails this: a typo in a token name (the colour would be invalid and the badge would fall
// back silently), or a name missing from the palette.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { colorValue, PALETTE, paletteColor } from "../palette";

const SEMANTIC = readFileSync(
  resolve(__dirname, "../../../styles/generated/semantic-light.css"),
  "utf8",
);

describe("palette (D5)", () => {
  it("names the eight colours of spec 0074 §4", () => {
    expect(Object.keys(PALETTE).sort()).toEqual([
      "accent",
      "blue",
      "gray",
      "green",
      "orange",
      "purple",
      "red",
      "yellow",
    ]);
  });

  it.each(Object.entries(PALETTE))(
    "draws %s with a token semantic-light.css defines",
    (_name, value) => {
      const token = /^var\((--color-[a-z-]+)\)$/u.exec(value)?.[1];
      expect(token, value).toBeDefined();
      expect(SEMANTIC).toMatch(new RegExp(`^\\s*${token}:`, "mu"));
    },
  );

  it("draws a hex as kept and a name as its token", () => {
    expect(colorValue("#a1b2c3")).toBe("#a1b2c3");
    expect(colorValue("orange")).toBe("var(--color-git-modified)");
  });

  /** `Object.hasOwn`, not `in`: an inherited key is not a palette name. */
  it("refuses an inherited key", () => {
    expect(paletteColor("toString")).toBeNull();
  });
});

// §385 spec 0061 §8 (badge) and §9 (well-formed answers).
import { describe, expect, it } from "vitest";

import {
  pluginSourceLabel,
  sliceWholeChars,
  wellFormedText,
} from "../plugin-text";

describe("pluginSourceLabel", () => {
  it("keeps an ordinary name, including one that claims to be the app", () => {
    // The badge PREFIX is what tells the user a plugin is asking (spec 0061 D8, §8); the name
    // itself is the author's and is shown as given, sanitised.
    expect(pluginSourceLabel("Baram", "p")).toBe("Baram");
  });

  it("caps at 32 characters and strips bidi overrides", () => {
    expect(pluginSourceLabel("x".repeat(40), "p")).toBe(`${"x".repeat(31)}…`);
    expect(pluginSourceLabel("ab\u202ecd", "p")).toBe("abcd");
  });

  /** §394 plan 0125 P30 — this label crosses to a sandbox as `drawnBy` in the `activate` frame, and
   *  Rust's `serde_json::Value` refuses a lone surrogate (the frame would vanish and activate would
   *  time out). What fails this: a cut by UTF-16 units — 30 × "x", "😀", "y" would keep `\uD83D`
   *  before the ellipsis. The pair is the row above: 40 × "x" keeps 31. */
  it("caps without splitting an emoji", () => {
    const label = pluginSourceLabel(`${"x".repeat(30)}😀y`, "p");
    expect(label).toBe(`${"x".repeat(30)}…`);
    expect(label).not.toMatch(/[\uD800-\uDFFF]/u);
  });

  it("falls back to the id — also capped — when the name sanitises to nothing", () => {
    expect(pluginSourceLabel(" \u200b ", "my-plugin")).toBe("my-plugin");
    expect(pluginSourceLabel(undefined, "i".repeat(40))).toBe(
      `${"i".repeat(31)}…`,
    );
  });
});

describe("wellFormedText", () => {
  it("replaces a lone surrogate and leaves a pair alone", () => {
    expect(wellFormedText("a\uD83Db")).toBe("a\uFFFDb");
    expect(wellFormedText("x\uDE00")).toBe("x\uFFFD");
    expect(wellFormedText("a😀b")).toBe("a😀b");
  });
});

describe("sliceWholeChars", () => {
  /** §394 plan 0125 P30 — what fails this: a plain `slice`, which ends `ab😀` cut at 3 on `\uD83D`.
   *  The pairs: a pair inside the cap stays, and text under the cap comes back as it is. */
  it("drops the first half of a pair the cut would split, and nothing else", () => {
    expect(sliceWholeChars("ab😀", 3)).toBe("ab");
    expect(sliceWholeChars("ab😀c", 4)).toBe("ab😀");
    expect(sliceWholeChars("ab", 5)).toBe("ab");
  });
});

// §385 spec 0061 §8 (badge) and §9 (well-formed answers).
import { describe, expect, it } from "vitest";

import { pluginSourceLabel, wellFormedText } from "../plugin-text";

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

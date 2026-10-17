// §5.6 searchPatternSource — the pattern the in-document find (`buildSearchRegex`)
// builds from a term.
import { describe, expect, it } from "vitest";

import { searchPatternSource } from "../search-pattern";

describe("§5.6 searchPatternSource", () => {
  // What fails this: the wrap without the group, `\ba|b\b`.
  it("holds every alternative of a regex between the word boundaries", () => {
    expect(searchPatternSource("a|b", true, true)).toBe("\\b(?:a|b)\\b");
  });

  // What fails this: a text term passed through unescaped — `a.b` would match `axb`.
  it("escapes a text term, inside the group too", () => {
    expect(searchPatternSource("a.b", false, false)).toBe("a\\.b");
    expect(searchPatternSource("a|b", false, true)).toBe("\\b(?:a\\|b)\\b");
  });

  // The group closes and opens the parentheses of `a)|(b`, so the wrapped source is
  // a valid expression (the pair below). What fails this: judging the wrapped
  // source instead of the term.
  it("refuses a regex that is no expression as typed, even where the wrap is one", () => {
    expect(() => new RegExp("\\b(?:a)|(b)\\b")).not.toThrow();
    expect(searchPatternSource("a)|(b", true, true)).toBeNull();
    expect(searchPatternSource("[x", true, false)).toBeNull();
  });
});

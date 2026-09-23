// §377 The picker's symbol sections are the table's `#` headings.
import { describe, expect, it } from "vitest";

import { SYMBOL_CATEGORIES, SYMBOLS } from "../plugins/symbol-data";

describe("symbol categories", () => {
  it("run in heading order, one run per heading", () => {
    // A category that came back later in the table would split its section in
    // two; a heading with no rows would leave an empty one.
    const runs = SYMBOLS.map((s) => s.category).filter(
      (category, i, all) => i === 0 || all[i - 1] !== category,
    );
    expect(runs).toEqual([...SYMBOL_CATEGORIES]);
  });

  it("hold the rows under each heading", () => {
    const count = (category: string) =>
      SYMBOLS.filter((s) => s.category === category).length;
    expect(SYMBOL_CATEGORIES.map(count)).toEqual([8, 26, 6, 22, 9, 8]);
  });

  it.each([
    ["→", "arrows"],
    ["≤", "math"],
    ["₩", "currency"],
    ["…", "punctuation"],
    ["✓", "marks"],
    ["©", "other"],
  ])("puts %s under %s", (char, category) => {
    expect(SYMBOLS.find((s) => s.char === char)?.category).toBe(category);
  });
});

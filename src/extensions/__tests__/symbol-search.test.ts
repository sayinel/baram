import { describe, expect, it } from "vitest";

import { type SymbolEntry, SYMBOLS } from "../plugins/symbol-data";
import { searchSymbols, SYMBOL_MENU_LIMIT } from "../plugins/symbol-search";

const SMILE: SymbolEntry = {
  char: "😄",
  en: "grinning face with smiling eyes",
  ko: "미소 짓는 눈으로 활짝 웃는 얼굴",
  keywords: ["grin", "smile", "웃음", "스마일"],
};

const chars = (query: string, emoji: null | readonly SymbolEntry[] = null) =>
  searchSymbols(query, emoji, "en").map((item) => item.char);

describe("searchSymbols", () => {
  it("finds arrows by an English prefix, in list order", () => {
    expect(chars("ar").slice(0, 4)).toEqual(["→", "←", "↑", "↓"]);
  });

  it("finds them by a Korean prefix too", () => {
    expect(chars("화살")[0]).toBe("→");
  });

  it("ranks an exact keyword above a prefix of another", () => {
    // `le` is ≤'s own keyword; `left arrow` only starts with it.
    expect(chars("le")[0]).toBe("≤");
  });

  it("ignores case", () => {
    expect(chars("ARROW")).toEqual(chars("arrow"));
  });

  it("matches a word inside a label, not only keywords", () => {
    // `pilcrow` is ¶'s label; no keyword spells it.
    expect(chars("pilc")).toEqual(["¶"]);
  });

  it("labels items in the interface language", () => {
    expect(searchSymbols("화살", null, "ko")[0].label).toBe("오른쪽 화살표");
    expect(searchSymbols("화살", null, "en")[0].label).toBe("right arrow");
  });

  it("stops at the limit", () => {
    expect(chars("ar")).toHaveLength(SYMBOL_MENU_LIMIT);
    expect(searchSymbols("ar", null, "en", 1)).toHaveLength(1);
  });

  it("searches emoji when they are loaded, after symbols of equal rank", () => {
    expect(chars("웃음")).toEqual([]);
    expect(chars("웃음", [SMILE])).toEqual(["😄"]);
  });

  it("returns nothing for a query nothing contains", () => {
    expect(chars("zzqq", [SMILE])).toEqual([]);
  });
});

describe("SYMBOLS", () => {
  it("has each character once", () => {
    const all = SYMBOLS.map((s) => s.char);
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps keywords lowercase, since the query is lowercased", () => {
    // An uppercase keyword could never match — the failure would be silent.
    for (const s of SYMBOLS) {
      for (const k of s.keywords) expect(k).toBe(k.toLowerCase());
    }
  });
});

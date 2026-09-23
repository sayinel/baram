import { describe, expect, it } from "vitest";

import { ensureEmojiLoaded, loadedEmoji } from "../plugins/emoji-data";
import { type SymbolEntry, SYMBOLS } from "../plugins/symbol-data";
import {
  hasSymbolMatch,
  searchSymbols,
  SYMBOL_MENU_LIMIT,
} from "../plugins/symbol-search";

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

describe("searchSymbols with the real emoji table", () => {
  async function emoji() {
    await ensureEmojiLoaded();
    const table = loadedEmoji();
    if (!table) throw new Error("emoji did not load");
    return table;
  }

  it("puts the arrow first for `ar`, not the flag whose region code it is", async () => {
    expect(chars("ar", await emoji())[0]).toBe("→");
  });

  it("ranks ❤️, whose label has the word `heart`, above 🥰, whose keyword only is", async () => {
    const all = searchSymbols("heart", await emoji(), "en", Infinity).map(
      (item) => item.char,
    );
    expect(all).toContain("❤️");
    expect(all.indexOf("❤️")).toBeLessThan(all.indexOf("🥰"));
  });

  // GitHub shortcodes (§376): the name a `:` typist already knows ranks first.
  it.each([
    ["heart", "❤️"],
    ["smile", "😄"],
    ["+1", "\u{1F44D}\u{FE0F}"], // 👍 as the table spells it, with VS16
    ["thumbsup", "\u{1F44D}\u{FE0F}"],
  ])(
    "puts the emoji whose GitHub shortcode is %j first",
    async (query, char) => {
      expect(chars(query, await emoji())[0]).toBe(char);
    },
  );

  it("finds an emoji by the start of a shortcode no keyword or label has", async () => {
    // `thumbsu` starts only `thumbsup`: 👍's label words are "thumbs" and "up".
    expect(chars("thumbsu", await emoji())[0]).toBe("\u{1F44D}\u{FE0F}");
  });

  it("still finds 🇰🇷 by its name in either language", async () => {
    const table = await emoji();
    expect(chars("korea", table)).toContain("🇰🇷");
    expect(chars("대한민국", table)).toContain("🇰🇷");
  });
});

describe("hasSymbolMatch", () => {
  const QUERIES = [
    "ar",
    "ARROW",
    "pilc",
    "웃음",
    "heart",
    "korea",
    "thumbsu",
    "zzqq",
    "",
  ];

  it.each(QUERIES)("agrees with searchSymbols on %j, symbols only", (query) => {
    expect(hasSymbolMatch(query, null)).toBe(chars(query).length > 0);
  });

  it.each(QUERIES)(
    "agrees with searchSymbols on %j, emoji loaded",
    async (query) => {
      await ensureEmojiLoaded();
      const table = loadedEmoji();
      expect(hasSymbolMatch(query, table)).toBe(chars(query, table).length > 0);
    },
  );

  it("sees an emoji-only match only once the table is given", () => {
    expect(hasSymbolMatch("웃음", null)).toBe(false);
    expect(hasSymbolMatch("웃음", [SMILE])).toBe(true);
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

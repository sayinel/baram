// §377 The picker's browsing view: recent picks, symbol headings, emoji groups.
import { describe, expect, it } from "vitest";

import { ensureEmojiLoaded, loadedEmoji } from "../plugins/emoji-data";
import { SYMBOL_CATEGORIES, SYMBOLS } from "../plugins/symbol-data";
import {
  buildSymbolSections,
  EMOJI_SECTIONS,
} from "../plugins/symbol-sections";

async function emoji() {
  await ensureEmojiLoaded();
  const table = loadedEmoji();
  if (!table) throw new Error("emoji did not load");
  return table;
}

describe("buildSymbolSections", () => {
  it("without recent picks or emoji: one section per symbol heading", () => {
    const ids = buildSymbolSections([], null, "en").map((s) => s.id);
    expect(ids).toEqual([...SYMBOL_CATEGORIES]);
  });

  it("labels cells in the interface language", () => {
    expect(buildSymbolSections([], null, "en")[0].items[0]).toEqual({
      char: "→",
      id: "→",
      label: "right arrow",
    });
    expect(buildSymbolSections([], null, "ko")[0].items[0].label).toBe(
      "오른쪽 화살표",
    );
  });

  it("adds the emoji groups after the symbols once emoji are loaded", async () => {
    const ids = buildSymbolSections([], await emoji(), "en").map((s) => s.id);
    expect(ids).toEqual([
      ...SYMBOL_CATEGORIES,
      ...EMOJI_SECTIONS.map((s) => s.id),
    ]);
  });

  it("shows every symbol and emoji exactly once outside the recent section", async () => {
    const table = await emoji();
    const chars = buildSymbolSections([], table, "en").flatMap((s) =>
      s.items.map((i) => i.char),
    );
    expect(chars).toHaveLength(SYMBOLS.length + table.length);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it("puts recent picks first, in their order, skipping characters it does not know", async () => {
    const [recent] = buildSymbolSections(
      ["😄", "not-a-symbol", "→"],
      await emoji(),
      "en",
    );
    expect(recent.id).toBe("recent");
    expect(recent.items.map((i) => i.char)).toEqual(["😄", "→"]);
  });

  it("has no recent section for an empty list, or for emoji not loaded yet", () => {
    expect(buildSymbolSections([], null, "en")[0].id).toBe("arrows");
    expect(buildSymbolSections(["😄"], null, "en")[0].id).toBe("arrows");
  });
});

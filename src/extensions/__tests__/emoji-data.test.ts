import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetEmojiCache,
  ensureEmojiLoaded,
  loadedEmoji,
} from "../plugins/emoji-data";
import { SYMBOLS } from "../plugins/symbol-data";

beforeEach(() => {
  _resetEmojiCache();
});

async function load() {
  await ensureEmojiLoaded();
  const emoji = loadedEmoji();
  if (!emoji) throw new Error("emoji did not load");
  return emoji;
}

describe("emoji data", () => {
  it("is not loaded until asked for", () => {
    expect(loadedEmoji()).toBeNull();
  });

  it("finds 😄 by its Korean keyword", async () => {
    const smile = (await load()).find((e) => e.char === "😄");
    expect(smile?.keywords).toContain("웃음");
    expect(smile?.en).toBe("grinning face with smiling eyes");
  });

  it("leaves out what cannot be typed alone or would render as tofu", async () => {
    const chars = new Set((await load()).map((e) => e.char));
    expect(chars.has("🇦")).toBe(false); // regional indicator — no group
    expect(chars.has("🏻")).toBe(false); // skin tone — component group
    expect(chars.has("🫨")).toBe(false); // shaking face — Emoji 15.0, above the cap
    expect(chars.has("🥲")).toBe(true); // smiling face with tear — 13.0, under it
  });

  it("does not repeat a curated symbol", async () => {
    const strip = (c: string) => c.replaceAll("️", "");
    const symbols = new Set(SYMBOLS.map((s) => s.char));
    for (const e of await load())
      expect(symbols.has(strip(e.char))).toBe(false);
  });

  it("carries GitHub shortcodes, every name of each", async () => {
    const table = await load();
    const find = (char: string) => table.find((e) => e.char === char);
    expect(find("😄")?.shortcodes).toEqual(["smile"]);
    expect(find("\u{1F44D}\u{FE0F}")?.shortcodes).toEqual(["+1", "thumbsup"]);
  });

  it("keeps shortcodes lowercase", async () => {
    for (const e of await load()) {
      for (const s of e.shortcodes ?? []) expect(s).toBe(s.toLowerCase());
    }
  });

  it("keeps keywords lowercase", async () => {
    for (const e of await load()) {
      for (const k of e.keywords) expect(k).toBe(k.toLowerCase());
    }
  });

  it("carries each emoji's emojibase group — every group but components (2)", async () => {
    // Rows are in emojibase order, which runs group by group.
    const groups = [...new Set((await load()).map((e) => e.group))];
    expect(groups).toEqual([0, 1, 3, 4, 5, 6, 7, 8, 9]);
  });

  it.each([
    ["😄", 0],
    ["👋", 1],
    ["🐵", 3],
    ["🍇", 4],
    ["🎃", 6],
    ["🏁", 9],
  ])("puts %s in group %i", async (char, group) => {
    expect((await load()).find((e) => e.char === char)?.group).toBe(group);
  });
});

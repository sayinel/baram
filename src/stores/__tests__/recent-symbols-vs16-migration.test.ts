// §377 v29 → v30 migration. emojibase-data 18 spells the emoji that default to emoji
// presentation without FE0F, and the symbol picker finds a recent symbol by its exact spelling,
// so a recent emoji picked under 17 (`⛔️`) would drop out of the "recent" section. The
// migration removes that FE0F.
//
// `FROM` is fixed at 29, for the reason `appearance-overrides-migration.test.ts` gives: a value
// derived from the current version would skip this `version < 30` gate once a later migration
// bumps the version again.
import type { EmojiEntry } from "../../extensions/plugins/emoji-data";

import { beforeAll, describe, expect, it } from "vitest";

import {
  ensureEmojiLoaded,
  loadedEmoji,
} from "../../extensions/plugins/emoji-data";
import { buildSymbolSections } from "../../extensions/plugins/symbol-sections";
import { useSettingsStore } from "../settings/store";

const FROM = 29;

function migrate(state: Record<string, unknown>): Record<string, unknown> {
  const fn = useSettingsStore.persist.getOptions().migrate!;
  return fn(state, FROM) as Record<string, unknown>;
}

const recentOf = (state: Record<string, unknown>): unknown =>
  state.recentSymbols;

// Spellings emojibase-data 17.0.0 gave these rows, as a recent list holds them.
const NO_ENTRY_17 = "\u{26D4}\u{FE0F}"; // ⛔️
const THUMBS_UP_17 = "\u{1F44D}\u{FE0F}"; // 👍️
const WATCH_17 = "\u{231A}\u{FE0F}"; // ⌚️

describe("recent symbols respelled for emojibase-data 18 (§377)", () => {
  let table: readonly EmojiEntry[] = [];
  beforeAll(async () => {
    await ensureEmojiLoaded();
    table = loadedEmoji() ?? [];
  });

  const recentSection = (recent: readonly string[]): string[] =>
    buildSymbolSections(recent, table, "en")
      .find((section) => section.id === "recent")
      ?.items.map((item) => item.char) ?? [];

  // What turns this red: leaving the spelling — the picker finds no row for it, which the
  // first assertion shows on the list as 17 left it.
  it("brings a recent emoji picked under emojibase-data 17 back to the recent section", () => {
    const before = [NO_ENTRY_17, THUMBS_UP_17, WATCH_17];
    expect(recentSection(before)).toEqual([]);
    const after = recentOf(migrate({ recentSymbols: before })) as string[];
    expect(recentSection(after)).toEqual(["\u{26D4}", "\u{1F44D}", "\u{231A}"]);
  });

  // What turns this red: removing every FE0F — ❤️ (U+2764 is text by default) and the
  // rainbow flag's ZWJ sequence would lose theirs, and the table spells both with it.
  it("keeps a FE0F that is not redundant", () => {
    const kept = [
      "\u{2764}\u{FE0F}",
      "\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}",
      "→",
    ];
    expect(recentOf(migrate({ recentSymbols: kept }))).toEqual(kept);
    expect(recentSection(kept)).toEqual(kept);
  });

  // What turns this red: keeping both spellings — the section would list ⛔ twice.
  it("keeps the most recent place when the respelling meets the new spelling", () => {
    expect(
      recentOf(migrate({ recentSymbols: ["\u{26D4}", "→", NO_ENTRY_17] })),
    ).toEqual(["\u{26D4}", "→"]);
    expect(
      recentOf(migrate({ recentSymbols: [NO_ENTRY_17, "→", "\u{26D4}"] })),
    ).toEqual(["\u{26D4}", "→"]);
  });

  // What turns this red: a table that spells a row with that FE0F again — the migration would
  // then move a recent entry away from the table's spelling.
  it("leaves every spelling of the current table as it is", () => {
    const all = table.map((entry) => entry.char);
    expect(all.length).toBeGreaterThan(0);
    expect(recentOf(migrate({ recentSymbols: all }))).toEqual(all);
  });

  it("leaves a store without recent symbols alone", () => {
    expect(recentOf(migrate({}))).toBeUndefined();
  });

  it("does not run again past its gate", () => {
    const current = useSettingsStore.persist.getOptions().version ?? 0;
    const fn = useSettingsStore.persist.getOptions().migrate!;
    const out = fn({ recentSymbols: [NO_ENTRY_17] }, current) as Record<
      string,
      unknown
    >;
    expect(out.recentSymbols).toEqual([NO_ENTRY_17]);
  });
});

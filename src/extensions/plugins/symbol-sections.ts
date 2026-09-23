// §377 The symbol picker's browsing view, as data: recent picks, the curated
// symbols under their table headings, then emoji by emojibase group. The
// picker (components/command/SymbolPicker.tsx) draws it; typing a search
// replaces it with one "results" section of `searchSymbols` output.
import type { EmojiEntry } from "./emoji-data";
import type { SymbolCategory, SymbolEntry } from "./symbol-data";

import { SYMBOL_CATEGORIES, SYMBOLS } from "./symbol-data";
import { type SymbolSuggestionItem, toSuggestionItem } from "./symbol-search";

export type EmojiSectionId =
  | "activities"
  | "animals"
  | "emojiSymbols"
  | "flags"
  | "food"
  | "objects"
  | "people"
  | "smileys"
  | "travel";

export interface SymbolSection {
  readonly id: SymbolSectionId;
  readonly items: readonly SymbolSuggestionItem[];
}

/** `results` is the picker's search view: one section, drawn without a heading. */
export type SymbolSectionId =
  "recent" | "results" | EmojiSectionId | SymbolCategory;

/**
 * emojibase group → section, in group order (emojibase-data 17.0.0
 * `messages.json`). Group 2, components, is not in the generated table.
 * Group 8 is emojibase's "symbols" — `emojiSymbols`, so it does not share a
 * name with the curated symbols.
 */
export const EMOJI_SECTIONS: readonly {
  readonly group: number;
  readonly id: EmojiSectionId;
}[] = [
  { group: 0, id: "smileys" },
  { group: 1, id: "people" },
  { group: 3, id: "animals" },
  { group: 4, id: "food" },
  { group: 5, id: "travel" },
  { group: 6, id: "activities" },
  { group: 7, id: "objects" },
  { group: 8, id: "emojiSymbols" },
  { group: 9, id: "flags" },
];

/**
 * The sections in picker order. A recent character the data does not have is
 * left out — dropped from the tables, or an emoji while the emoji table has
 * not loaded — and a recent list with nothing left has no section.
 */
export function buildSymbolSections(
  recent: readonly string[],
  emoji: null | readonly EmojiEntry[],
  locale: string,
): SymbolSection[] {
  const known = new Map<string, SymbolEntry>(
    [...SYMBOLS, ...(emoji ?? [])].map((entry) => [entry.char, entry]),
  );
  const sections: SymbolSection[] = [];

  const recentItems = recent.flatMap((char) => {
    const entry = known.get(char);
    return entry ? [toSuggestionItem(entry, locale)] : [];
  });
  if (recentItems.length > 0)
    sections.push({ id: "recent", items: recentItems });

  for (const category of SYMBOL_CATEGORIES) {
    sections.push({
      id: category,
      items: SYMBOLS.filter((s) => s.category === category).map((s) =>
        toSuggestionItem(s, locale),
      ),
    });
  }

  for (const { group, id } of EMOJI_SECTIONS) {
    const items = (emoji ?? [])
      .filter((e) => e.group === group)
      .map((e) => toSuggestionItem(e, locale));
    if (items.length > 0) sections.push({ id, items });
  }
  return sections;
}

// §376 Rank symbols and emoji for a `:` query.
//
// Synchronous on purpose: `shouldShow` (symbol-suggest.ts) runs inside the
// suggestion plugin's state `apply` and must know right there whether there is
// anything to show — an active suggestion with an empty menu still swallows Esc.
import type { SymbolEntry } from "./symbol-data";

import { SYMBOLS } from "./symbol-data";

export const SYMBOL_MENU_LIMIT = 8;

export interface SymbolSuggestionItem {
  char: string;
  /** The character itself — unique within one result list. */
  id: string;
  label: string;
}

/**
 * Rank of one entry for `q` (already lowercase); lower is better, -1 is no match.
 *
 * 0 — a whole GitHub shortcode (`heart` is ❤️'s)
 * 1 — a whole word of either label (`heart` in "red heart")
 * 2 — a whole keyword
 * 3 — the start of a keyword or of a shortcode
 * 4 — the start of a word of either label
 * 5 — anywhere inside a keyword, a shortcode or a label
 *
 * A shortcode names one emoji (no two rows of the generated table share one)
 * and is the name a `:` typist already knows from GitHub, so typing all of it
 * picks that emoji: `smile` is 😄's shortcode, while 23 other emoji have
 * "smile" as a keyword or a label word (emojibase-data 17.0.0). A shortcode's
 * start ranks with a keyword's start — it is a search term like one.
 * Label words come before keywords because a label names the entry while a
 * keyword only relates to it: `heart` is a keyword of 🥰 ("smiling face with
 * hearts") too. Words are split on spaces only, so "heart-eyes" is one word.
 */
function rank(entry: SymbolEntry, q: string): number {
  if (entry.shortcodes?.includes(q)) return 0;
  let best = -1;
  const consider = (r: number): void => {
    if (best === -1 || r < best) best = r;
  };
  for (const label of [entry.en.toLowerCase(), entry.ko]) {
    const words = label.split(" ");
    if (words.includes(q)) return 1;
    if (words.some((word) => word.startsWith(q))) consider(4);
    else if (label.includes(q)) consider(5);
  }
  for (const terms of [entry.keywords, entry.shortcodes ?? []]) {
    for (const term of terms) {
      if (term === q) consider(2);
      else if (term.startsWith(q)) consider(3);
      else if (term.includes(q)) consider(5);
    }
  }
  return best;
}

const normalize = (query: string): string =>
  query.normalize("NFC").toLowerCase();

/**
 * Whether `searchSymbols` would return anything for `query` — the same match,
 * but it stops at the first entry instead of ranking the whole pool. For
 * `shouldShow`, which runs on every transaction.
 */
export function hasSymbolMatch(
  query: string,
  emoji: null | readonly SymbolEntry[],
): boolean {
  const q = normalize(query);
  if (q === "") return false;
  const matches = (entry: SymbolEntry): boolean => rank(entry, q) !== -1;
  return SYMBOLS.some(matches) || (emoji?.some(matches) ?? false);
}

/**
 * Candidates for `query`, best rank first; within a rank, symbols before
 * emoji (when loaded), each group in its own order. English and Korean
 * keywords and labels are searched whatever the interface language; `locale`
 * only picks the label shown.
 */
export function searchSymbols(
  query: string,
  emoji: null | readonly SymbolEntry[],
  locale: string,
  limit = SYMBOL_MENU_LIMIT,
): SymbolSuggestionItem[] {
  const q = normalize(query);
  if (q === "") return [];

  const ranked: { entry: SymbolEntry; order: number; rank: number }[] = [];
  const pool = emoji ? [...SYMBOLS, ...emoji] : SYMBOLS;
  pool.forEach((entry, order) => {
    const r = rank(entry, q);
    if (r !== -1) ranked.push({ entry, order, rank: r });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);

  return ranked
    .slice(0, limit)
    .map(({ entry }) => toSuggestionItem(entry, locale));
}

/** An entry as a menu row or picker cell shows it — `locale` only picks the label. */
export function toSuggestionItem(
  entry: SymbolEntry,
  locale: string,
): SymbolSuggestionItem {
  return {
    char: entry.char,
    id: entry.char,
    label: locale === "ko" ? entry.ko : entry.en,
  };
}

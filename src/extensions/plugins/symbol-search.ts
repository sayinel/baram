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
 * 0 — a whole word of either label (`heart` in "red heart")
 * 1 — a whole keyword
 * 2 — the start of a keyword
 * 3 — the start of a word of either label
 * 4 — anywhere inside a keyword or a label
 *
 * Label words come first because a label names the entry while a keyword only
 * relates to it: `heart` is a keyword of 🥰 ("smiling face with hearts") too.
 * Words are split on spaces only, so "heart-eyes" is one word.
 */
function rank(entry: SymbolEntry, q: string): number {
  let best = -1;
  const consider = (r: number): void => {
    if (best === -1 || r < best) best = r;
  };
  for (const label of [entry.en.toLowerCase(), entry.ko]) {
    const words = label.split(" ");
    if (words.includes(q)) return 0;
    if (words.some((word) => word.startsWith(q))) consider(3);
    else if (label.includes(q)) consider(4);
  }
  for (const keyword of entry.keywords) {
    if (keyword === q) consider(1);
    else if (keyword.startsWith(q)) consider(2);
    else if (keyword.includes(q)) consider(4);
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

  return ranked.slice(0, limit).map(({ entry }) => ({
    char: entry.char,
    id: entry.char,
    label: locale === "ko" ? entry.ko : entry.en,
  }));
}

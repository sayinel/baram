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

/** Rank of one entry for `q` (already lowercase); lower is better, -1 is no match. */
function rank(entry: SymbolEntry, q: string): number {
  let best = -1;
  const consider = (r: number): void => {
    if (best === -1 || r < best) best = r;
  };
  for (const keyword of entry.keywords) {
    if (keyword === q) return 0;
    if (keyword.startsWith(q)) consider(1);
    else if (keyword.includes(q)) consider(3);
  }
  for (const label of [entry.en.toLowerCase(), entry.ko]) {
    if (label === q) return 0;
    if (label.split(" ").some((word) => word.startsWith(q))) consider(2);
    else if (label.includes(q)) consider(3);
  }
  return best;
}

/**
 * Candidates for `query`: symbols first, then emoji (when loaded), each group
 * in its own order within a rank. English and Korean keywords are searched
 * whatever the interface language; `locale` only picks the label shown.
 */
export function searchSymbols(
  query: string,
  emoji: null | readonly SymbolEntry[],
  locale: string,
  limit = SYMBOL_MENU_LIMIT,
): SymbolSuggestionItem[] {
  const q = query.normalize("NFC").toLowerCase();
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

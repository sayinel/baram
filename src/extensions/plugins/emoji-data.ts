// §376 Emoji for the `:` autocomplete, loaded on first use.
//
// Dynamic import keeps the ~304 KB table (90 KB gzip) off the startup path —
// Vite emits it as its own chunk. `symbol-suggest.ts` asks for it when a `:`
// query first gets a character, and re-evaluates the suggestion when it lands;
// the symbol picker asks when it opens (§377). Sizes are the generated JSON's,
// 304,270 bytes and 90,016 through `gzip` at its default level (emojibase-data
// 17.0.0, with GitHub shortcodes and groups).
import type { SymbolEntry } from "./symbol-data";

import { logger } from "../../utils/logger";

/**
 * An emoji as the app uses it. `group` is emojibase's — 0 smileys & emotion
 * through 9 flags; 2, components, is not in the table. The symbol picker shows
 * one section per group (spec 0056 §377).
 */
export interface EmojiEntry extends SymbolEntry {
  readonly group: number;
}

/** One generated row: `scripts/build-emoji-data.ts` writes exactly this shape. */
type EmojiRow = [
  char: string,
  en: string,
  ko: string,
  keywords: string[],
  shortcodes: string[],
  group: number,
];

let emoji: null | readonly EmojiEntry[] = null;
let loading: null | Promise<void> = null;

export function ensureEmojiLoaded(): Promise<void> {
  loading ??= import("./emoji-data.generated.json")
    .then((mod) => {
      emoji = (mod.default as EmojiRow[]).map(
        ([char, en, ko, keywords, shortcodes, group]) => ({
          char,
          en,
          group,
          keywords,
          ko,
          shortcodes,
        }),
      );
    })
    .catch((err: unknown) => {
      // Let the next query try again rather than leave emoji off for the session.
      loading = null;
      logger.error("[SymbolSuggest] Failed to load emoji data:", err);
    });
  return loading;
}

export function loadedEmoji(): null | readonly EmojiEntry[] {
  return emoji;
}

/** @internal — tests only: forget the loaded table. */
export function _resetEmojiCache(): void {
  emoji = null;
  loading = null;
}

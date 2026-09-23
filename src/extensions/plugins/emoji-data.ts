// §376 Emoji for the `:` autocomplete, loaded on first use.
//
// Dynamic import keeps the ~270 KB table (81 KB gzip) off the startup path —
// Vite emits it as its own chunk. `symbol-suggest.ts` asks for it when a `:`
// query first gets a character, and re-evaluates the suggestion when it lands.
import type { SymbolEntry } from "./symbol-data";

import { logger } from "../../utils/logger";

/** One generated row: `scripts/build-emoji-data.ts` writes exactly this shape. */
type EmojiRow = [char: string, en: string, ko: string, keywords: string[]];

let emoji: null | readonly SymbolEntry[] = null;
let loading: null | Promise<void> = null;

export function ensureEmojiLoaded(): Promise<void> {
  loading ??= import("./emoji-data.generated.json")
    .then((mod) => {
      emoji = (mod.default as EmojiRow[]).map(([char, en, ko, keywords]) => ({
        char,
        en,
        keywords,
        ko,
      }));
    })
    .catch((err: unknown) => {
      // Let the next query try again rather than leave emoji off for the session.
      loading = null;
      logger.error("[SymbolSuggest] Failed to load emoji data:", err);
    });
  return loading;
}

export function loadedEmoji(): null | readonly SymbolEntry[] {
  return emoji;
}

/** @internal — tests only: forget the loaded table. */
export function _resetEmojiCache(): void {
  emoji = null;
  loading = null;
}

// §376 Prune emojibase-data to what the `:` autocomplete searches.
//
// The en + ko `data.json` pair read here is 1.58 MB (775,157 + 806,066 bytes,
// emojibase-data 17.0.0); the rows kept are the character, both labels, the
// merged keywords and the GitHub shortcodes. The output is committed and
// `npm run emoji:check` fails when it no longer matches a rebuild.
import en from "emojibase-data/en/data.json";
import github from "emojibase-data/en/shortcodes/github.json";
import ko from "emojibase-data/ko/data.json";
import { writeFileSync } from "node:fs";

import { SYMBOLS } from "../src/extensions/plugins/symbol-data";

/**
 * Highest Unicode emoji version kept. macOS 13.0 is the oldest supported
 * system (tauri.conf.json `minimumSystemVersion`) and has Emoji 14.0 — per
 * Apple's release history, not measured here. Anything newer draws as tofu there.
 */
const EMOJI_VERSION_CAP = 14;
/** emojibase group 2, "component": skin tone and hair pieces, not typed alone. */
const COMPONENT_GROUP = 2;
/**
 * emojibase group 9, "flags". A country flag's tags include its ISO region
 * code (`AR`, `SM`), which as an exact keyword outranked every word it starts:
 * `:ar` put 🇦🇷 above →. The two-letter codes are dropped; in emojibase-data
 * 17.0.0 no other tag in this group is two ASCII letters.
 */
const FLAGS_GROUP = 9;
const REGION_CODE = /^[a-z]{2}$/;
const OUT = "src/extensions/plugins/emoji-data.generated.json";

const strip = (c: string): string => c.replaceAll("️", "");
const symbolChars = new Set(SYMBOLS.map((s) => s.char));
const koByHex = new Map(ko.map((e) => [e.hexcode, e]));
/**
 * GitHub's shortcodes (`heart`, `+1`) by hexcode — the names a `:` typist
 * knows from GitHub. Search keywords only: picking writes the
 * character (spec 0056 §375).
 */
const shortcodesByHex = new Map<string, string | string[]>(
  Object.entries(github),
);

const rows = en
  .filter(
    (e) =>
      e.group !== undefined &&
      e.group !== COMPONENT_GROUP &&
      e.version <= EMOJI_VERSION_CAP &&
      !symbolChars.has(strip(e.emoji)),
  )
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .map((e) => {
    const k = koByHex.get(e.hexcode);
    if (!k) throw new Error(`no ko entry for ${e.hexcode} ${e.emoji}`);
    const keywords = [
      ...new Set(
        [...(e.tags ?? []), ...(k.tags ?? [])].map((t) =>
          t.normalize("NFC").toLowerCase(),
        ),
      ),
    ].filter((t) => e.group !== FLAGS_GROUP || !REGION_CODE.test(t));
    const shortcodes = [shortcodesByHex.get(e.hexcode) ?? []]
      .flat()
      .map((s) => s.toLowerCase());
    return [e.emoji, e.label, k.label.normalize("NFC"), keywords, shortcodes];
  });

writeFileSync(OUT, `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
console.log(`${OUT}: ${rows.length} emoji`);

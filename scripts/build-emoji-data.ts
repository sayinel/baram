// §376 Prune emojibase-data to what the `:` autocomplete searches.
//
// The full ko + en `data.json` pair is ~1.2 MB; the rows kept here are the
// character, both labels and the merged keywords. The output is committed and
// `npm run emoji:check` fails when it no longer matches a rebuild.
import en from "emojibase-data/en/data.json";
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
const OUT = "src/extensions/plugins/emoji-data.generated.json";

const strip = (c: string): string => c.replaceAll("️", "");
const symbolChars = new Set(SYMBOLS.map((s) => s.char));
const koByHex = new Map(ko.map((e) => [e.hexcode, e]));

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
    ];
    return [e.emoji, e.label, k.label.normalize("NFC"), keywords];
  });

writeFileSync(OUT, `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
console.log(`${OUT}: ${rows.length} emoji`);

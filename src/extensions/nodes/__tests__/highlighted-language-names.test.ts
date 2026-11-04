// §394 spec 0073 D5 · §11 — the languages a plugin may not claim are every name the code block
// editor highlights, aliases included (`js`, `py`, `md`, …): taking `js` would turn every
// JavaScript block in the user's notes into plugin output. The list is a leaf (the manifest
// validator runs in node scripts and must not import CodeMirror), so this pins it to the switch
// in `getLanguageExtension` by reading that file's `case` labels.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { LANGUAGE_OPTIONS } from "../code-block-languages";
import { HIGHLIGHTED_LANGUAGE_NAMES } from "../highlighted-language-names";

const SOURCE = readFileSync(
  resolve(__dirname, "../code-block-languages.ts"),
  "utf8",
);
const LABELS = new Set(
  [...SOURCE.matchAll(/case "([^"]+)":/gu)].map((m) => m[1]),
);

describe("HIGHLIGHTED_LANGUAGE_NAMES", () => {
  /** What fails this: a `case` added to `getLanguageExtension` without its name here (the
   *  plugin could then claim it), or a name here that the editor no longer highlights. */
  it("is exactly the case labels of getLanguageExtension", () => {
    expect(LABELS.size).toBeGreaterThanOrEqual(30);
    expect([...HIGHLIGHTED_LANGUAGE_NAMES].sort()).toEqual([...LABELS].sort());
  });

  /** The dropdown's values are among them — the list a user picks from cannot name a language a
   *  plugin was allowed to take. */
  it("covers every value of the language dropdown", () => {
    for (const { value } of LANGUAGE_OPTIONS) {
      expect(HIGHLIGHTED_LANGUAGE_NAMES.has(value), value).toBe(true);
    }
  });
});

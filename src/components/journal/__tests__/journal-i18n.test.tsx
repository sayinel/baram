// §56 The journal renders in the app's language.
//
// The reported defect was two Korean buttons — 원본 보기 and 일기 보기 — in the photo lightbox
// of an app whose default locale is `en`. The cause was not those two labels: no component
// under this directory called `t()` at all, so the journal was hardcoded in BOTH languages at
// once (Korean in the lightbox, search filters, heatmap legend and stats; English in the
// gallery toggles, stats labels, month names and empty states). Whichever language you set,
// half the panel disagreed.
//
// `locale-parity.test.ts` cannot see this and neither can `label-key-coverage.test.ts`: both
// check the locale FILES, and text that never became a key is absent from both of them.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { scanForProse } from "../../../i18n/__tests__/prose-scanner";
import en from "../../../i18n/en.json";

const DIR = "src/components/journal";
const KEYS = new Set(Object.keys(en));

/**
 * Literals that are not user-facing prose and are not worth a general rule. Named one by one,
 * so adding one is a deliberate edit rather than a widened pattern.
 */
const ALLOWED = new Set([
  // `Intl.DateTimeFormat` option value.
  "2-digit",
  // The migration dialog shows the on-disk layout it is about, verbatim. These are the actual
  // path and filename formats, not descriptions of them — translating either would make the
  // dialog describe a structure the app does not create.
  "daily/YYYY/MM/",
  // `navigator.platform` check behind the ⌘↩ / Ctrl+Enter label.
  "Mac",
  // Written INTO the captured note, not shown in the UI. A localised key here would make the
  // saved file's format depend on the app language.
  "Source:",
  "YYYY-MM-DD.md",
]);

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => `${DIR}/${name}`);

describe("no journal component hardcodes user-facing text", () => {
  it("scanned every journal component", () => {
    // Not vacuous: the directory had 16 components when this was written, and a scan that
    // silently found no files would pass every assertion below.
    expect(files.length).toBeGreaterThanOrEqual(16);
  });

  it.each(files)("%s", (file) => {
    expect(scanForProse(readFileSync(file, "utf8"), KEYS, ALLOWED)).toEqual({
      children: [],
      literals: [],
    });
  });
});

describe("the journal's keys resolve in both locales", () => {
  const rendered = new Set<string>();
  for (const file of [
    ...files,
    "src/utils/journal/journal-search.ts", // CATEGORY_LABELS holds keys, not labels
  ]) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /"(journal\.[a-zA-Z.]+)"/g,
    )) {
      rendered.add(match[1]);
    }
  }

  it("asks for a non-trivial number of keys", () => {
    expect(rendered.size).toBeGreaterThan(60);
  });

  it("defines every key the journal renders", () => {
    // A key missing from BOTH locale files renders the key itself on screen — how the
    // keybindings tab came to show `keybindings.formatting.bold` (#440). Parity cannot catch
    // it, because absent-from-both is perfect parity.
    expect([...rendered].filter((key) => !KEYS.has(key)).sort()).toEqual([]);
  });
});

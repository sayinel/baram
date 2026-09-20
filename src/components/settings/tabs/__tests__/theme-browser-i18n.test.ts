// §361 — the theme marketplace's newest screens render in the app's language.
//
// Scoped to the files this task added rather than all of `tabs/`, the same reasoning
// `vault-tab-i18n.test.tsx` gives for its own narrower scope: the rest of `tabs/` has its
// own literals to work through, and widening this test to cover them means either a long
// ALLOWED list standing in for that unrelated work, or this guard not landing at all.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { scanForProse } from "../../../../i18n/__tests__/prose-scanner";
import en from "../../../../i18n/en.json";
import ko from "../../../../i18n/ko.json";

const KEYS = new Set(Object.keys(en));

const FILES = [
  "src/components/settings/tabs/ThemeBrowser.tsx",
  "src/components/settings/tabs/use-theme-actions.ts",
];

const ALLOWED = new Set<string>([]);

describe("no theme marketplace file hardcodes user-facing English", () => {
  it("read both files, so the scan below is not empty", () => {
    for (const file of FILES) {
      expect(readFileSync(file, "utf8").length).toBeGreaterThan(500);
    }
  });

  it.each(FILES)("%s", (file) => {
    expect(scanForProse(readFileSync(file, "utf8"), KEYS, ALLOWED)).toEqual({
      children: [],
      literals: [],
    });
  });
});

// Same reasoning as `plugin-ui-i18n.test.tsx`'s "follows the app's locale" suite — a key
// existing in the catalogue does not prove the SCREEN renders the right one under `ko`.
describe("the theme browser follows en/ko parity for every key it references", () => {
  it("every settings.appearance key the scanned files spell out exists in both locales", () => {
    const KO_KEYS = new Set(Object.keys(ko));
    const referenced = new Set<string>();
    for (const file of FILES) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /"(settings\.appearance\.[a-zA-Z0-9._]+)"/g,
      )) {
        referenced.add(match[1]);
      }
    }
    expect(referenced.size).toBeGreaterThan(5);
    const missingEn = [...referenced].filter((k) => !KEYS.has(k));
    const missingKo = [...referenced].filter((k) => !KO_KEYS.has(k));
    expect(missingEn).toEqual([]);
    expect(missingKo).toEqual([]);
  });
});

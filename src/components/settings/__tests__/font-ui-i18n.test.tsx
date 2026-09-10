// §351 — the font UI renders in the app's language.
//
// Modeled on vault-tab-i18n.test.tsx: neither locale-file guard
// (`locale-parity.test.ts`, `label-key-coverage.test.ts`) can see hardcoded
// English, because they both check the locale FILES and a literal that was
// never a key is in neither one. `FontSlotPicker.tsx` is a brand-new file
// that no existing enumerated guard's `FILES` list names, so without this
// test it would slip past every prose check in the repo silently — the
// exact way an enumerated guard misses its next member. `EditorTab.tsx` is
// included too: it has never had prose-scan coverage, and this task rewrites
// most of its font section.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { scanForProse } from "../../../i18n/__tests__/prose-scanner";
import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";

const KEYS = new Set(Object.keys(en));

const FILES = [
  "src/components/settings/FontSlotPicker.tsx",
  "src/components/settings/tabs/EditorTab.tsx",
];

/** Literals that are neither prose nor a form worth a rule. Named, so each is a choice. */
const ALLOWED = new Set<string>([]);

describe("no font settings UI file hardcodes user-facing English", () => {
  it("read both files, so the scan below is not empty", () => {
    for (const file of FILES) {
      expect(readFileSync(file, "utf8").length).toBeGreaterThan(1000);
    }
  });

  it.each(FILES)("%s", (file) => {
    expect(scanForProse(readFileSync(file, "utf8"), KEYS, ALLOWED)).toEqual({
      children: [],
      literals: [],
    });
  });
});

/**
 * The scan above proves no English is hardcoded. It cannot prove the keys that replaced it
 * resolve — `t()` returns the key itself for one that exists in neither locale, so a typo turns
 * a translated row into `settings.editor.fontPikcer.missing` on screen and every other guard
 * stays green.
 */
function keysAskedFor(source: string): string[] {
  return [...source.matchAll(/"((?:common|settings)\.[^"]+)"/gu)].map(
    (m) => m[1],
  );
}

describe("every key the font settings UI asks for resolves", () => {
  const asked = FILES.flatMap((file) =>
    keysAskedFor(readFileSync(file, "utf8")),
  );

  it("found the calls, so the checks below are not vacuous", () => {
    expect(asked.length).toBeGreaterThan(5);
  });

  it.each([
    ["en", en as Record<string, string>],
    ["ko", ko as Record<string, string>],
  ])("in %s", (_name, locale) => {
    expect(asked.filter((key) => !(key in locale))).toEqual([]);
  });
});

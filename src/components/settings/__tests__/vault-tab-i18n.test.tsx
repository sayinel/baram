// §86 The Vault tab renders in the app's language.
//
// The reported defect was the whole tab: 641 lines of hardcoded English sitting next to
// `ApprovedRootsSection.tsx`, its own sibling in the same file, which had been fully translated
// under `settings.vault.*` the whole time. A Korean user opening Settings › Vault got an English
// screen with one Korean section at the bottom.
//
// Neither locale-file guard could see it. `locale-parity.test.ts` and `label-key-coverage.test.ts`
// both check the locale FILES, and text that was never a key is in neither file — so both were
// green while the tab was untranslated. The scan is what sees it.
//
// Scoped to the two Vault-tab files rather than all of `tabs/`: the other tabs have their own
// literals to work through, and widening this to cover them would mean either a long ALLOWED list
// standing in for that work, or this guard not landing at all.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { scanForProse } from "../../../i18n/__tests__/prose-scanner";
import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";

const KEYS = new Set(Object.keys(en));

const FILES = [
  "src/components/settings/tabs/VaultTab.tsx",
  "src/components/settings/tabs/ApprovedRootsSection.tsx",
];

/** Literals that are neither prose nor a form worth a rule. Named, so each is a choice. */
const ALLOWED = new Set([
  // Key names read off a KeyboardEvent, not words on screen.
  "Enter",
  "Escape",
]);

describe("no Vault tab file hardcodes user-facing English", () => {
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
 * a translated row into `settings.vault.wikilinsk` on screen and every other guard stays green.
 * That is the exact defect `label-key-coverage.test.ts` was written for, from the other side:
 * these keys come from JSX rather than a registry, so that file cannot reach them.
 */
function keysAskedFor(source: string): string[] {
  // Not just `t("…")`: the extension rows carry their key in a `labelKey` field and hand it to
  // `t(labelKey)`, so a pattern anchored on the call would check every key EXCEPT those five.
  // Matching the key SHAPE catches both spellings.
  return [...source.matchAll(/"((?:common|settings)\.[^"]+)"/gu)].map(
    (m) => m[1],
  );
}

describe("every key the Vault tab asks for resolves", () => {
  const asked = FILES.flatMap((file) =>
    keysAskedFor(readFileSync(file, "utf8")),
  );

  it("found the calls, so the checks below are not vacuous", () => {
    expect(asked.length).toBeGreaterThan(30);
  });

  it.each([
    ["en", en as Record<string, string>],
    ["ko", ko as Record<string, string>],
  ])("in %s", (_name, locale) => {
    expect(asked.filter((key) => !(key in locale))).toEqual([]);
  });
});

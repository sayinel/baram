// en.json and ko.json must stay one-to-one.
//
// This is an APP-WIDE invariant, so it lives here rather than in the plugin test directory where
// it was first written. No such guard existed; the two files were at exact parity by hand, and
// `t()` is `translations[locale]?.[key] ?? translations.en?.[key] ?? key` — so a key added to
// en.json and forgotten in ko.json does not fail, it silently renders ENGLISH to a Korean user.
// That is the mixed-language defect the plugin consent dialog was reported for, and this file is
// the guard that generalises it to every future key.
import { describe, expect, it } from "vitest";

import en from "../en.json";
import ko from "../ko.json";

const EN = en as Record<string, string>;
const KO = ko as Record<string, string>;

/**
 * Keys whose value is legitimately identical in both locales: product and vendor names, a URL,
 * and a version arrow. Every entry here was already in the tree when this guard was written and
 * was reviewed one by one — none is an untranslated sentence. Enumerated rather than pattern-
 * matched so that adding one is a deliberate edit; a new copy-paste translation fails instead.
 */
const SHARED_VALUES = new Set<string>([
  "about.copyright", // Copyright © 2026 Baram Team
  "keybindings.category.zettelkasten", // Zettel
  "menu.app", // Baram
  "settings.activitybar.item.zettel", // Zettel
  "settings.ai.ollamaUrl", // Ollama URL
  "settings.ai.ollamaUrl.placeholder", // http://localhost:11434
  "settings.ai.provider.claude", // Claude
  "settings.ai.provider.gemini", // Google Gemini
  "settings.ai.provider.openai", // OpenAI
  "settings.general.zettelkasten", // Zettel
  "settings.tab.activitybar", // Activity Bar
  "settings.tab.vault", // Vault
  "settings.workspace.preset.skills", // Skills
  "update.dialog.versionChange", // {current} → {available}
]);

describe("locale files are one-to-one", () => {
  it("has a non-trivial number of keys, so the checks below are not vacuous", () => {
    expect(Object.keys(EN).length).toBeGreaterThan(400);
  });

  it("defines every en key in ko", () => {
    expect(Object.keys(EN).filter((k) => !(k in KO))).toEqual([]);
  });

  it("defines every ko key in en", () => {
    // The other direction matters too: a ko-only key is dead weight that reads as translated
    // coverage when nothing renders it.
    expect(Object.keys(KO).filter((k) => !(k in EN))).toEqual([]);
  });

  it("has no empty values", () => {
    // An empty string passes a "does the key exist" check and renders a blank line — worse than
    // a missing key, which at least falls back to something. Raised in the consent-dialog review.
    const blank = (o: Record<string, string>) =>
      Object.keys(o).filter((k) => o[k].trim() === "");
    expect({ en: blank(EN), ko: blank(KO) }).toEqual({ en: [], ko: [] });
  });

  it("has no ko value that is a verbatim copy of its en value", () => {
    // A copy-paste "translation" passes every existence check while the user still reads English.
    // Add a key to SHARED_VALUES only when the value is genuinely locale-independent.
    const copied = Object.keys(EN).filter(
      (k) =>
        !SHARED_VALUES.has(k) && EN[k] === KO[k] && /[A-Za-z]{4,}/.test(EN[k]),
    );
    expect(copied).toEqual([]);
  });
});

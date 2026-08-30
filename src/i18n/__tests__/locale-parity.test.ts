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
 * Keys whose value is legitimately identical in both locales: product and vendor names,
 * acronyms, a URL, and a version arrow. Enumerated rather than pattern-matched so that adding
 * one is a deliberate edit; a new copy-paste translation fails instead.
 *
 * ‼️ This list is the ONLY exemption. It used to share that job with the `/[A-Za-z]{4,}/` filter
 * in the check below, which silently exempted any en==ko value whose longest Latin word was
 * three letters or fewer — five legitimate acronyms today, but it would have admitted On/Off/
 * Cut/Tag tomorrow without appearing here. Those five are now listed explicitly and the filter
 * is redundant rather than load-bearing.
 *
 * `settings.tab.vault` and `settings.tab.activitybar` were removed from this list rather than
 * kept: allowlisting them cemented `Vault` and `Activity Bar` as untranslated while
 * `recent.vaultBadge` said `볼트`, `home.newVault` said `vault`, and every sibling of the
 * Activity Bar tab was translated. An allowlist must not become where untranslated labels go
 * to die — they are translated now.
 */
const SHARED_VALUES = new Set<string>([
  "about.copyright", // Copyright © 2026 Baram Team
  "help.tab.faq", // FAQ
  "keybindings.category.ai", // AI
  "keybindings.category.zettelkasten", // Zettel
  "menu.app", // Baram
  "menu.help.faq", // FAQ
  "plugin.detail.readme", // README — the filename the section renders, not a word
  "settings.activitybar.item.zettel", // Zettel
  "settings.ai.ollamaUrl", // Ollama URL
  "settings.ai.ollamaUrl.placeholder", // http://localhost:11434
  "settings.ai.provider.claude", // Claude
  "settings.ai.provider.gemini", // Google Gemini
  "settings.ai.provider.openai", // OpenAI
  "settings.general.tasksCaptureFile.placeholder", // tasks/inbox.md
  "settings.general.tasksExcludePaths.placeholder", // archive/, drafts/
  "settings.general.tasksHome.placeholder", // /Users/you/Notes/zettel
  "settings.general.zettelkasten", // Zettel
  "settings.panels.git", // Git
  "settings.tab.ai", // AI
  "settings.workspace.preset.skills", // Skills
  "tasks.edit.tags.placeholder", // deep-work, someday — `#someday`는 §312가 쓰는 기능 태그다
  "update.dialog.versionChange", // {current} → {available}
  "zettel.hub.moc", // MOC — Zettelkasten 용어 그대로 쓴다
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
    //
    // No length filter: every exemption is in SHARED_VALUES, so a two-letter one has to be
    // listed like any other. `/[A-Za-z]/` still skips values with no Latin at all — a bare
    // number or symbol is the same in both locales by definition.
    const copied = Object.keys(EN).filter(
      (k) => !SHARED_VALUES.has(k) && EN[k] === KO[k] && /[A-Za-z]/.test(EN[k]),
    );
    expect(copied).toEqual([]);
  });

  it("uses no ko placeholder that en does not supply", () => {
    // `t()` is `value.replace("{k}", v)` per SUPPLIED param and reports nothing, so a
    // placeholder present only in ko renders literal braces to Korean users while the
    // English string is fine. Deliberately one-directional: `{s}` appears in en only,
    // as a pluralisation hack (`{count} file{s}`) that Korean does not need.
    const params = (value: string) =>
      [...value.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]);
    const extra = Object.keys(KO)
      .filter((k) => k in EN)
      .filter((k) => params(KO[k]).some((p) => !params(EN[k]).includes(p)))
      .map((k) => `${k}: ko has ${params(KO[k])}, en has ${params(EN[k])}`);
    expect(extra).toEqual([]);
  });

  it("has no stale SHARED_VALUES entry", () => {
    // The other direction: an allowlisted key that has since been translated, or removed, stops
    // documenting anything and quietly widens the exemption for whoever reuses the key name.
    const stale = [...SHARED_VALUES].filter(
      (k) => !(k in EN) || EN[k] !== KO[k],
    );
    expect(stale).toEqual([]);
  });
});

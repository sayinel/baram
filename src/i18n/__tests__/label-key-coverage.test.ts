// Registry-driven labels must resolve to a translation.
//
// `t()` is `translations[locale]?.[key] ?? translations.en?.[key] ?? key`, so a label key that
// exists in NEITHER locale renders the key itself. `locale-parity.test.ts` guards en↔ko parity
// but is blind to this: a key missing from both files is at perfect parity. That is how the
// whole Formatting section of the keybindings tab came to render `keybindings.formatting.bold`
// on screen — the registry says `keybindings.formatting.*` while the locale files defined
// `keybindings.fmt.*`, and nothing referenced the latter.
//
// The registry.json half is the same class of defect from the other side: its label/description
// strings are developer metadata (skills and slash commands read this file), so rendering them
// verbatim left the Code Block and Mermaid Block rows in English under a Korean locale.
import { describe, expect, it } from "vitest";

import registry from "../../extensions/registry.json";
import {
  CATEGORY_LABELS,
  KEYBINDING_CATEGORIES,
  KEYBINDING_REGISTRY,
} from "../../keybindings/keybinding-registry";
import en from "../en.json";
import ko from "../ko.json";

const EN = en as Record<string, string>;
const KO = ko as Record<string, string>;
const LOCALES: Array<[string, Record<string, string>]> = [
  ["en", EN],
  ["ko", KO],
];

/**
 * `keybindings.*` keys that are tab chrome (a button, a placeholder, a conflict warning) rather
 * than a registry entry's label. Enumerated rather than pattern-matched: `keybindings.search.*`
 * holds both a chrome key (`.placeholder`) and a real label (`.globalSearch`), so any pattern
 * wide enough to exempt the first also exempts a genuinely orphaned label.
 */
const KEYBINDING_CHROME_KEYS = new Set<string>([
  "keybindings.capture.cancel",
  "keybindings.capture.prompt",
  "keybindings.conflict",
  "keybindings.conflict.swap",
  "keybindings.edit",
  "keybindings.readOnly",
  "keybindings.reset",
  "keybindings.resetAll",
  "keybindings.resetAll.confirm",
  "keybindings.search.empty",
  "keybindings.search.placeholder",
]);

interface SettingDef {
  description: string;
  key: string;
  label: string;
  options?: Array<{ label: string; value: string }>;
}

/** Every i18n key the Markdown tab asks for when rendering registry.json settings. */
function extensionSettingKeys(): string[] {
  const keys: string[] = [];
  for (const ext of extensionsWithSettings()) {
    keys.push(`settings.ext.${ext.name}`);
    for (const s of ext.settings) {
      keys.push(`settings.ext.${s.key}`, `settings.ext.${s.key}.desc`);
      for (const opt of s.options ?? []) {
        keys.push(`settings.ext.${s.key}.${opt.value}`);
      }
    }
  }
  return keys;
}

function extensionsWithSettings(): Array<{
  name: string;
  settings: SettingDef[];
}> {
  const all = [
    ...registry.nodes,
    ...registry.marks,
    ...registry.plugins,
  ] as Array<{ name: string; settings?: SettingDef[] }>;
  return all
    .filter(
      (e): e is { name: string; settings: SettingDef[] } =>
        Array.isArray(e.settings) && e.settings.length > 0,
    )
    .map((e) => ({ name: e.name, settings: e.settings }));
}

describe("keybinding labels", () => {
  it("has a non-trivial number of entries, so the checks below are not vacuous", () => {
    expect(KEYBINDING_REGISTRY.length).toBeGreaterThan(50);
    expect(
      KEYBINDING_REGISTRY.filter((e) => e.category === "formatting").length,
    ).toBeGreaterThan(10);
  });

  it.each(LOCALES)("defines every registry label in %s", (_name, locale) => {
    const missing = KEYBINDING_REGISTRY.map((e) => e.label).filter(
      (k) => !(k in locale),
    );
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)("defines every category label in %s", (_name, locale) => {
    const missing = KEYBINDING_CATEGORIES.map((c) => CATEGORY_LABELS[c]).filter(
      (k) => !(k in locale),
    );
    expect(missing).toEqual([]);
  });

  it("has no orphaned keybinding label", () => {
    // The reverse direction. `keybindings.fmt.*` sat in both locale files, fully translated and
    // referenced by nothing, while the tab rendered raw keys — a missing-key check alone would
    // have been satisfied by translating `fmt` a second time under the right name.
    const referenced = new Set<string>([
      ...KEYBINDING_REGISTRY.map((e) => e.label),
      ...KEYBINDING_CATEGORIES.map((c) => CATEGORY_LABELS[c]),
    ]);
    const orphaned = Object.keys(EN).filter(
      (k) =>
        k.startsWith("keybindings.") &&
        !referenced.has(k) &&
        !KEYBINDING_CHROME_KEYS.has(k),
    );
    expect(orphaned).toEqual([]);
  });
});

describe("registry.json extension settings", () => {
  it("covers the extensions the Markdown tab renders", () => {
    const names = extensionsWithSettings().map((e) => e.name);
    expect(names).toContain("codeBlock");
    expect(names).toContain("mermaidBlock");
    expect(extensionSettingKeys().length).toBeGreaterThan(10);
  });

  it.each(LOCALES)("defines every settings.ext key in %s", (_name, locale) => {
    // The tab falls back to the registry's English string for an unknown key, so a gap here is
    // silent: nothing renders a raw key, the row just stays English in Korean.
    const missing = extensionSettingKeys().filter((k) => !(k in locale));
    expect(missing).toEqual([]);
  });
});

describe("the two line-number toggles", () => {
  // Editor › Display drives CodeMirror in the whole-document Source Mode editor;
  // Markdown › Code Block drives the CodeMirror instance inside a code-block NodeView. Two
  // different surfaces, so both settings stay — but they rendered the same words in two tabs,
  // and translating the second one without renaming the first would have collided in ko too.
  it.each(LOCALES)("reads differently in %s", (_name, locale) => {
    expect(locale["settings.editor.lineNumbers"]).not.toBe(
      locale["settings.ext.codeBlockLineNumbers"],
    );
    expect(locale["settings.editor.lineNumbers.desc"]).not.toBe(
      locale["settings.ext.codeBlockLineNumbers.desc"],
    );
  });
});

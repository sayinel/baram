import type { PluginStatus, RegistryEntry } from "../../../plugins/types";

import { render, screen } from "@testing-library/react";
// §69 / #329 — the plugin UI renders in the app's language.
//
// The reported defect was a screen-level mismatch: under `locale: "ko"` an English
// marketplace opened a fully Korean consent dialog, because #328 localised the dialog
// and nothing else.
//
// ‼️ The first version of this guard looked for prose in JSX *children*. Review showed
// it missed 9 of 11 real shapes — a ternary inside an expression container
// (`{ok ? "Enabled" : "Disabled"}`), a template literal, prose in an attribute
// expression, a string passed as a prop, a `setError` argument, an array of labels,
// single-quoted attributes. Every one of those is a shape; enumerating shapes leaks.
//
// So the question is inverted: EVERY string literal in these files is suspect, and a
// literal is dismissed only by a rule that proves it is not prose — a hex colour, a CSS
// length, a module path, an i18n key that exists in en.json. What survives is listed by
// name. Prose cannot satisfy any of the dismissal rules (it starts with a capital or
// carries sentence punctuation), so it cannot hide in a shape nobody thought of.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";
import { useSettingsStore } from "../../../stores/settings/store";
import { PluginCard } from "../PluginCard";
import { PluginDetail } from "../PluginDetail";
import { PluginTrustBadge } from "../PluginTrustBadge";

const DIR = "src/components/plugins";
const KEYS = new Set(Object.keys(en));

/**
 * Shapes that are provably not user-facing prose. Each is a *form*, not a value, so the
 * list does not grow with the code — and prose cannot match any of them.
 */
const NOT_PROSE: RegExp[] = [
  /^#[0-9a-fA-F]{3,8}$/, // hex colour
  /^-?[\d.]+(px|rem|em|%|vh|vw|s|ms)?$/, // one CSS length
  /^(?:[\d.]+(?:px|rem|em|%)?|0|auto)(?:\s+(?:[\d.]+(?:px|rem|em|%)?|0|auto))+$/, // shorthand
  /^\d+px (solid|dashed)\b/, // border shorthand, colour appended separately
  /^[a-z-]+ [\d.]+m?s$/, // transition shorthand
  /^(var|rgb|rgba|color-mix|linear-gradient|radial-gradient)\(/,
  /^--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, // CSS custom property NAME, e.g. the badge hue
  /^_(blank|self|parent|top)$/, // link target
  /^[a-z][a-zA-Z0-9]*$/, // identifier or CSS keyword
  /^[a-z][a-z0-9]*(?:[-_]+[a-z0-9]+)*(?:\s+[a-z][a-z0-9]*(?:[-_]+[a-z0-9]+)*)*$/, // class list
  /^[a-z]+:[a-z]+$/, // capability id
  /[/@]/, // module path
  /^\[[A-Z][\w ]*\]/, // "[Marketplace] …" — logger, not UI
];

/** Literals that are neither prose nor a form worth a rule. Named, so each is a choice. */
const ALLOWED = new Set(["Escape", "noopener noreferrer"]);

/**
 * Bare JSX text children — `<button>Install</button>`.
 *
 * Not reachable by the literal scan: a text child is not a string literal. This is the
 * one shape the original version of this guard DID catch, kept because the union of the
 * two scans is what makes the coverage total.
 */
function proseChildren(source: string): string[] {
  const src = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  const found: string[] = [];
  for (const match of src.matchAll(/>([^<>{}]*)</g)) {
    const text = match[1].split(/\s+/).join(" ").trim();
    if (!/[A-Za-z]{3,}/.test(text)) continue;
    // A ternary or conditional boundary between two JSX branches is code, not text:
    // `) : updateAvailable ? (`. The literal scan covers anything inside `{…}`, so
    // this scan only needs bare text — and these fragments are never that.
    if (/(&&|\|\||\?|:)\s*\(\s*$/.test(text)) continue;
    if (/^\)\s*:/.test(text)) continue;
    if (/=>|===|\breturn\b|\bconst\b|\bfunction\b|^new [A-Z]/.test(text))
      continue;
    found.push(text);
  }
  return found;
}

function proseLiterals(source: string): string[] {
  return stringLiterals(source)
    .map((literal) => literal.trim())
    .filter(
      (value) =>
        value !== "" &&
        /[A-Za-z]/.test(value) &&
        !KEYS.has(value) &&
        !ALLOWED.has(value) &&
        !NOT_PROSE.some((shape) => shape.test(value)),
    );
}

/** Every string and template-literal chunk in a source file, comments excluded. */
function stringLiterals(source: string): string[] {
  const src = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  const out: string[] = [];
  for (const match of src.matchAll(
    /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g,
  )) {
    out.push(match[1] ?? match[2]);
  }
  // Template literals: keep the literal chunks, drop every `${…}` including nesting.
  for (const match of src.matchAll(/`((?:[^`\\]|\\.)*)`/gs)) {
    let depth = 0;
    let chunk = "";
    for (const char of match[1]) {
      if (char === "{") depth++;
      else if (char === "}") depth = Math.max(0, depth - 1);
      else if (depth === 0) chunk += char;
      else if (chunk) {
        out.push(chunk.replace(/\$$/, ""));
        chunk = "";
      }
    }
    if (chunk) out.push(chunk.replace(/\$$/, ""));
  }
  return out;
}

describe("no plugin component hardcodes user-facing English", () => {
  const files = readdirSync(DIR)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => `${DIR}/${name}`);

  it("scanned the plugin components", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files)("%s", (file) => {
    const source = readFileSync(file, "utf8");
    expect({
      children: proseChildren(source),
      literals: proseLiterals(source),
    }).toEqual({ children: [], literals: [] });
  });

  it.each([
    ["a bare JSX child", "<button>Install</button>"],
    [
      "a ternary in an expression",
      '<span>{ok ? "Enabled" : "Disabled"}</span>',
    ],
    ["a template literal", "<span>{`Installed (${n})`}</span>"],
    [
      "an attribute expression",
      '<b title={x ? undefined : "Cannot install."} />',
    ],
    ["prose as a prop", '<Banner message="Failed to load registry" />'],
    [
      "a setError argument",
      'setError(id, "This plugin is not in the registry.");',
    ],
    ["an array of labels", 'const T = ["Browse", "Installed", "Updates"];'],
    ["a single-quoted attribute", "<b title='Install now' />"],
    ["an unlisted aria attribute", '<b aria-description="Installs it" />'],
  ])("catches prose in %s", (_label, source) => {
    // The nine shapes the shape-based version of this scan missed, plus the one it
    // did catch — the union has to cover all ten.
    expect(
      proseLiterals(source).length + proseChildren(source).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    [
      "a translated call",
      '<span>{t("plugin.card.downloads", { count: n })}</span>',
    ],
    ["a hex colour", 'const c = "#f59e0b";'],
    ["a class list", 'className="plugin-dev-btn plugin-dev-btn--danger"'],
    ["a CSS shorthand", 'padding: "6px 16px"'],
    ["a module path", 'import x from "../../plugins/types";'],
    ["a logger prefix", 'logger.warn("[Marketplace] refresh failed:", err);'],
    // The badge sets its hue through a custom property, so the property NAME appears
    // as a literal. Dismissed by a rule rather than added to ALLOWED: a leading `--`
    // plus a CSS identifier is provably not user-facing text, so the next component
    // that styles itself this way needs no edit here.
    ["a CSS custom property name", 'style={{ "--capability-badge-hue": c }}'],
  ])("does not flag %s", (_label, source) => {
    expect({
      children: proseChildren(source),
      literals: proseLiterals(source),
    }).toEqual({ children: [], literals: [] });
  });
});

/** Latin words in rendered text, minus the proper nouns that legitimately stay. */
function latinLeftovers(text: string): string[] {
  return (
    text
      .replace(/Baram|README|Demo|Someone|Apache|v?\d[\d.]*/g, "")
      .match(/[A-Za-z]{2,}/g) ?? []
  );
}

describe("the plugin UI follows the app's locale", () => {
  const ENTRY: RegistryEntry = {
    author: "Someone",
    capabilities: [],
    checksum: "x".repeat(64),
    description: "설명",
    downloadUrl: "",
    downloads: undefined,
    engines: { baram: ">=0.5.0" },
    id: "demo",
    license: "Apache-2.0",
    name: "Demo",
    trust: "sandboxed",
    version: "1.0.0",
  };
  const CARD_PROPS = {
    entry: ENTRY,
    onInstall: () => {},
    onSelect: () => {},
    onUninstall: () => {},
    onUpdate: () => {},
  };

  afterEach(() => {
    useSettingsStore.setState({ locale: "en" });
  });

  it.each(["en", "ko"] as const)("renders the trust badge in %s", (locale) => {
    useSettingsStore.setState({ locale });
    render(<PluginTrustBadge trust="trusted" />);
    const table: Record<string, string> = locale === "en" ? en : ko;
    expect(screen.getByText(table["plugin.trust.trusted"])).toBeTruthy();
  });

  it("renders the card's install button in Korean under ko", () => {
    useSettingsStore.setState({ locale: "ko" });
    render(<PluginCard {...CARD_PROPS} status="not-installed" />);
    // The literal, not the key: asserting `t("plugin.action.install")` would pass
    // even if the lookup returned the key itself.
    expect(screen.getByText("설치")).toBeTruthy();
    expect(screen.queryByText("Install")).toBeNull();
  });

  it("renders the same card in English under en", () => {
    useSettingsStore.setState({ locale: "en" });
    render(<PluginCard {...CARD_PROPS} status="not-installed" />);
    expect(screen.getByText("Install")).toBeTruthy();
    expect(screen.queryByText("설치")).toBeNull();
  });

  // Every status branch, because the static scan cannot tell which one renders and the
  // review found `{status === "enabled" ? … : …}` had coverage from neither half.
  it.each(["not-installed", "installing", "enabled", "disabled"] as const)(
    "leaves no English in the card under ko — status %s",
    (status: PluginStatus) => {
      useSettingsStore.setState({ locale: "ko" });
      const { container } = render(
        <PluginCard {...CARD_PROPS} status={status} />,
      );
      expect(latinLeftovers(container.textContent ?? "")).toEqual([]);
    },
  );

  it.each(["enabled", "disabled"] as const)(
    "leaves no English in the detail view under ko — status %s",
    (status: PluginStatus) => {
      useSettingsStore.setState({ locale: "ko" });
      const { container } = render(
        <PluginDetail
          entry={ENTRY}
          onBack={() => {}}
          onInstall={() => {}}
          onToggleEnabled={() => {}}
          onUninstall={() => {}}
          onUpdate={() => {}}
          readme={null}
          status={status}
        />,
      );
      expect(latinLeftovers(container.textContent ?? "")).toEqual([]);
    },
  );
});

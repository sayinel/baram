import type { RegistryEntry } from "../../../plugins/types";

import { render, screen } from "@testing-library/react";
// §69 / #329 — the plugin UI renders in the app's language.
//
// The reported defect was a screen-level mismatch: under `locale: "ko"` an English
// marketplace opened a fully Korean consent dialog, because #328 localised the dialog
// and nothing else. Six components were hardcoded English.
//
// Two guards, because either alone is hollow. The static scan catches the next
// hardcoded string but cannot prove `t()` was wired correctly; the render test proves
// the wiring but only for what it renders.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";
import { useSettingsStore } from "../../../stores/settings/store";
import { PluginCard } from "../PluginCard";
import { PluginTrustBadge } from "../PluginTrustBadge";

const DIR = "src/components/plugins";

/**
 * Remove every balanced `{…}` group, nesting included.
 *
 * A regex cannot: `{t("k", { count: n })}` nests, so `\{[^{}]*\}` leaves the outer
 * braces and their contents behind — which made an earlier version of this scan
 * report the *translated* calls as untranslated prose.
 */
function stripExpressions(text: string): string {
  let out = "";
  let depth = 0;
  for (const char of text) {
    if (char === "{") depth++;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += char;
  }
  return out;
}

/** JSX children with literal words outside any `{…}` expression. */
function untranslatedProse(source: string): string[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  const found: string[] = [];
  for (const match of stripped.matchAll(/>([^<>]*)</g)) {
    const raw = match[1];
    // Unbalanced braces mean this is a fragment of one expression, not a child: a
    // `>` inside `{caps.length > 0 ? … }` splits the expression in two here.
    const opens = (raw.match(/\{/g) ?? []).length;
    const closes = (raw.match(/\}/g) ?? []).length;
    if (opens !== closes) continue;
    // A conditional or ternary boundary is code: `{x && (`, `)} {y ? (`
    if (/(&&|\|\||\?|:)\s*\(\s*$/.test(raw)) continue;
    if (/=>|===|\breturn\b|\bconst\b|\bfunction\b/.test(raw)) continue;
    // `new Promise<T>(…)` — a generic argument list also produces a `>…<` pair.
    // Matched narrowly (constructor form) so prose containing "new" still counts.
    if (/^\s*new\s+[A-Z]\w*\s*$/.test(raw)) continue;
    if (!/[A-Za-z]{3,}/.test(stripExpressions(raw))) continue;
    found.push(raw.split(/\s+/).join(" ").trim());
  }
  for (const match of stripped.matchAll(
    /\b(title|placeholder|aria-label|alt)="([^"]{3,})"/g,
  )) {
    found.push(`${match[1]}="${match[2]}"`);
  }
  return found;
}

describe("no plugin component hardcodes user-facing English", () => {
  const files = readdirSync(DIR)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => `${DIR}/${name}`);

  it("scanned the plugin components", () => {
    // Without this, a bad glob would make the scan below vacuous.
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files)("%s", (file) => {
    expect(untranslatedProse(readFileSync(file, "utf8"))).toEqual([]);
  });

  it("finds prose when there is some, so the scan is not vacuous", () => {
    expect(
      untranslatedProse('<button title="Install now">Install</button>'),
    ).toEqual(["Install", 'title="Install now"']);
  });

  it("does not mistake a translated call for prose", () => {
    // The nesting an earlier version of this scan could not see.
    expect(
      untranslatedProse(
        '<span>{t("plugin.card.downloads", { count: n.toLocaleString() })}</span>',
      ),
    ).toEqual([]);
  });
});

describe("the plugin UI follows the app's locale", () => {
  const ENTRY: RegistryEntry = {
    author: "Someone",
    capabilities: [],
    checksum: "x".repeat(64),
    description: "A plugin",
    downloadUrl: "",
    downloads: undefined,
    engines: { baram: ">=0.5.0" },
    id: "demo",
    license: "Apache-2.0",
    name: "Demo",
    trust: "sandboxed",
    version: "1.0.0",
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
    render(
      <PluginCard
        entry={ENTRY}
        onInstall={() => {}}
        onSelect={() => {}}
        onUninstall={() => {}}
        onUpdate={() => {}}
        status="not-installed"
      />,
    );
    // The literal, not the key: a test asserting `t("plugin.action.install")`
    // would pass even if the lookup returned the key itself.
    expect(screen.getByText("설치")).toBeTruthy();
    expect(screen.queryByText("Install")).toBeNull();
  });

  it("renders the same card in English under en", () => {
    useSettingsStore.setState({ locale: "en" });
    render(
      <PluginCard
        entry={ENTRY}
        onInstall={() => {}}
        onSelect={() => {}}
        onUninstall={() => {}}
        onUpdate={() => {}}
        status="not-installed"
      />,
    );
    expect(screen.getByText("Install")).toBeTruthy();
    expect(screen.queryByText("설치")).toBeNull();
  });
});

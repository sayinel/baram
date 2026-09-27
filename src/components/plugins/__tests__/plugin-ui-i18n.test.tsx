import type { PluginStatus, RegistryEntry } from "../../../plugins/types";

import { render, screen } from "@testing-library/react";
// §69 / #329 — the plugin UI renders in the app's language.
//
// The reported defect was a screen-level mismatch: under `locale: "ko"` an English
// marketplace opened a fully Korean consent dialog, because #328 localised the dialog
// and nothing else.
//
// The scan itself now lives in `i18n/__tests__/prose-scanner.ts`, shared with the journal's
// guard (§56) and tested there. Its rule: EVERY string in a scanned file is suspect, and a
// string is dismissed only by a rule that proves it is not prose. What survives is listed by
// name in ALLOWED below.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { scanForProse } from "../../../i18n/__tests__/prose-scanner";
import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";
import { useSettingsStore } from "../../../stores/settings/store";
import { PluginCard } from "../PluginCard";
import { PluginDetail } from "../PluginDetail";
import { PluginTrustBadge } from "../PluginTrustBadge";

const DIR = "src/components/plugins";
const KEYS = new Set(Object.keys(en));

/** Literals that are neither prose nor a form worth a rule. Named, so each is a choice. */
const ALLOWED = new Set(["Escape", "noopener noreferrer"]);

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => `${DIR}/${name}`);

describe("no plugin component hardcodes user-facing English", () => {
  it("scanned the plugin components", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files)("%s", (file) => {
    expect(scanForProse(readFileSync(file, "utf8"), KEYS, ALLOWED)).toEqual({
      children: [],
      literals: [],
    });
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

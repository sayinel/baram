// The search result row reads "section · description". An entry with no description text
// (the app version row, the update check button) must not end in a dangling separator.
import type { SearchableSetting, SettingsTab } from "../settings-registry";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import en from "../../../i18n/en.json";
import { NAVIGATE_CONTROL } from "../settings-registry";
import { SettingsSearchResults } from "../SettingsSearchResults";

const EN = en as Record<string, string>;

function entry(id: string, description: string): SearchableSetting {
  return {
    category: "general",
    control: NAVIGATE_CONTROL,
    description,
    id,
    label: "settings.general.updates.version",
    section: "settings.general.updates",
  };
}

describe("SettingsSearchResults", () => {
  it("separates section and description only when there is a description", () => {
    const grouped = new Map<SettingsTab, SearchableSetting[]>([
      [
        "general",
        [
          entry("bare", ""),
          entry("described", "settings.general.updates.autoCheck.desc"),
        ],
      ],
    ]);
    const { container } = render(
      <SettingsSearchResults
        grouped={grouped}
        onNavigate={() => undefined}
        query="update"
      />,
    );
    const texts = [
      ...container.querySelectorAll(".settings-row-description"),
    ].map((el) => el.textContent);
    const section = EN["settings.general.updates"];
    expect(texts).toEqual([
      section,
      `${section} · ${EN["settings.general.updates.autoCheck.desc"]}`,
    ]);
  });
});

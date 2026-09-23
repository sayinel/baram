// §370 — assembly-level witness for ActivityBarTab.tsx.
//
// Every other test in this task's diff renders one of the three layout sections
// directly (`ChromeVisibilitySection`, `WorkspacePresets`, `ActivityBarItemsSection`) —
// that's the right level for pinning each section's own behaviour. But nothing rendered
// <ActivityBarTab /> itself, so a change that drops a section from the assembly (e.g.
// deleting `<WorkspacePresets />` from ActivityBarTab.tsx) would leave every one of
// those section-level tests green while silently removing the section from the running
// app — the tab is the only place a user actually reaches these sections from.
//
// This file's only job is to witness that all three sections are still wired into the
// tab. It does not re-test what each section does — that coverage lives in
// `layout/__tests__/ChromeVisibilitySection.test.tsx` and
// `tabs/__tests__/workspace-presets.test.tsx` (ActivityBarItemsSection has no dedicated
// test file yet; its drag-reorder behaviour predates this task and moved unchanged).
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { t } from "../../../../i18n";
import { useSettingsStore } from "../../../../stores/settings/store";
import { ActivityBarTab } from "../ActivityBarTab";

beforeEach(() => {
  useSettingsStore.setState({ locale: "en" });
});

describe("ActivityBarTab assembly (§370)", () => {
  it("wires in ChromeVisibilitySection, WorkspacePresets, and ActivityBarItemsSection", () => {
    render(<ActivityBarTab />);

    // ChromeVisibilitySection — its own row label, not just its section header.
    expect(
      screen.getByText(
        t("settings.activitybar.chromeVisibility.activityBar", "en"),
      ),
    ).toBeInTheDocument();

    // WorkspacePresets — the "Perspectives" header this task moved here, plus the
    // gallery it heads (the actual preset cards, not just the header text).
    expect(
      screen.getByText(t("settings.appearance.workspacePresets", "en")),
    ).toBeInTheDocument();
    expect(document.querySelector(".workspace-gallery")).not.toBeNull();

    // ActivityBarItemsSection — its desc line, distinct from the other two sections'.
    expect(
      screen.getByText(t("settings.activitybar.desc", "en")),
    ).toBeInTheDocument();
  });
});

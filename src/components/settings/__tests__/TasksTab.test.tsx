// §342/A2 — the global capture shortcut works regardless of the Tasks
// toggle (journal.quickCapture is not Tasks-exclusive, fix-d-brief.md A2), so
// its settings row must be reachable even when Tasks is off — otherwise a
// still-live shortcut has no UI to change or clear it.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { t } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settings/store";
import { TasksTab } from "../tabs/TasksTab";

beforeEach(() => {
  useSettingsStore.setState({ tasksEnabled: true, locale: "en" });
});

describe("TasksTab — global capture row visibility (§342/A2)", () => {
  it("renders the global capture row when Tasks is off", () => {
    useSettingsStore.setState({ tasksEnabled: false });
    const { container } = render(<TasksTab />);

    expect(
      screen.getByText(t("settings.general.tasksGlobalCapture", "en")),
    ).toBeInTheDocument();
    expect(container.querySelector(".global-capture-control")).not.toBeNull();
  });

  it("renders the global capture row when Tasks is on — positive control", () => {
    const { container } = render(<TasksTab />);

    expect(
      screen.getByText(t("settings.general.tasksGlobalCapture", "en")),
    ).toBeInTheDocument();
    expect(container.querySelector(".global-capture-control")).not.toBeNull();
  });

  it("the tab is still a non-empty, valid screen when Tasks is off", () => {
    useSettingsStore.setState({ tasksEnabled: false });
    const { container } = render(<TasksTab />);

    // The section header, the Tasks toggle row, and now the capture row —
    // more than 1 rules out a stray empty section (header with nothing
    // under it), the regression this test guards against.
    expect(container.querySelectorAll(".settings-row").length).toBeGreaterThan(
      1,
    );
  });
});

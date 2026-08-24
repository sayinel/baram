import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../stores/settings/store";
import { ActivityBar } from "../ActivityBar";

describe("ActivityBar tasks visibility", () => {
  beforeEach(() => {
    useSettingsStore.setState({ tasksEnabled: true });
  });

  it("shows the Tasks button when the feature is enabled", () => {
    render(<ActivityBar />);
    expect(screen.getByTitle("Tasks")).toBeInTheDocument();
  });

  it("hides the Tasks button when the feature is disabled", () => {
    useSettingsStore.setState({ tasksEnabled: false });
    render(<ActivityBar />);
    expect(screen.queryByTitle("Tasks")).not.toBeInTheDocument();
  });
});

// issue 523 — deleting a custom theme or perspective asks first.
//
// Both are persisted data the user built by hand (a palette of 24 colours, a
// layout), and both were removed by one click on a small × overlaid on the
// card, with no way back. The file tree already confirms far less final
// deletions (a move to the trash) through the shared showConfirm dialog; the
// settings cards now use the same one. The dialog itself is mocked here — what
// is pinned is that the store does not change until it answers yes, and that
// the question names the item.
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/confirm-dialog", () => ({
  showAlert: vi.fn(async () => undefined),
  showConfirm: vi.fn(async () => false),
}));

import type { WorkspacePreset } from "../../../stores/file/workspace";
import type { ThemeDef } from "../../../types/theme";

import { useWorkspaceStore } from "../../../stores/file/workspace";
import { useSettingsStore } from "../../../stores/settings/store";
import { BUILT_IN_THEMES } from "../../../types/theme";
import { showConfirm } from "../../../utils/confirm-dialog";
import { AppearanceTab } from "../tabs/AppearanceTab";

const CUSTOM_THEME: ThemeDef = {
  base: "dark",
  builtIn: false,
  colors: { ...BUILT_IN_THEMES[0].colors },
  id: "custom-1730000000000",
  name: "Mine",
};

const CUSTOM_PRESET: WorkspacePreset = {
  builtIn: false,
  description: "",
  id: "preset-1",
  layout: {
    rightPanelMode: "none",
    rightPanelOpen: false,
    sidebarOpen: true,
    sidebarPanel: "files",
  },
  name: "Deep work",
};

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.mocked(showConfirm).mockReset();
  vi.mocked(showConfirm).mockResolvedValue(false);
  useSettingsStore.setState({
    activeThemeId: "system",
    customThemes: [CUSTOM_THEME],
    locale: "en",
  });
  useWorkspaceStore.setState({
    activePresetId: null,
    customPresets: [CUSTOM_PRESET],
  });
});

afterEach(() => {
  useSettingsStore.setState({ customThemes: [] });
  useWorkspaceStore.setState({ customPresets: [] });
});

function presetDeleteButton(): HTMLElement {
  const button = document.querySelector<HTMLElement>(
    "button.workspace-card-delete",
  );
  if (!button) throw new Error("preset delete button did not mount");
  return button;
}

function themeDeleteButton(): HTMLElement {
  return screen.getByRole("button", { name: "Delete theme 'Mine'" });
}

describe("deleting a custom theme", () => {
  it("asks first, naming the theme, and keeps it when the answer is no", async () => {
    render(<AppearanceTab />);

    fireEvent.click(themeDeleteButton());
    await settle();

    expect(vi.mocked(showConfirm)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showConfirm).mock.calls[0][0]).toContain("Mine");
    expect(useSettingsStore.getState().customThemes).toEqual([CUSTOM_THEME]);
  });

  it("deletes when the answer is yes", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    render(<AppearanceTab />);

    fireEvent.click(themeDeleteButton());
    await settle();

    expect(useSettingsStore.getState().customThemes).toEqual([]);
  });
});

describe("deleting a custom perspective", () => {
  it("asks first, naming the perspective, and keeps it when the answer is no", async () => {
    render(<AppearanceTab />);

    fireEvent.click(presetDeleteButton());
    await settle();

    expect(vi.mocked(showConfirm)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showConfirm).mock.calls[0][0]).toContain("Deep work");
    expect(useWorkspaceStore.getState().customPresets).toEqual([CUSTOM_PRESET]);
  });

  it("deletes when the answer is yes", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    render(<AppearanceTab />);

    fireEvent.click(presetDeleteButton());
    await settle();

    expect(useWorkspaceStore.getState().customPresets).toEqual([]);
  });
});

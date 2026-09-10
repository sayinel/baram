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

// §338/I-8 — the workspace gallery used to render `BUILTIN_PRESETS`
// unconditionally, so a disabled Journal/Zettel still offered a card here
// even though applying it (workspace.ts) already refused and toasted. This is
// the "render" half of that completeness pair (preset-feature-gate.test.ts is
// the "applyPreset agrees with PRESET_FEATURE" half). Custom presets are
// never filtered — "Deep work" (CUSTOM_PRESET) stays regardless.
describe("workspace gallery — preset feature gate (§338/I-8)", () => {
  // ‼️ en-only — `menu.workspace.*` and the (now-removed) `settings.workspace.preset.*` name
  // keys were BOTH "Writing"/"Journal"/"Skills" in en.json, so this assertion cannot see a wrong
  // or missing `nameKey` (§343; see `preset-labels.test.tsx` for the ko-locale assertions).
  it("hides the Journal card but keeps Writing/Skills/the custom preset when journal is off", () => {
    useSettingsStore.setState({ journalEnabled: false });
    render(<AppearanceTab />);

    expect(screen.queryByText("Journal")).toBeNull();
    expect(screen.getByText("Writing")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("Deep work")).toBeInTheDocument();
  });

  it("shows the Journal card when journal is on — positive control", () => {
    useSettingsStore.setState({ journalEnabled: true });
    render(<AppearanceTab />);

    expect(screen.getByText("Journal")).toBeInTheDocument();
  });
});

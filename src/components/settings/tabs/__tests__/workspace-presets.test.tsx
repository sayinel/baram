// issue 523 / §338/I-8 — moved out of `AppearanceTab.test.tsx` (task-5, §370) when the
// workspace-presets section moved to `ActivityBarTab.tsx`. `workspace-presets.tsx` itself did
// not change, so these tests render `<WorkspacePresets />` directly rather than a host tab.
//
// (a) issue 523 — deleting a custom perspective is persisted data the user built by hand (a
// saved layout), and it used to be removed by one click on a small × overlaid on the card, with
// no way back. It now asks first through the shared showConfirm dialog, mocked here — what is
// pinned is that the store does not change until it answers yes, and that the question names the
// item.
//
// (b) §338/I-8 — the workspace gallery used to render `BUILTIN_PRESETS` unconditionally, so a
// disabled Journal/Zettel still offered a card here even though applying it (workspace.ts)
// already refused and toasted. This is the "render" half of that completeness pair
// (preset-feature-gate.test.ts is the "applyPreset agrees with PRESET_FEATURE" half). Custom
// presets are never filtered — "Deep work" (CUSTOM_PRESET) stays regardless.
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../utils/confirm-dialog", () => ({
  showConfirm: vi.fn(async () => false),
}));

import type { WorkspacePreset } from "../../../../stores/file/workspace";

import { useWorkspaceStore } from "../../../../stores/file/workspace";
import { useSettingsStore } from "../../../../stores/settings/store";
import { showConfirm } from "../../../../utils/confirm-dialog";
import { WorkspacePresets } from "../workspace-presets";

const CUSTOM_PRESET: WorkspacePreset = {
  builtIn: false,
  description: "",
  id: "preset-1",
  layout: {
    activityBarVisible: true,
    rightPanelMode: "none",
    rightPanelOpen: false,
    sidebarOpen: true,
    sidebarPanel: "files",
    statusBarVisible: true,
    tabBarVisible: true,
  },
  name: "Deep work",
};

function presetDeleteButton(): HTMLElement {
  const button = document.querySelector<HTMLElement>(
    "button.workspace-card-delete",
  );
  if (!button) throw new Error("preset delete button did not mount");
  return button;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.mocked(showConfirm).mockReset();
  vi.mocked(showConfirm).mockResolvedValue(false);
  useSettingsStore.setState({ locale: "en" });
  useWorkspaceStore.setState({
    activePresetId: null,
    customPresets: [CUSTOM_PRESET],
  });
});

afterEach(() => {
  useWorkspaceStore.setState({ customPresets: [] });
});

describe("deleting a custom perspective", () => {
  it("asks first, naming the perspective, and keeps it when the answer is no", async () => {
    render(<WorkspacePresets />);

    fireEvent.click(presetDeleteButton());
    await settle();

    expect(vi.mocked(showConfirm)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showConfirm).mock.calls[0][0]).toContain("Deep work");
    expect(useWorkspaceStore.getState().customPresets).toEqual([CUSTOM_PRESET]);
  });

  it("deletes when the answer is yes", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    render(<WorkspacePresets />);

    fireEvent.click(presetDeleteButton());
    await settle();

    expect(useWorkspaceStore.getState().customPresets).toEqual([]);
  });
});

describe("workspace gallery — preset feature gate (§338/I-8)", () => {
  // ‼️ en-only — `menu.workspace.*` and the (now-removed) `settings.workspace.preset.*` name
  // keys were BOTH "Writing"/"Journal"/"Skills" in en.json, so this assertion cannot see a wrong
  // or missing `nameKey` (§343; see `preset-labels.test.tsx` for the ko-locale assertions).
  it("hides the Journal card but keeps Writing/Skills/the custom preset when journal is off", () => {
    useSettingsStore.setState({ journalEnabled: false });
    render(<WorkspacePresets />);

    expect(screen.queryByText("Journal")).toBeNull();
    expect(screen.getByText("Writing")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("Deep work")).toBeInTheDocument();
  });

  it("shows the Journal card when journal is on — positive control", () => {
    useSettingsStore.setState({ journalEnabled: true });
    render(<WorkspacePresets />);

    expect(screen.getByText("Journal")).toBeInTheDocument();
  });
});

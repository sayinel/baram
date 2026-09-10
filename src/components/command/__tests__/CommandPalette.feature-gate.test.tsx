// §338 — the palette's feature filter must be REACTIVE.
//
// `commands` is a `useMemo` whose deps are the eight callback props plus the
// plugin command list. `isFeatureEnabled()` reads `getState()` at
// memo-evaluation time and is not itself reactive, and none of those deps
// change when a toggle flips — so a naive `.filter(...isFeatureEnabled...)`
// at the buildCommands call site would keep the palette's stale command
// list until some unrelated prop changed identity. A test that only calls
// `buildCommands()` directly cannot see this defect, because the filter
// does not live in `buildCommands`. This test renders the real component and
// flips the store to prove the visible list actually updates.
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAIStore } from "../../../stores/ai/ai";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { CommandPalette } from "../CommandPalette";

const noop = () => {};

function renderPalette() {
  return render(
    <CommandPalette
      editor={null}
      onCloseFolder={noop}
      onNewFile={noop}
      onOpenFile={noop}
      onOpenFolder={noop}
      onSave={noop}
      onToggleSourceMode={noop}
    />,
  );
}

describe("CommandPalette — feature filter reacts to store changes (§338)", () => {
  beforeEach(() => {
    useUIStore.setState({ commandPaletteOpen: true });
    // journalEnabled defaults to false — start from that default explicitly
    // so this test does not depend on ordering against other test files.
    useSettingsStore.setState({ journalEnabled: false });
  });

  afterEach(() => {
    useAIStore.setState({ aiEnabled: true }); // restore the default for other files
  });

  it("shows a journal command only after the feature is turned on, without remounting", () => {
    renderPalette();

    expect(screen.queryByText("Open Today's Journal")).not.toBeInTheDocument();

    act(() => {
      useSettingsStore.setState({ journalEnabled: true });
    });

    expect(screen.getByText("Open Today's Journal")).toBeInTheDocument();
  });

  it("hides the command again when the feature is turned back off", () => {
    useSettingsStore.setState({ journalEnabled: true });
    renderPalette();

    expect(screen.getByText("Open Today's Journal")).toBeInTheDocument();

    act(() => {
      useSettingsStore.setState({ journalEnabled: false });
    });

    expect(screen.queryByText("Open Today's Journal")).not.toBeInTheDocument();
  });

  it("hides a Skills-category AI command when AI is off — category cannot discriminate this one", () => {
    // `skill:test` sits under category: "Skills", not "AI", unlike the five
    // ai:* commands (already category: "AI"). A regression that filtered by
    // category instead of by the explicit `feature` field would keep
    // passing those five while leaking this one straight through.
    useAIStore.setState({ aiEnabled: true });
    renderPalette();

    expect(screen.getByText("AI: Test Skill")).toBeInTheDocument();

    act(() => {
      useAIStore.setState({ aiEnabled: false });
    });

    expect(screen.queryByText("AI: Test Skill")).not.toBeInTheDocument();
  });
});

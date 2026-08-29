// §315 — the weekly review's palette entry must survive a registry move.
//
// The review has two entry points: the agenda header button and this one. It has
// no default keybinding (a screen you open once a week), so the palette is the
// path a user without the agenda open takes.
//
// Written after a merge nearly lost it: the §372 campaign moved the command table
// out of `CommandPalette.tsx` into `command-registry.ts`, and the entry had to be
// carried across by hand. Nothing failed when it was missing — the whole suite was
// green with the command simply gone. This test goes through the rendered palette
// rather than reading the registry array, so it pins the user-visible path and not
// the table's current address.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { clearActions } from "../../../keybindings/keybinding-actions";
import { useUIStore } from "../../../stores/ui/ui";
import { CommandPalette } from "../CommandPalette";

const noop = () => {};

describe("CommandPalette — Tasks: Weekly Review", () => {
  beforeEach(() => {
    clearActions();
    useUIStore.setState({ commandPaletteOpen: true, weeklyReviewOpen: false });
  });

  it("opens the weekly review", () => {
    render(
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

    fireEvent.click(screen.getByText("Tasks: Weekly Review"));

    expect(useUIStore.getState().weeklyReviewOpen).toBe(true);
  });
});

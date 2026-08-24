// §56/§85 — "Open Today's Journal" must go through the journal PRESET.
//
// The preset looks like a layout-only command, and the backlog recorded it that way,
// but `workspace.ts` calls `ensureJournalContext(resolvedDir)` and then the journal
// space's `newFileFlow()` (→ ensureJournalFile + openFileInTab): it opens today's entry
// AND activates the journal context.
//
// The registered `journal.openToday` action opens the file only. Since
// `stores/editor/editor.ts` fills an empty `contextId` from the ACTIVE context, its tab
// would be owned by whichever vault was active and closed together with that vault
// (`ContextTabBar`), and the journal layout would not appear. This test pins the routing
// so a rewiring is a red test rather than a silent behaviour loss.
//
// (Directory REGISTRATION is no longer part of the difference: `ensureJournalFile` now
// registers it without activating. That was the reason first written here, and it stopped
// being true one commit later — hence this note.)
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearActions,
  registerAction,
} from "../../../keybindings/keybinding-actions";
import { useWorkspaceStore } from "../../../stores/file/workspace";
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

describe("CommandPalette — Open Today's Journal", () => {
  beforeEach(() => {
    clearActions();
    useUIStore.setState({ commandPaletteOpen: true });
  });

  it("routes through the journal preset, which registers the context first", () => {
    const applyPreset = vi.fn();
    useWorkspaceStore.setState({ applyPreset });
    // Registered so the test would notice a rewiring to it rather than a no-op:
    // dispatching this action instead skips ensureJournalContext.
    const openToday = vi.fn();
    registerAction("journal.openToday", openToday);

    renderPalette();
    fireEvent.click(screen.getByText("Open Today's Journal"));

    expect(applyPreset).toHaveBeenCalledWith("journal");
    expect(openToday).not.toHaveBeenCalled();
  });

  it("still offers the journal layout preset as its own command", () => {
    // Two commands reach the same preset today. That redundancy is deliberate for
    // now (see dev/backlog.md): splitting them needs the context registration to be
    // shared first, which is a separate change.
    const applyPreset = vi.fn();
    useWorkspaceStore.setState({ applyPreset });

    renderPalette();
    fireEvent.click(screen.getByText("화면구성: 저널"));

    expect(applyPreset).toHaveBeenCalledWith("journal");
  });
});

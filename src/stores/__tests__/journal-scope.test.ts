/**
 * §85 M2b — Journal VaultContext migration tests
 * §56b — Journal workspace layout tests
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useContextStore } from "../context/context";
import { isActiveContextJournal } from "../file/file";
import { BUILTIN_PRESETS, useWorkspaceStore } from "../file/workspace";
import { useSettingsStore } from "../settings/store";
import { useUIStore } from "../ui/ui";

describe("§56b UIStore memories panel mode", () => {
  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 0));
    useUIStore.setState({
      rightPanelOpen: false,
      rightPanelMode: "chat",
    });
  });

  it("rightPanelMode accepts 'memories' value", () => {
    useUIStore.getState().setRightPanelMode("memories");
    expect(useUIStore.getState().rightPanelMode).toBe("memories");
  });

  it("can toggle right panel with memories mode", () => {
    useUIStore.getState().setRightPanelMode("memories");
    useUIStore.getState().toggleRightPanel();

    const state = useUIStore.getState();
    expect(state.rightPanelOpen).toBe(true);
    expect(state.rightPanelMode).toBe("memories");
  });
});

describe("§56b Journal workspace preset update", () => {
  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 0));
    useWorkspaceStore.setState({
      activePresetId: null,
      customPresets: [],
    });
    useUIStore.setState({
      sidebarOpen: true,
      sidebarPanel: "files",
      rightPanelOpen: false,
      rightPanelMode: "chat",
    });
  });

  it("journal preset opens right panel with memories mode", () => {
    const journalPreset = BUILTIN_PRESETS.find((p) => p.id === "journal");
    expect(journalPreset).toBeDefined();
    expect(journalPreset!.layout.rightPanelOpen).toBe(true);
    expect(journalPreset!.layout.rightPanelMode).toBe("memories");
  });

  it("applyPreset('journal') sets up memories view layout", () => {
    // Disable journal to avoid async auto-open logic
    useSettingsStore.setState({ journalEnabled: false });

    useWorkspaceStore.getState().applyPreset("journal");

    const ui = useUIStore.getState();
    expect(ui.sidebarOpen).toBe(true);
    expect(ui.sidebarPanel).toBe("calendar");
    expect(ui.rightPanelOpen).toBe(true);
    expect(ui.rightPanelMode).toBe("memories");
  });
});

describe("§85 M2b isActiveContextJournal", () => {
  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 0));
    useContextStore.setState({
      contexts: [],
      activeContextId: null,
    });
  });

  it("returns false when no active context", () => {
    expect(isActiveContextJournal()).toBe(false);
  });

  it("returns false when active context is a regular vault", () => {
    useContextStore.setState({
      contexts: [
        {
          id: "ctx-1",
          contextType: "vault",
          path: "/Users/test/vault",
          label: "vault",
          color: "#3b82f6",
          addedAt: Date.now(),
        },
      ],
      activeContextId: "ctx-1",
    });
    expect(isActiveContextJournal()).toBe(false);
  });

  it("returns true when active context is a journal vault", () => {
    useContextStore.setState({
      contexts: [
        {
          id: "ctx-1",
          contextType: "vault",
          path: "/Users/test/vault",
          label: "vault",
          color: "#3b82f6",
          addedAt: Date.now(),
        },
        {
          id: "ctx-j",
          contextType: "vault",
          path: "/Users/test/journals",
          label: "journal",
          color: "#10b981",
          vaultType: "journal",
          addedAt: Date.now(),
        },
      ],
      activeContextId: "ctx-j",
    });
    expect(isActiveContextJournal()).toBe(true);
  });

  it("returns false when journal context exists but is not active", () => {
    useContextStore.setState({
      contexts: [
        {
          id: "ctx-1",
          contextType: "vault",
          path: "/Users/test/vault",
          label: "vault",
          color: "#3b82f6",
          addedAt: Date.now(),
        },
        {
          id: "ctx-j",
          contextType: "vault",
          path: "/Users/test/journals",
          label: "journal",
          color: "#10b981",
          vaultType: "journal",
          addedAt: Date.now(),
        },
      ],
      activeContextId: "ctx-1",
    });
    expect(isActiveContextJournal()).toBe(false);
  });
});

describe("§56a Settings: journalUseHierarchy", () => {
  it("has journalUseHierarchy setting with default true", () => {
    const state = useSettingsStore.getState();
    expect(state).toHaveProperty("journalUseHierarchy");
    expect(state.journalUseHierarchy).toBe(true);
  });

  it("has setJournalUseHierarchy setter", () => {
    useSettingsStore.getState().setJournalUseHierarchy(false);
    expect(useSettingsStore.getState().journalUseHierarchy).toBe(false);

    useSettingsStore.getState().setJournalUseHierarchy(true);
    expect(useSettingsStore.getState().journalUseHierarchy).toBe(true);
  });
});

describe("§82 revertSpaceIfContextClosed", () => {
  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 0));
    // Empty contexts so applyPreset('writing') has no context to switch to.
    useContextStore.setState({ contexts: [], activeContextId: null });
    useWorkspaceStore.setState({ activePresetId: null, customPresets: [] });
  });

  it("reverts to writing when the active journal space's context is closed", () => {
    useWorkspaceStore.setState({ activePresetId: "journal" });
    useWorkspaceStore.getState().revertSpaceIfContextClosed("journal");
    expect(useWorkspaceStore.getState().activePresetId).toBe("writing");
  });

  it("reverts to writing when the active zettelkasten space's context is closed", () => {
    useWorkspaceStore.setState({ activePresetId: "zettelkasten" });
    useWorkspaceStore.getState().revertSpaceIfContextClosed("zettelkasten");
    expect(useWorkspaceStore.getState().activePresetId).toBe("writing");
  });

  it("does not revert when a non-space (general) context is closed", () => {
    useWorkspaceStore.setState({ activePresetId: "zettelkasten" });
    useWorkspaceStore.getState().revertSpaceIfContextClosed("general");
    expect(useWorkspaceStore.getState().activePresetId).toBe("zettelkasten");
  });

  it("does not revert when the closed context's space is not the active space", () => {
    // In the Writing space, closing a leftover zettelkasten context tab must
    // not change the space.
    useWorkspaceStore.setState({ activePresetId: "writing" });
    useWorkspaceStore.getState().revertSpaceIfContextClosed("zettelkasten");
    expect(useWorkspaceStore.getState().activePresetId).toBe("writing");
  });

  it("does not revert when the closed context has no vaultType", () => {
    useWorkspaceStore.setState({ activePresetId: "journal" });
    useWorkspaceStore.getState().revertSpaceIfContextClosed(undefined);
    expect(useWorkspaceStore.getState().activePresetId).toBe("journal");
  });

  it("keeps the sidebar open when reverting if it was open", () => {
    useUIStore.setState({ sidebarOpen: true });
    useWorkspaceStore.setState({ activePresetId: "zettelkasten" });
    useWorkspaceStore.getState().revertSpaceIfContextClosed("zettelkasten");
    expect(useWorkspaceStore.getState().activePresetId).toBe("writing");
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it("leaves the sidebar closed when reverting if it was closed", () => {
    useUIStore.setState({ sidebarOpen: false });
    useWorkspaceStore.setState({ activePresetId: "journal" });
    useWorkspaceStore.getState().revertSpaceIfContextClosed("journal");
    expect(useWorkspaceStore.getState().activePresetId).toBe("writing");
    expect(useUIStore.getState().sidebarOpen).toBe(false);
  });
});

describe("§93 applyPreset zettelkasten readiness guard", () => {
  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 0));
    useWorkspaceStore.setState({ activePresetId: null, customPresets: [] });
    useUIStore.setState({ toast: null });
  });

  it("does not switch + toasts when the Zettel feature is disabled", () => {
    useSettingsStore.setState({ zettelkastenEnabled: false });
    useWorkspaceStore.getState().applyPreset("zettelkasten");
    expect(useWorkspaceStore.getState().activePresetId).not.toBe(
      "zettelkasten",
    );
    expect(useUIStore.getState().toast?.message).toBeTruthy();
  });

  it("does not switch + toasts when enabled but no directory is set", () => {
    useSettingsStore.setState({
      zettelkastenEnabled: true,
      zettelkastenDirectory: "",
    });
    useWorkspaceStore.getState().applyPreset("zettelkasten");
    expect(useWorkspaceStore.getState().activePresetId).not.toBe(
      "zettelkasten",
    );
    expect(useUIStore.getState().toast?.message).toBeTruthy();
  });
});

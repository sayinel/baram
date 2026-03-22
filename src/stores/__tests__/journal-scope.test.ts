/**
 * §56b Phase A — Journal Workspace Scoping & Layout Tests
 * §85 M2b — Journal VaultContext migration tests
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useContextStore } from "../context/context";
import { isActiveContextJournal, useFileStore } from "../file/file";
import { BUILTIN_PRESETS, useWorkspaceStore } from "../file/workspace";
import { useSettingsStore } from "../settings/store";
import { useUIStore } from "../ui/ui";

describe("§56b FileStore journal scoping", () => {
  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 0));
    useFileStore.setState({
      rootPath: "/Users/test/vault",
      fileTree: [
        {
          name: "docs",
          path: "/Users/test/vault/docs",
          isDir: true,
          children: [],
        },
        {
          name: "readme.md",
          path: "/Users/test/vault/readme.md",
          isDir: false,
        },
      ],
      openFiles: new Map(),
      originalRootPath: null,
      isJournalScoped: false,
    });
  });

  it("has originalRootPath and isJournalScoped fields", () => {
    const state = useFileStore.getState();
    expect(state).toHaveProperty("originalRootPath");
    expect(state).toHaveProperty("isJournalScoped");
    expect(state.originalRootPath).toBeNull();
    expect(state.isJournalScoped).toBe(false);
  });

  it("enterJournalScope saves original rootPath and sets journal path", () => {
    useFileStore.getState().enterJournalScope("/Users/test/journals");

    const state = useFileStore.getState();
    expect(state.originalRootPath).toBe("/Users/test/vault");
    expect(state.rootPath).toBe("/Users/test/journals");
    expect(state.isJournalScoped).toBe(true);
  });

  it("exitJournalScope restores original rootPath", () => {
    useFileStore.getState().enterJournalScope("/Users/test/journals");
    useFileStore.getState().exitJournalScope();

    const state = useFileStore.getState();
    expect(state.rootPath).toBe("/Users/test/vault");
    expect(state.originalRootPath).toBeNull();
    expect(state.isJournalScoped).toBe(false);
  });

  it("exitJournalScope is no-op when not scoped", () => {
    useFileStore.getState().exitJournalScope();

    const state = useFileStore.getState();
    expect(state.rootPath).toBe("/Users/test/vault");
    expect(state.isJournalScoped).toBe(false);
  });

  it("enterJournalScope while already scoped updates journal path without losing original", () => {
    useFileStore.getState().enterJournalScope("/Users/test/journals");
    useFileStore.getState().enterJournalScope("/Users/test/journals2");

    const state = useFileStore.getState();
    expect(state.originalRootPath).toBe("/Users/test/vault");
    expect(state.rootPath).toBe("/Users/test/journals2");
    expect(state.isJournalScoped).toBe(true);
  });
});

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

import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore, BUILTIN_PRESETS } from "../workspace-store";
import { useUIStore } from "../ui-store";

describe("§52 Workspace Store", () => {
  beforeEach(async () => {
    // Flush pending microtasks from persist middleware async callbacks
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // Reset stores to default state
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

  // --- Built-in Presets ---

  it("has 3 built-in presets", () => {
    expect(BUILTIN_PRESETS).toHaveLength(3);
    expect(BUILTIN_PRESETS.map((p) => p.id)).toEqual([
      "writing",
      "journal",
      "skills",
    ]);
  });

  it("all built-in presets are marked as builtIn", () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(preset.builtIn).toBe(true);
    }
  });

  it("getAllPresets returns built-in + custom presets", () => {
    const store = useWorkspaceStore.getState();
    expect(store.getAllPresets()).toHaveLength(3);
  });

  it("getPreset finds built-in preset by id", () => {
    const store = useWorkspaceStore.getState();
    const writing = store.getPreset("writing");
    expect(writing).toBeDefined();
    expect(writing!.name).toBe("Writing");
  });

  // --- Apply Preset ---

  it("applyPreset('writing') hides both sidebars", () => {
    useWorkspaceStore.getState().applyPreset("writing");

    const ui = useUIStore.getState();
    expect(ui.sidebarOpen).toBe(false);
    expect(ui.rightPanelOpen).toBe(false);
    expect(useWorkspaceStore.getState().activePresetId).toBe("writing");
  });

  it("applyPreset with unknown id does nothing", () => {
    useWorkspaceStore.getState().applyPreset("nonexistent");
    expect(useWorkspaceStore.getState().activePresetId).toBeNull();
  });

  // --- Custom Presets ---

  it("saveCustomPreset captures current UI state", () => {
    useUIStore.setState({
      sidebarOpen: true,
      sidebarPanel: "outline",
      rightPanelOpen: true,
      rightPanelMode: "help",
    });

    const id = useWorkspaceStore
      .getState()
      .saveCustomPreset("My Layout", "테스트용");

    const preset = useWorkspaceStore.getState().getPreset(id);
    expect(preset).toBeDefined();
    expect(preset!.name).toBe("My Layout");
    expect(preset!.description).toBe("테스트용");
    expect(preset!.builtIn).toBe(false);
    expect(preset!.layout.sidebarOpen).toBe(true);
    expect(preset!.layout.sidebarPanel).toBe("outline");
    expect(preset!.layout.rightPanelOpen).toBe(true);
    expect(preset!.layout.rightPanelMode).toBe("help");
    expect(useWorkspaceStore.getState().activePresetId).toBe(id);
  });

  it("saveCustomPreset without description defaults to empty string", () => {
    const id = useWorkspaceStore.getState().saveCustomPreset("Simple");
    const preset = useWorkspaceStore.getState().getPreset(id);
    expect(preset!.description).toBe("");
  });

  it("getAllPresets includes custom presets after built-ins", () => {
    useWorkspaceStore.getState().saveCustomPreset("Custom 1");
    useWorkspaceStore.getState().saveCustomPreset("Custom 2");

    const all = useWorkspaceStore.getState().getAllPresets();
    expect(all).toHaveLength(5);
    expect(all[0].builtIn).toBe(true);
    expect(all[3].builtIn).toBe(false);
    expect(all[3].name).toBe("Custom 1");
  });

  it("deleteCustomPreset removes preset and clears activePresetId when active", () => {
    // Use setState directly to avoid persist middleware race conditions
    const presets = [
      {
        id: "test-1",
        name: "First",
        description: "",
        builtIn: false,
        layout: {
          sidebarOpen: true,
          sidebarPanel: "files" as const,
          rightPanelOpen: false,
          rightPanelMode: "none" as const,
        },
      },
      {
        id: "test-2",
        name: "Second",
        description: "",
        builtIn: false,
        layout: {
          sidebarOpen: false,
          sidebarPanel: "files" as const,
          rightPanelOpen: true,
          rightPanelMode: "chat" as const,
        },
      },
    ];
    useWorkspaceStore.setState({
      customPresets: presets,
      activePresetId: "test-2",
    });

    // Delete non-active — activePresetId stays
    useWorkspaceStore.getState().deleteCustomPreset("test-1");
    expect(useWorkspaceStore.getState().activePresetId).toBe("test-2");
    expect(useWorkspaceStore.getState().customPresets).toHaveLength(1);

    // Delete active — activePresetId becomes null
    useWorkspaceStore.getState().deleteCustomPreset("test-2");
    expect(useWorkspaceStore.getState().activePresetId).toBeNull();
    expect(useWorkspaceStore.getState().customPresets).toHaveLength(0);
  });

  it("renameCustomPreset updates the name", () => {
    const id = useWorkspaceStore.getState().saveCustomPreset("Old Name");
    useWorkspaceStore.getState().renameCustomPreset(id, "New Name");

    const preset = useWorkspaceStore.getState().getPreset(id);
    expect(preset!.name).toBe("New Name");
  });

  // --- Apply Custom Preset ---

  it("skills preset activates properties panel", () => {
    useWorkspaceStore.getState().applyPreset("skills");
    const ui = useUIStore.getState();
    expect(ui.rightPanelOpen).toBe(true);
    expect(ui.rightPanelMode).toBe("properties");
    expect(ui.sidebarOpen).toBe(true);
  });

  it("applyPreset works with custom presets", () => {
    useUIStore.setState({
      sidebarOpen: false,
      sidebarPanel: "graph",
      rightPanelOpen: true,
      rightPanelMode: "help",
    });
    const id = useWorkspaceStore.getState().saveCustomPreset("Graph Layout");

    // Reset UI
    useUIStore.setState({
      sidebarOpen: true,
      sidebarPanel: "files",
      rightPanelOpen: false,
      rightPanelMode: "chat",
    });

    // Apply saved preset
    useWorkspaceStore.getState().applyPreset(id);

    const ui = useUIStore.getState();
    expect(ui.sidebarOpen).toBe(false);
    expect(ui.sidebarPanel).toBe("graph");
    expect(ui.rightPanelOpen).toBe(true);
    expect(ui.rightPanelMode).toBe("help");
  });
});

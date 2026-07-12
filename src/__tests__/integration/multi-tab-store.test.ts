// Integration: Multi-tab + Store — tab open/switch/close + dirty state + store sync
import { beforeEach, describe, expect, it } from "vitest";

import { type EditorTab, useEditorStore } from "../../stores/editor/editor";
import { useUIStore } from "../../stores/ui/ui";

function makeTab(id: string, filePath: string): EditorTab {
  return {
    id,
    contextId: "",
    filePath,
    title: filePath.split("/").pop() || id,
    isDirty: false,
    isPinned: false,
  };
}

describe("Integration: Multi-tab + Store", () => {
  beforeEach(() => {
    // Reset stores to default state
    useEditorStore.setState({
      activeTabId: null,
      tabs: [],
    });
    useUIStore.setState({
      sidebarOpen: true,
      sidebarPanel: "files",
      sidebarWidth: 260,
      rightPanelOpen: false,
      rightPanelWidth: 300,
      commandPaletteOpen: false,
      settingsOpen: false,
      exportDialogOpen: false,
      exportFormat: "html",
    });
  });

  it("opens 3 tabs and switches active tab", () => {
    const { openTab, setActiveTab } = useEditorStore.getState();

    openTab(makeTab("t1", "/doc1.md"));
    openTab(makeTab("t2", "/doc2.md"));
    openTab(makeTab("t3", "/doc3.md"));

    const state = useEditorStore.getState();
    expect(state.tabs).toHaveLength(3);
    expect(state.activeTabId).toBe("t3"); // last opened is active

    setActiveTab("t1");
    expect(useEditorStore.getState().activeTabId).toBe("t1");
  });

  it("closing active tab activates the last remaining tab", () => {
    const { openTab, closeTab } = useEditorStore.getState();

    openTab(makeTab("t1", "/doc1.md"));
    openTab(makeTab("t2", "/doc2.md"));
    openTab(makeTab("t3", "/doc3.md"));

    // Active is t3, close it
    closeTab("t3");

    const state = useEditorStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe("t2"); // last tab in remaining list
  });

  it("tracks dirty state per tab", () => {
    const { openTab, markDirty } = useEditorStore.getState();

    openTab(makeTab("t1", "/doc1.md"));
    openTab(makeTab("t2", "/doc2.md"));

    markDirty("t1", true);

    const state = useEditorStore.getState();
    const tab1 = state.tabs.find((t) => t.id === "t1");
    const tab2 = state.tabs.find((t) => t.id === "t2");

    expect(tab1?.isDirty).toBe(true);
    expect(tab2?.isDirty).toBe(false);

    // Clear dirty
    useEditorStore.getState().markDirty("t1", false);
    expect(
      useEditorStore.getState().tabs.find((t) => t.id === "t1")?.isDirty,
    ).toBe(false);
  });

  it("prevents duplicate tabs for the same file path", () => {
    const { openTab } = useEditorStore.getState();

    openTab(makeTab("t1", "/same-file.md"));
    openTab(makeTab("t2", "/same-file.md")); // duplicate path

    const state = useEditorStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe("t1"); // existing tab activated
  });

  it("UI store sidebar and command palette sync independently", () => {
    const { setSidebarPanel, toggleCommandPalette } = useUIStore.getState();

    // Change sidebar panel
    setSidebarPanel("outline");
    expect(useUIStore.getState().sidebarPanel).toBe("outline");

    // Toggle command palette
    toggleCommandPalette();
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);

    // Sidebar panel unchanged
    expect(useUIStore.getState().sidebarPanel).toBe("outline");

    // Toggle back
    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });
});

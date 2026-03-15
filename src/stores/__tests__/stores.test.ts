import { describe, expect, it } from "vitest";

import { useAIStore } from "../ai/ai";
import { useEditorStore } from "../editor/editor";
import { useFileStore } from "../file/file";
import { useSettingsStore } from "../settings/store";
import { useUIStore } from "../ui/ui";

describe("Zustand stores smoke test", () => {
  it("editor store has default state", () => {
    const state = useEditorStore.getState();
    expect(state.activeTabId).toBeNull();
    expect(state.tabs).toEqual([]);
  });

  it("file store has default state", () => {
    const state = useFileStore.getState();
    expect(state.rootPath).toBeNull();
    expect(state.fileTree).toEqual([]);
  });

  it("ui store has default state", () => {
    const state = useUIStore.getState();
    expect(state.sidebarOpen).toBe(true);
    expect(state.sidebarPanel).toBe("files");
    expect(state.commandPaletteOpen).toBe(false);
  });

  it("settings store has default state", () => {
    const state = useSettingsStore.getState();
    expect(state.theme).toBe("system");
    expect(state.fontSize).toBe(16);
    expect(state.autoSave).toBe(true);
  });

  it("ai store has default state", () => {
    const state = useAIStore.getState();
    expect(state.provider).toBe("claude");
    expect(state.isStreaming).toBe(false);
    expect(state.ghostText).toBeNull();
  });

  it("editor store can open and close tabs", () => {
    const store = useEditorStore;
    store.getState().openTab({
      id: "tab-1",
      filePath: "/test.md",
      title: "test.md",
      isDirty: false,
      isPinned: false,
    });

    expect(store.getState().tabs).toHaveLength(1);
    expect(store.getState().activeTabId).toBe("tab-1");

    store.getState().closeTab("tab-1");
    expect(store.getState().tabs).toHaveLength(0);
    expect(store.getState().activeTabId).toBeNull();
  });
});

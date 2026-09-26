import { describe, expect, it } from "vitest";

import { readEditorTypography } from "../../hooks/use-editor-typography";
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
    // §370 크롬 표면은 기본이 전부 보임이다.
    expect(state.activityBarVisible).toBe(true);
    expect(state.statusBarVisible).toBe(true);
    expect(state.tabBarVisible).toBe(true);
  });

  // §370/CLAUDE.md "고빈도 경로의 store write는 동등성 관문 필수" — setChromeVisibility가
  // 값이 같을 때도 알림을 내면 partial이 새 root가 되어 모든 리스너를 깨운다.
  describe("ui store setChromeVisibility", () => {
    it("notifies once when a value actually changes", () => {
      useUIStore.setState({
        activityBarVisible: true,
        statusBarVisible: true,
        tabBarVisible: true,
      });
      let notifications = 0;
      const unsub = useUIStore.subscribe(() => {
        notifications++;
      });
      useUIStore.getState().setChromeVisibility({
        activityBarVisible: false,
        statusBarVisible: true,
        tabBarVisible: true,
      });
      unsub();
      expect(notifications).toBe(1);
      expect(useUIStore.getState().activityBarVisible).toBe(false);
    });

    it("does not notify when called again with the same values", () => {
      useUIStore.setState({
        activityBarVisible: false,
        statusBarVisible: true,
        tabBarVisible: true,
      });

      let notifications = 0;
      const unsub = useUIStore.subscribe(() => {
        notifications++;
      });
      useUIStore.getState().setChromeVisibility({
        activityBarVisible: false,
        statusBarVisible: true,
        tabBarVisible: true,
      });
      unsub();

      expect(notifications).toBe(0);
    });
  });

  it("settings store has default state", () => {
    const state = useSettingsStore.getState();
    expect(state.theme).toBe("system");
    expect(readEditorTypography().fontSize).toBe(16);
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
      contextId: "",
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

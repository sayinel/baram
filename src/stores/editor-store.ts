// §3.5 에디터 상태 스토어
import { create } from "zustand";

export interface EditorTab {
  id: string;
  filePath: string;
  title: string;
  isDirty: boolean;
}

interface EditorState {
  activeTabId: string | null;
  tabs: EditorTab[];
  isSourceMode: boolean;

  setActiveTab: (tabId: string) => void;
  openTab: (tab: EditorTab) => void;
  closeTab: (tabId: string) => void;
  markDirty: (tabId: string, dirty: boolean) => void;
  toggleSourceMode: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeTabId: null,
  tabs: [],
  isSourceMode: false,

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  openTab: (tab) =>
    set((state) => {
      const existing = state.tabs.find((t) => t.filePath === tab.filePath);
      if (existing) {
        return { activeTabId: existing.id };
      }
      return {
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
      };
    }),

  closeTab: (tabId) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== tabId);
      const activeTabId =
        state.activeTabId === tabId
          ? (tabs[tabs.length - 1]?.id ?? null)
          : state.activeTabId;
      return { tabs, activeTabId };
    }),

  markDirty: (tabId, dirty) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isDirty: dirty } : t,
      ),
    })),

  toggleSourceMode: () =>
    set((state) => ({ isSourceMode: !state.isSourceMode })),
}));

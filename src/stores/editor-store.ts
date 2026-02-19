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
  /** §39 MRU tab order — index 0 is most recently used */
  mruOrder: string[];

  setActiveTab: (tabId: string) => void;
  openTab: (tab: EditorTab) => void;
  closeTab: (tabId: string) => void;
  markDirty: (tabId: string, dirty: boolean) => void;
  toggleSourceMode: () => void;
  /** §39 Move tabId to front of MRU list */
  touchMru: (tabId: string) => void;
  /** §39 Get next/previous tab in MRU order (wraps around). Returns null if ≤1 tab. */
  getNextMruTab: (
    currentId: string,
    direction: "forward" | "backward",
  ) => string | null;
  /** §33 Rename tab: update filePath and title for a renamed file */
  renameTab: (oldPath: string, newPath: string, newTitle: string) => void;
  /** Reorder tab from one index to another */
  reorderTab: (fromIndex: number, toIndex: number) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeTabId: null,
  tabs: [],
  isSourceMode: false,
  mruOrder: [],

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  openTab: (tab) =>
    set((state) => {
      const existing = state.tabs.find((t) => t.filePath === tab.filePath);
      if (existing) {
        // §39 Touch MRU for existing tab
        const mruOrder = [
          existing.id,
          ...state.mruOrder.filter((id) => id !== existing.id),
        ];
        return { activeTabId: existing.id, mruOrder };
      }
      // §39 New tab goes to front of MRU
      const mruOrder = [tab.id, ...state.mruOrder];
      return {
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        mruOrder,
      };
    }),

  closeTab: (tabId) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== tabId);
      const activeTabId =
        state.activeTabId === tabId
          ? (tabs[tabs.length - 1]?.id ?? null)
          : state.activeTabId;
      // §39 Remove closed tab from MRU
      const mruOrder = state.mruOrder.filter((id) => id !== tabId);
      return { tabs, activeTabId, mruOrder };
    }),

  markDirty: (tabId, dirty) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isDirty: dirty } : t,
      ),
    })),

  toggleSourceMode: () =>
    set((state) => ({ isSourceMode: !state.isSourceMode })),

  touchMru: (tabId) =>
    set((state) => {
      const filtered = state.mruOrder.filter((id) => id !== tabId);
      return { mruOrder: [tabId, ...filtered] };
    }),

  renameTab: (oldPath, newPath, newTitle) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.filePath === oldPath ? { ...t, filePath: newPath, title: newTitle } : t,
      ),
    })),

  reorderTab: (fromIndex, toIndex) =>
    set((state) => {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      return { tabs };
    }),

  getNextMruTab: (currentId, direction) => {
    const { mruOrder } = get();
    if (mruOrder.length <= 1) return null;
    const idx = mruOrder.indexOf(currentId);
    if (idx === -1) return null;
    if (direction === "forward") {
      return mruOrder[(idx + 1) % mruOrder.length];
    }
    return mruOrder[(idx - 1 + mruOrder.length) % mruOrder.length];
  },
}));

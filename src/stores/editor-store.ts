// §3.5 에디터 상태 스토어
import { create } from "zustand";

export type EditorTabType = "file" | "graph";

export interface EditorTab {
  id: string;
  filePath: string;
  title: string;
  isDirty: boolean;
  /** §38 Tab Pin */
  isPinned: boolean;
  /** Tab type — defaults to "file" for backward compat */
  type?: EditorTabType;
}

export function isFileTab(tab: EditorTab | undefined): boolean {
  return !!tab && (!tab.type || tab.type === "file");
}
export function isGraphTab(tab: EditorTab | undefined): boolean {
  return tab?.type === "graph";
}

interface EditorState {
  activeTabId: string | null;
  tabs: EditorTab[];
  isSourceMode: boolean;
  /** §39 MRU tab order — index 0 is most recently used */
  mruOrder: string[];
  /** §44 Current editor selection text (for @selection reference) */
  currentSelection: string;

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
  /** §61 Rename directory: update all tabs whose filePath starts with oldDir */
  renameDirInTabs: (oldDir: string, newDir: string) => void;
  /** Reorder tab from one index to another */
  reorderTab: (fromIndex: number, toIndex: number) => void;
  /** §38 Pin a tab — moves to end of pinned group */
  pinTab: (tabId: string) => void;
  /** §38 Unpin a tab — moves to start of unpinned group */
  unpinTab: (tabId: string) => void;
  /** §38 Toggle pin state */
  togglePinTab: (tabId: string) => void;
  /** §38 Close all unpinned tabs except the given one */
  closeOtherTabs: (tabId: string) => void;
  /** §38 Close unpinned tabs to the right of the given tab */
  closeTabsToRight: (tabId: string) => void;
  /** Open graph view as a singleton tab */
  openGraphTab: () => void;
  /** §44 Update current editor selection text */
  setCurrentSelection: (text: string) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeTabId: null,
  tabs: [],
  isSourceMode: false,
  mruOrder: [],
  currentSelection: "",

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  openTab: (tab) =>
    set((state) => {
      // Only dedup on non-empty filePath to avoid untitled/graph collisions
      const existing = tab.filePath
        ? state.tabs.find((t) => t.filePath === tab.filePath)
        : undefined;
      if (existing) {
        // §39 Touch MRU for existing tab
        const mruOrder = [
          existing.id,
          ...state.mruOrder.filter((id) => id !== existing.id),
        ];
        return { activeTabId: existing.id, mruOrder };
      }
      // §38 New tab always unpinned
      const newTab = { ...tab, isPinned: false };
      // §39 New tab goes to front of MRU
      const mruOrder = [newTab.id, ...state.mruOrder];
      return {
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
        mruOrder,
      };
    }),

  closeTab: (tabId) =>
    set((state) => {
      // §38 Pinned tabs cannot be closed
      const target = state.tabs.find((t) => t.id === tabId);
      if (target?.isPinned) return state;

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

  renameDirInTabs: (oldDir, newDir) =>
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.filePath && (t.filePath === oldDir || t.filePath.startsWith(oldDir + "/"))) {
          const newFilePath = newDir + t.filePath.slice(oldDir.length);
          const newTitle = newFilePath.split("/").pop() ?? t.title;
          return { ...t, filePath: newFilePath, title: newTitle };
        }
        return t;
      }),
    })),

  reorderTab: (fromIndex, toIndex) =>
    set((state) => {
      const tabs = [...state.tabs];
      const pinnedCount = tabs.filter((t) => t.isPinned).length;
      const moving = tabs[fromIndex];
      if (!moving) return state;

      // §38 Clamp: pinned tabs stay in 0..pinnedCount-1, unpinned in pinnedCount..length-1
      let clampedTo = toIndex;
      if (moving.isPinned) {
        clampedTo = Math.max(0, Math.min(clampedTo, pinnedCount - 1));
      } else {
        clampedTo = Math.max(pinnedCount, Math.min(clampedTo, tabs.length - 1));
      }

      if (clampedTo === fromIndex) return state;
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(clampedTo, 0, moved);
      return { tabs };
    }),

  pinTab: (tabId) =>
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1 || state.tabs[idx].isPinned) return state;
      const tabs = [...state.tabs];
      const [tab] = tabs.splice(idx, 1);
      const pinned = { ...tab, isPinned: true };
      // Insert at end of pinned group
      const pinnedCount = tabs.filter((t) => t.isPinned).length;
      tabs.splice(pinnedCount, 0, pinned);
      return { tabs };
    }),

  unpinTab: (tabId) =>
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1 || !state.tabs[idx].isPinned) return state;
      const tabs = [...state.tabs];
      const [tab] = tabs.splice(idx, 1);
      const unpinned = { ...tab, isPinned: false };
      // Insert at start of unpinned group
      const pinnedCount = tabs.filter((t) => t.isPinned).length;
      tabs.splice(pinnedCount, 0, unpinned);
      return { tabs };
    }),

  togglePinTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.isPinned) {
      get().unpinTab(tabId);
    } else {
      get().pinTab(tabId);
    }
  },

  closeOtherTabs: (tabId) =>
    set((state) => {
      // §38 Keep pinned tabs + the specified tab; close all other unpinned tabs
      const tabs = state.tabs.filter((t) => t.isPinned || t.id === tabId);
      const closedIds = new Set(
        state.tabs.filter((t) => !t.isPinned && t.id !== tabId).map((t) => t.id),
      );
      const activeTabId = closedIds.has(state.activeTabId ?? "")
        ? tabId
        : state.activeTabId;
      const mruOrder = state.mruOrder.filter((id) => !closedIds.has(id));
      return { tabs, activeTabId, mruOrder };
    }),

  closeTabsToRight: (tabId) =>
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return state;
      // §38 Close unpinned tabs to the right of tabId
      const tabs = state.tabs.filter(
        (t, i) => i <= idx || t.isPinned,
      );
      const closedIds = new Set(
        state.tabs
          .filter((t, i) => i > idx && !t.isPinned)
          .map((t) => t.id),
      );
      const activeTabId = closedIds.has(state.activeTabId ?? "")
        ? tabId
        : state.activeTabId;
      const mruOrder = state.mruOrder.filter((id) => !closedIds.has(id));
      return { tabs, activeTabId, mruOrder };
    }),

  openGraphTab: () => {
    const { tabs, openTab: open, setActiveTab } = get();
    // Singleton: if graph tab already exists, just activate it
    const existing = tabs.find((t) => t.type === "graph");
    if (existing) {
      setActiveTab(existing.id);
      return;
    }
    open({
      id: crypto.randomUUID(),
      filePath: "",
      title: "Graph View",
      isDirty: false,
      isPinned: false,
      type: "graph",
    });
  },

  setCurrentSelection: (text) => set({ currentSelection: text }),

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

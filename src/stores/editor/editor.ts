// §3.5 에디터 상태 스토어
import { create } from "zustand";

import { useContextStore } from "../context/context";

export interface EditorTab {
  /** §83 The context this tab belongs to */
  contextId: string;
  filePath: string;
  id: string;
  isDirty: boolean;
  /** §38 Tab Pin */
  isPinned: boolean;
  /**
   * §69 Which plugin a `type: "plugin"` tab shows. Only that type sets it.
   *
   * ‼️ Deliberately NOT parked in `filePath`: the graph tab could get away with
   * `filePath: ""` because it needs no payload, but a plugin id in that field would be
   * read as a path by `handleSave` (which offers Save As for a falsy path) and by the
   * tab-switching loader.
   */
  pluginId?: string;
  title: string;
  /** Tab type — defaults to "file" for backward compat */
  type?: EditorTabType;
}

export type EditorTabType = "file" | "graph" | "plugin";

interface EditorState {
  activeTabId: null | string;
  /** Close all tabs (including pinned) */
  closeAllTabs: () => void;
  /** §38 Close all unpinned tabs except the given one */
  closeOtherTabs: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  /** §38 Close unpinned tabs to the right of the given tab */
  closeTabsToRight: (tabId: string) => void;
  /** §72 Bumped when external code (e.g. PropertiesPanel) updates file content in store */
  contentRefreshKey: number;

  /** §44 Current editor selection text (for @selection reference) */
  currentSelection: string;
  /** §39 Get next/previous tab in MRU order (wraps around). Returns null if ≤1 tab. */
  getNextMruTab: (
    currentId: string,
    direction: "backward" | "forward",
  ) => null | string;
  markDirty: (tabId: string, dirty: boolean) => void;
  /** §39 MRU tab order — index 0 is most recently used */
  mruOrder: string[];
  /** Open graph view as a singleton tab */
  openGraphTab: () => void;
  /** §69 Open a plugin's detail view as a singleton tab PER PLUGIN */
  openPluginTab: (pluginId: string, title: string) => void;
  openTab: (tab: EditorTab) => void;
  /** §38 Pin a tab — moves to end of pinned group */
  pinTab: (tabId: string) => void;
  /** §61 Rename directory: update all tabs whose filePath starts with oldDir */
  renameDirInTabs: (oldDir: string, newDir: string) => void;
  /** §33 Rename tab: update filePath and title for a renamed file */
  renameTab: (oldPath: string, newPath: string, newTitle: string) => void;
  /** Reorder tab from one index to another */
  reorderTab: (fromIndex: number, toIndex: number) => void;
  /** §72 Signal editor to re-read content from fileStore */
  requestContentRefresh: () => void;
  setActiveTab: (tabId: string) => void;
  /** §44 Update current editor selection text */
  setCurrentSelection: (text: string) => void;
  /**
   * §69 Set a tab's display title.
   *
   * `renameTab` is for files and keys on a path; a plugin tab's label follows the installed
   * manifest's `name`, which can change under it on an update.
   */
  setTabTitle: (tabId: string, title: string) => void;
  tabs: EditorTab[];
  /** §38 Toggle pin state */
  togglePinTab: (tabId: string) => void;
  /** §39 Move tabId to front of MRU list */
  touchMru: (tabId: string) => void;
  /** §38 Unpin a tab — moves to start of unpinned group */
  unpinTab: (tabId: string) => void;
}
/**
 * A type predicate, not just a boolean: callers that pass the result as a gate — "return
 * unless this is a file tab" — then get `filePath` narrowed for free, which is what makes
 * the inverted guards (`if (!isFileTab(tab)) return;`) readable instead of needing a second
 * `tab &&` beside them.
 */
export function isFileTab(tab: EditorTab | undefined): tab is EditorTab {
  return !!tab && (!tab.type || tab.type === "file");
}

export function isGraphTab(tab: EditorTab | undefined): boolean {
  return tab?.type === "graph";
}

/** §69 Plugin detail tab — a rendered control surface, not a document. */
export function isPluginTab(tab: EditorTab | undefined): boolean {
  return tab?.type === "plugin";
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeTabId: null,
  tabs: [],
  mruOrder: [],
  currentSelection: "",
  contentRefreshKey: 0,

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
    // §81 Auto-switch context when selecting a tab from a different vault
    const tab = get().tabs.find((t) => t.id === tabId);
    // ‼️ File tabs only. `openTab` backfills `contextId` from the active context for EVERY
    // tab, so a graph or plugin tab opened in vault A carries A's id — and selecting it later
    // switched the whole app back to A, replacing the file tree, for a tab that shows no vault
    // content at all. The backfill itself stays: it is also what makes `ContextTabBar` close
    // these tabs with their vault, and dropping it would leave an invisible orphan tab (the
    // tab bar only renders when a `rootPath` is set).
    if (isFileTab(tab) && tab.contextId) {
      const ctxStore = useContextStore.getState();
      if (ctxStore.activeContextId !== tab.contextId) {
        // §89 FileContext tabs are global — don't switch context when selected
        const tabCtx = ctxStore.contexts.find((c) => c.id === tab.contextId);
        if (tabCtx?.contextType === "file") {
          return; // External file tab — keep current vault context active
        }
        // Check if the tab's context has a different PATH (not just different ID)
        // IDs can differ due to dedup (legacy-xxx vs ctx-xxx) while path is same
        const activeCtx = ctxStore.activeContext();
        if (tabCtx && activeCtx && tabCtx.path === activeCtx.path) {
          return; // Same vault, different ID — no need to switch
        }
        // Lazy import to avoid circular dependency at module load
        import("../file/file").then(({ switchContext }) => {
          switchContext(tab.contextId);
        });
      }
    }
  },

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
      // §83 Auto-fill contextId from active context if empty
      const contextId =
        tab.contextId || useContextStore.getState().activeContextId || "";
      // §38 New tab always unpinned
      const newTab = { ...tab, contextId, isPinned: false };
      // §39 New tab goes to front of MRU
      const mruOrder = [newTab.id, ...state.mruOrder];
      return {
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
        mruOrder,
      };
    }),

  closeTab: (tabId) => {
    // Capture info before mutation for §89 FileContext cleanup
    const stateBefore = get();
    const target = stateBefore.tabs.find((t) => t.id === tabId);

    set((state) => {
      // §38 Pinned tabs cannot be closed
      if (target?.isPinned) return state;

      const tabs = state.tabs.filter((t) => t.id !== tabId);
      const activeTabId =
        state.activeTabId === tabId
          ? (tabs[tabs.length - 1]?.id ?? null)
          : state.activeTabId;
      // §39 Remove closed tab from MRU
      const mruOrder = state.mruOrder.filter((id) => id !== tabId);
      return { tabs, activeTabId, mruOrder };
    });

    // Clean up original doc tracking for dirty detection
    if (target && !target.isPinned) {
      import("../../utils/editor/programmatic-update").then(
        ({ clearOriginalDoc }) => clearOriginalDoc(tabId),
      );
    }

    // §89 Auto-remove FileContext when its last tab is closed
    if (target && !target.isPinned && target.contextId) {
      const contextStore = useContextStore.getState();
      const ctx = contextStore.contexts.find(
        (c) => c.id === target.contextId && c.contextType === "file",
      );
      if (ctx) {
        // ‼️ Count FILE tabs. A §89 FileContext exists to serve an open file, and the
        // backfilled `contextId` on a graph or plugin tab made this count 1 when the last real
        // file tab closed — leaking the context permanently, since nothing else removes it.
        const remainingTabs = get().tabs.filter(
          (t) => t.contextId === ctx.id && isFileTab(t),
        );
        if (remainingTabs.length === 0) {
          contextStore.removeContext(ctx.id).catch(() => {});
        }
      }
    }
  },

  markDirty: (tabId, dirty) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isDirty: dirty } : t,
      ),
    })),

  touchMru: (tabId) =>
    set((state) => {
      const filtered = state.mruOrder.filter((id) => id !== tabId);
      return { mruOrder: [tabId, ...filtered] };
    }),

  renameTab: (oldPath, newPath, newTitle) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.filePath === oldPath
          ? { ...t, filePath: newPath, title: newTitle }
          : t,
      ),
    })),

  renameDirInTabs: (oldDir, newDir) =>
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (
          t.filePath &&
          (t.filePath === oldDir || t.filePath.startsWith(oldDir + "/"))
        ) {
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
        state.tabs
          .filter((t) => !t.isPinned && t.id !== tabId)
          .map((t) => t.id),
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
      const tabs = state.tabs.filter((t, i) => i <= idx || t.isPinned);
      const closedIds = new Set(
        state.tabs.filter((t, i) => i > idx && !t.isPinned).map((t) => t.id),
      );
      const activeTabId = closedIds.has(state.activeTabId ?? "")
        ? tabId
        : state.activeTabId;
      const mruOrder = state.mruOrder.filter((id) => !closedIds.has(id));
      return { tabs, activeTabId, mruOrder };
    }),

  closeAllTabs: () =>
    set({
      tabs: [],
      activeTabId: null,
      mruOrder: [],
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
      contextId: "",
      id: crypto.randomUUID(),
      filePath: "",
      title: "Graph View",
      isDirty: false,
      isPinned: false,
      type: "graph",
    });
  },

  openPluginTab: (pluginId, title) => {
    const { tabs, openTab: open, setActiveTab } = get();
    // Singleton per plugin — NOT per type. The graph tab is one screen; this one is a
    // screen per plugin, so keying on `type` alone would show plugin A's detail under
    // plugin B's tab.
    const existing = tabs.find(
      (t) => t.type === "plugin" && t.pluginId === pluginId,
    );
    if (existing) {
      setActiveTab(existing.id);
      return;
    }
    open({
      contextId: "",
      id: crypto.randomUUID(),
      filePath: "",
      pluginId,
      title,
      isDirty: false,
      isPinned: false,
      type: "plugin",
    });
  },

  setTabTitle: (tabId, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
    })),

  setCurrentSelection: (text) => set({ currentSelection: text }),

  requestContentRefresh: () =>
    set((state) => ({ contentRefreshKey: state.contentRefreshKey + 1 })),

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

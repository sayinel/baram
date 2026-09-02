// §3.5 에디터 상태 스토어
import type { Editor } from "@tiptap/core";

import { create } from "zustand";

import { useContextStore } from "../context/context";

/**
 * §324-e 캡처 창의 편집기로 가는 통로 — 다이얼로그가 열려 있는 동안만 채워진다.
 *
 * 왜 스토어인가: OS에서 끌어온 파일 드래그는 ProseMirror가 아니라 Tauri 네이티브가
 * 가로채고(`use-external-drop.ts`의 `isExternalFileDrag`), 그것을 받는 훅은 App
 * 수준에서 **메인** 편집기 하나만 손에 들고 돌아간다. 캡처 편집기는 다이얼로그
 * 안에서 태어나 죽으므로, 그 훅이 볼 수 있는 유일한 방법이 이 게시판이다.
 * `sourceBufferAccess`(§312)와 같은 형태이고 같은 이유다 — 리렌더를 만들지 않는
 * 안정된 참조만 스토어에 산다.
 *
 * ‼️ 대가도 같다: 수명이다. 편집기 인스턴스를 닫고 있으므로 다이얼로그가 닫힐 때
 * 반드시 `registerCaptureDropAccess(null)`로 지워야 한다 — 안 그러면 그다음
 * **문서** 드랍이 파기된 캡처 편집기로 흘러들어 아무 데도 닿지 않는다.
 */
export interface CaptureDropAccess {
  /** 캡처 다이얼로그 자신의 편집기 인스턴스. */
  editor: Editor;
  /**
   * 이 캡처가 저장될 파일의 경로, 또는 지금 목적지가 없으면 `null`.
   *
   * ‼️ 다이얼로그의 `resolveDropDestination`을 **그대로** 실어 보낸다(재계산 금지).
   * 붙여넣기 경로가 쓰는 `DropHandler`의 `resolveDestinationPath`와 같은 함수여야
   * 한다 — 태스크 모드 여부는 다이얼로그만 알고, 설정에서 다시 유도하려 한 것이
   * 애초에 붙여넣기 경로를 태스크 모드에 눈멀게 한 결함이었다(§324-e round 1).
   */
  resolveDestinationPath: () => null | string;
}

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

/**
 * §312 소스 모드 버퍼로 가는 통로 — `useSourceMode`가 마운트돼 있는 동안만 채워진다.
 *
 * 버퍼 **데이터**는 훅의 ref Map에 그대로 남는다(`use-source-mode.ts:104`의 이유:
 * state로 두면 소스 모드에서 한 글자 칠 때마다 새 Map을 만든다). 스토어에 사는 것은
 * 안정된 함수 참조 두 개뿐이라 리렌더를 만들지 않으면서, React 밖에서 도는 §305 태스크
 * 쓰기 라우터가 **화면에 보이는** 텍스트에 닿게 해 준다.
 *
 * ‼️ 대가는 수명이다. 이 함수들은 훅의 ref를 닫고 있으므로 언마운트 때 반드시
 * `registerSourceBufferAccess(null)`로 지워야 한다 — 안 그러면 죽은 탭의 버퍼를
 * 가리키는 접근자에 태스크 쓰기가 흘러들어 아무도 읽지 않는 Map에 쓰게 된다.
 */
export interface SourceBufferAccess {
  getSourceBuffer: (tabId: string) => string;
  setSourceBuffer: (tabId: string, content: string) => void;
}

interface EditorState {
  activeTabId: null | string;
  /** §324-e Live capture-dialog editor access, or `null` when it is closed */
  captureDropAccess: CaptureDropAccess | null;
  /** §313 The tab's cached state has been discarded (or was never stale). */
  clearContentStale: (tabId: string) => void;
  /** Close all tabs (including pinned) */
  closeAllTabs: () => void;
  /** §38 Close all unpinned tabs except the given one */
  closeOtherTabs: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  /** §38 Close unpinned tabs to the right of the given tab */
  closeTabsToRight: (tabId: string) => void;
  /** §72 Bumped when external code (e.g. PropertiesPanel) updates file content in store */
  contentRefreshKey: number;
  /**
   * §313 How the refresh should reach the document.
   *
   * `"fresh"` throws the document away and builds a new one — right for a genuinely
   * external change, where the undo stack must NOT be able to walk back past someone
   * else's edit and have the next save write that walk-back to disk.
   *
   * `"patch"` replaces only the blocks that differ, in one transaction that stays out of
   * the history — right for a change this app made itself, which is already on disk and
   * has no business costing the user their undo stack, cursor, or node views.
   */
  contentRefreshMode: "fresh" | "patch";

  /**
   * §313 The file the refresh is about, or `null` for "whatever is active".
   *
   * The consumer rebuilds the ACTIVE tab from `openFiles`. A refresh caused by a write to
   * a background file therefore rebuilt the active tab from its own cached snapshot — and
   * for a dirty active tab that snapshot is older than the screen, so unsaved typing was
   * reverted by a change to an entirely different file. Naming the path makes the consumer
   * skip what is not its business.
   */
  contentRefreshPath: null | string;
  /** §44 Current editor selection text (for @selection reference) */
  currentSelection: string;
  /** §39 Get next/previous tab in MRU order (wraps around). Returns null if ≤1 tab. */
  getNextMruTab: (
    currentId: string,
    direction: "backward" | "forward",
  ) => null | string;
  /**
   * §313 Forget a tab's cached ProseMirror state — its file changed underneath it.
   *
   * A background tab is restored from `editorStateCache`, not from `openFiles`, so a write
   * to its file while it was away is invisible to it: switching back shows the pre-write
   * document and the next save writes that back over the change. Nothing in the mtime
   * bookkeeping catches it (an auto-reload leaves `canReloadMtime` and `lastSaveMtime`
   * equal), and it is silent — no toast, no conflict modal.
   *
   * Marked by whoever replaced the file's content in `openFiles`, consumed by the tab
   * switch, which then re-reads that fresh content instead of the cache.
   */
  markContentStale: (tabId: string) => void;
  /** Gated: no-op (same state reference) if the tab is already at `dirty` or doesn't exist */
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
  /** §324-e Publish (or clear with `null`) the open capture dialog's editor access */
  registerCaptureDropAccess: (access: CaptureDropAccess | null) => void;
  /** §312 Publish (or clear with `null`) the mounted source surface's buffer accessors */
  registerSourceBufferAccess: (access: null | SourceBufferAccess) => void;
  /** §61 Rename directory: update all tabs whose filePath starts with oldDir */
  renameDirInTabs: (oldDir: string, newDir: string) => void;
  /** §33 Rename tab: update filePath and title for a renamed file */
  renameTab: (oldPath: string, newPath: string, newTitle: string) => void;
  /** Reorder tab from one index to another */
  reorderTab: (fromIndex: number, toIndex: number) => void;
  /** §72 Signal editor to re-read content from fileStore */
  requestContentRefresh: (
    mode?: "fresh" | "patch",
    path?: null | string,
  ) => void;
  setActiveTab: (tabId: string) => void;
  /** §44 Update current editor selection text. Gated: no-op if unchanged */
  setCurrentSelection: (text: string) => void;
  /** §287/§312 Turn source mode on or off for one tab */
  setSourceModeForTab: (tabId: string, on: boolean) => void;
  /**
   * §69 Set a tab's display title.
   *
   * `renameTab` is for files and keys on a path; a plugin tab's label follows the installed
   * manifest's `name`, which can change under it on an update.
   */
  setTabTitle: (tabId: string, title: string) => void;
  /** §312 Live source-buffer accessors, or `null` when no source surface is mounted */
  sourceBufferAccess: null | SourceBufferAccess;
  /**
   * §287 Tabs showing raw markdown instead of WYSIWYG.
   *
   * ‼️ 훅의 `useState`가 아니라 여기 사는 이유: §305 태스크 쓰기 라우터가 React 밖에서
   * 이 값을 읽어야 한다. 못 읽으면 소스 모드인 더티 탭의 쓰기가 **보이지 않는**
   * ProseMirror 문서로 가고, 소스 모드를 끄거나 저장하는 순간 통째로 버려진다.
   */
  sourceModeTabs: string[];
  /** §313 Tabs whose cached ProseMirror state no longer matches `openFiles`. */
  staleContentTabs: string[];
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

/**
 * §312 닫힌 탭 id를 탭별 집합에서 뺀다 — 탭을 닫는 **모든** 경로가 이것을 부른다.
 *
 * 이런 집합은 탭 밖에 살기 때문에 수명도 탭보다 길다. `sourceModeTabs`는 §305 태스크
 * 쓰기 라우터의 입력이라, 죽은 id가 남으면 라우팅이 "그 탭은 소스 모드"라고 계속
 * 주장한다. §313 `staleContentTabs`도 같은 이유로 같은 규율을 받는다.
 *
 * ‼️ 뺄 것이 없으면 **같은 참조**를 돌려준다: 새 배열은 use-source-mode의 `useMemo`가
 * Set을 다시 만들게 해 그 소비자들의 memo를 전부 깬다.
 */
function withoutClosedTabs(
  tabIds: string[],
  isClosed: (id: string) => boolean,
): string[] {
  return tabIds.some(isClosed) ? tabIds.filter((id) => !isClosed(id)) : tabIds;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeTabId: null,
  tabs: [],
  mruOrder: [],
  currentSelection: "",
  contentRefreshKey: 0,
  contentRefreshMode: "fresh",
  contentRefreshPath: null,
  staleContentTabs: [],
  sourceModeTabs: [],
  sourceBufferAccess: null,
  captureDropAccess: null,

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
        // Dynamic import, deliberately: a static import of the service here would close
        // file.ts → editor.ts → vault-context-loader.ts → file.ts into a real, fully-static
        // 3-node cycle (the service needs useFileStore; closeFolder needs useEditorStore). This
        // edge is the one place we break that cycle — the fire-and-forget timing is unchanged
        // either way, since switchContext was never awaited here.
        import("../../services/vault-context-loader").then(
          ({ switchContext }) => {
            switchContext(tab.contextId);
          },
        );
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
      const closed = (id: string) => id === tabId;
      const sourceModeTabs = withoutClosedTabs(state.sourceModeTabs, closed);
      const staleContentTabs = withoutClosedTabs(
        state.staleContentTabs,
        closed,
      );
      return { tabs, activeTabId, mruOrder, sourceModeTabs, staleContentTabs };
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

  // 동등성 관문(CLAUDE.md 규약) — 매 keystroke마다 도는 auto-save가
  // 이미 dirty인 탭에 같은 값을 계속 밀어넣으므로, 값이 그대로면 새 배열을
  // 만들지 않고 기존 state를 그대로 돌려준다.
  markDirty: (tabId, dirty) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab || tab.isDirty === dirty) return state;
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, isDirty: dirty } : t,
        ),
      };
    }),

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
      const closed = (id: string) => closedIds.has(id);
      const sourceModeTabs = withoutClosedTabs(state.sourceModeTabs, closed);
      const staleContentTabs = withoutClosedTabs(
        state.staleContentTabs,
        closed,
      );
      return { tabs, activeTabId, mruOrder, sourceModeTabs, staleContentTabs };
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
      const closed = (id: string) => closedIds.has(id);
      const sourceModeTabs = withoutClosedTabs(state.sourceModeTabs, closed);
      const staleContentTabs = withoutClosedTabs(
        state.staleContentTabs,
        closed,
      );
      return { tabs, activeTabId, mruOrder, sourceModeTabs, staleContentTabs };
    }),

  closeAllTabs: () =>
    set((state) => ({
      tabs: [],
      activeTabId: null,
      mruOrder: [],
      sourceModeTabs: withoutClosedTabs(state.sourceModeTabs, () => true),
      staleContentTabs: withoutClosedTabs(state.staleContentTabs, () => true),
    })),

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

  // 동등성 관문(CLAUDE.md 규약) — ProseMirror selectionUpdate가 모든
  // 키 입력·커서 이동마다 이걸 부르고, 커서가 collapsed면 text는 항상 ""라
  // 값이 그대로일 때 새 root를 만들지 않는다.
  setCurrentSelection: (text) =>
    set((s) => (s.currentSelection === text ? s : { currentSelection: text })),

  // §287/§312 동등성 관문은 장식이 아니다. partial `set`은 값이 같아도 **새 root**를
  // 만들어 스토어 구독자 전부를 깨운다(CLAUDE.md 규약). 탭을 전환할 때마다 도는
  // "이 탭은 소스 모드가 아니다" 세팅이 그대로 앱 전역 리렌더가 된다.
  setSourceModeForTab: (tabId, on) =>
    set((state) => {
      if (state.sourceModeTabs.includes(tabId) === on) return state;
      return {
        sourceModeTabs: on
          ? [...state.sourceModeTabs, tabId]
          : state.sourceModeTabs.filter((id) => id !== tabId),
      };
    }),

  registerCaptureDropAccess: (access) =>
    set((state) =>
      state.captureDropAccess === access
        ? state
        : { captureDropAccess: access },
    ),

  registerSourceBufferAccess: (access) =>
    set((state) =>
      state.sourceBufferAccess === access
        ? state
        : { sourceBufferAccess: access },
    ),

  requestContentRefresh: (mode = "fresh", path = null) =>
    set((state) => ({
      contentRefreshKey: state.contentRefreshKey + 1,
      contentRefreshMode: mode,
      contentRefreshPath: path,
    })),

  markContentStale: (tabId) =>
    set((state) =>
      state.staleContentTabs.includes(tabId)
        ? state
        : { staleContentTabs: [...state.staleContentTabs, tabId] },
    ),

  clearContentStale: (tabId) =>
    set((state) =>
      state.staleContentTabs.includes(tabId)
        ? {
            staleContentTabs: state.staleContentTabs.filter(
              (id) => id !== tabId,
            ),
          }
        : state,
    ),

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

// §39 Tab switching hook — swap editor content when activeTabId changes
import { useEffect, useRef } from "react";

import type { ProgressiveLoadHandle } from "../utils/editor/progressive-load";
import type { KeepalivePool } from "./use-large-doc-keepalive";
import type { Editor } from "@tiptap/core";

import { EditorState } from "@tiptap/pm/state";

import { replaceEditorStateWithVim } from "../extensions/plugins/vim/replace-editor-state";
import { markdownToProsemirror } from "../pipeline/md-to-pm";
import { notifyFileOpen } from "../plugins/plugin-lifecycle";
import { isFileTab } from "../stores/editor/editor";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { useNavigationStore } from "../stores/ui/navigation";
import { setTabLoading } from "../utils/editor/programmatic-update";
import { isMarkdownFile } from "../utils/file-type";
import { gcClosedTabs } from "./tab-switching/gc-closed-tabs";
import { loadTabContent } from "./tab-switching/load-tab-content";
import { restoreCachedState } from "./tab-switching/restore-cached-state";
import { resumeKeepaliveTab } from "./tab-switching/resume-keepalive-tab";
import { saveOutgoingTab } from "./tab-switching/save-outgoing-tab";
import { installContent, type TabSwitchContext } from "./tab-switching/types";

interface UseTabSwitchingParams {
  /** [NEW-MODERATE-C] Shared ref for progressive append handles — also used
   *  by useSourceMode so cancelInflightAppend covers source-mode fills. */
  appendHandleRef: React.MutableRefObject<null | {
    handle: ProgressiveLoadHandle;
    tabId: string;
  }>;
  /** §perf-large-file C3.5: factory to create a keep-alive editor for a tab */
  createKeepaliveEditor: () => Editor;
  editor: Editor | null;
  /** Per-tab EditorState cache — owned by useSourceMode, shared here */
  editorStateCache: React.MutableRefObject<Map<string, EditorState>>;
  getSourceBuffer: (tabId: string) => string;
  isNavBackForwardRef: React.RefObject<boolean>;
  /** §perf-large-file C3.5: keep-alive editor pool for large documents */
  keepalive: KeepalivePool;
  /** §perf-large-file C3.5: notify App of the active editor change */
  onActiveEditorChange: (editor: Editor | null) => void;
  /**
   * §291 탭별 스크롤 오프셋 — **기록은 MarkdownSurface의 scroll 리스너가 한다.**
   *
   * ‼️ 여기서 읽지 않는 이유가 이 결함의 전부다. 이 effect는 React 커밋의 passive 단계에서
   * 도는데, 그때는 나가는 표면에 이미 `display:none`이 적용돼 있다(측정으로 확인:
   * effect가 관찰하는 style.display는 "none"이다). 레이아웃 박스가 사라진 컨테이너의
   * scrollTop은 0이므로, 여기서 읽으면 매번 0을 캐시하고 돌아올 때 문서 처음으로 간다.
   */
  scrollOffsets: React.MutableRefObject<Map<string, number>>;
  setFindReplaceMode: (mode: "find" | "replace") => void;
  setFindReplaceOpen: (open: boolean) => void;
  setIsParsing: (v: boolean) => void;
  setSourceBuffer: (tabId: string, content: string) => void;
  /** §287 소스 모드인 탭들. 나가는 탭의 모드를 그 탭 id로 물어보기 위해 필요하다. */
  sourceModeTabs: ReadonlySet<string>;
}

export function useTabSwitching({
  appendHandleRef,
  editor,
  editorStateCache,
  isNavBackForwardRef,
  keepalive,
  scrollOffsets,
  createKeepaliveEditor,
  onActiveEditorChange,
  setFindReplaceMode,
  setFindReplaceOpen,
  setSourceBuffer,
  setIsParsing,
  sourceModeTabs,
  getSourceBuffer,
}: UseTabSwitchingParams) {
  const activeTabId = useEditorStore((s) => s.activeTabId);

  // Track previously active tab to save its content on switch
  const prevTabRef = useRef<null | string>(null);
  // §perf-large-file B2/C2: Loading state for async parse + progressive loading
  const progressiveLoadRef = useRef<{ cancelled: boolean }>({
    cancelled: false,
  });

  // Cancel any in-flight progressive append and clear the loading flag for its tab.
  const cancelInflightAppend = () => {
    if (appendHandleRef.current) {
      appendHandleRef.current.handle.cancel();
      setTabLoading(appendHandleRef.current.tabId, false);
      appendHandleRef.current = null;
    }
  };

  // --- Tab switching: swap editor content when activeTabId changes ---
  //
  // ‼️ Every branch below that installs content must call `ctx.installContent` (§260
  // Phase 4b, see tab-switching/types.ts): the plugin editor surface refuses reads and
  // writes while the last-loaded tab is not the active one, which is what keeps a
  // sandboxed plugin from reading the OUTGOING tab's document during the deferred
  // install. The early return here is safe only because a null editor means nothing
  // was installed either — the two facts are aligned today, not by construction, so a
  // new early return needs one or the other to hold.
  useEffect(() => {
    if (!editor) return;

    const ctx: TabSwitchContext = {
      appendHandleRef,
      createKeepaliveEditor,
      editor,
      editorStateCache,
      getSourceBuffer,
      installContent,
      keepalive,
      onActiveEditorChange,
      progressiveLoadRef,
      scrollOffsets,
      setFindReplaceMode,
      setFindReplaceOpen,
      setIsParsing,
      setSourceBuffer,
      sourceModeTabs,
    };

    const { tabs } = useEditorStore.getState();
    const { openFiles } = useFileStore.getState();

    const prevTabId = prevTabRef.current;
    prevTabRef.current = activeTabId;

    // §37 Push to navigation history (unless navigating via back/forward)
    if (prevTabId && prevTabId !== activeTabId) {
      if (!isNavBackForwardRef.current) {
        useNavigationStore.getState().pushHistory(prevTabId);
      }
      isNavBackForwardRef.current = false;
    }

    // §39 Touch MRU for the newly active tab
    if (activeTabId) {
      useEditorStore.getState().touchMru(activeTabId);
    }

    if (prevTabId && prevTabId !== activeTabId) {
      saveOutgoingTab(ctx, prevTabId);
      // §287 소스 모드는 이제 탭을 따라 남는다 — 여기서 끄지 않는다.
      //
      // 예전에는 전환할 때마다 전역 boolean을 껐다. 편집 영역이 표면을 하나만 마운트하던
      // 시절에는 그럴 수밖에 없었다(돌아와도 CodeMirror가 재생성돼 커서가 사라졌으니
      // WYSIWYG로 되돌리는 편이 덜 나빴다). §286 유지 집합이 들어오면서 그 전제가 사라졌다:
      // 소스 표면은 마운트된 채 숨고, 돌아오면 커서와 스크롤이 그대로다.
      //
      // ‼️ 사용자에게 보이는 동작 변경이다. 끄는 코드를 지운 자리에 이 주석을 남기는 이유는,
      // 다음 사람이 "탭을 바꿔도 소스 모드가 안 꺼진다"를 결함으로 오해하지 않게 하기 위해서다.
    }

    // The outgoing-save block above has already read isTabLoading(prevTabId).
    // Now it is safe to cancel the in-flight appender and clear its flag/ref.
    cancelInflightAppend();

    // Load incoming tab content
    const incomingTab = tabs.find((t) => t.id === activeTabId);
    if (!incomingTab) {
      // No active tab — clear editor
      const emptyDoc = markdownToProsemirror("", editor.schema);
      const newState = EditorState.create({
        doc: emptyDoc,
        plugins: editor.state.plugins,
      });
      // Defer updateState outside React commit phase
      setTimeout(() => {
        replaceEditorStateWithVim(editor.view, newState, "fresh-document");
      });
      onActiveEditorChange(null);
      return;
    }

    // Graph / plugin tab — no ProseMirror content to load
    // [CRITICAL-1 fix] Reset activeEditor so hooks bind to shared editor
    // ‼️ Asked as "is this a file?": everything below this line reads `filePath`, so an
    // enumerated check let a new tab type fall through into the keep-alive lookup and the
    // content load with an empty path.
    if (!isFileTab(incomingTab)) {
      onActiveEditorChange(null);
      return;
    }

    // Every branch below has a confirmed file tab whose id equals activeTabId — use
    // `incomingTab.id` (properly typed as `string`) instead of a non-null assertion on
    // the store's `null | string` activeTabId. §298 split-review §2: extracted branch
    // functions take this id as an explicit parameter, never a closure.
    const tabId = incomingTab.id;

    // §perf-large-file C3.5: if this tab has a COMPLETE keep-alive editor,
    // show it and skip load. activeFor returns null for incomplete entries.
    const incomingKeepaliveEditor = keepalive.activeFor(tabId);
    if (incomingKeepaliveEditor) {
      resumeKeepaliveTab(ctx, tabId, incomingKeepaliveEditor, incomingTab);
      return;
    }

    // [NEW-CRITICAL-B] If the pool holds an INCOMPLETE entry for this tab
    // (mid-load switch-away left a partial doc), destroy it and fall through
    // to the normal uncached load path — simplest correct behavior.
    if (keepalive.has(tabId)) {
      keepalive.release(tabId);
    }

    const content = incomingTab.filePath
      ? openFiles.get(incomingTab.filePath)
      : openFiles.get(incomingTab.id);

    if (content !== undefined) {
      // Non-markdown file — load into source editor, skip ProseMirror entirely
      if (!isMarkdownFile(incomingTab.filePath)) {
        // [CRITICAL-1 fix] Reset to shared editor
        onActiveEditorChange(null);
        setSourceBuffer(incomingTab.id, content);
        if (incomingTab.filePath) notifyFileOpen(incomingTab.filePath);
        return;
      }

      // [CRITICAL-1 fix] All non-keepalive branches use the shared editor.
      // Set immediately so hooks/overlays rebind before content loads.
      onActiveEditorChange(null);

      // Try cached EditorState first (preserves undo/redo history)
      //
      // §313 ‼️ 단, 그 캐시가 아직 사실일 때만이다. 이 탭이 배경에 있는 동안 파일이
      // 바뀌었으면(앱이 썼든 남이 썼든) 캐시된 문서는 그 변경 **이전**이고, 복원하면
      // 화면이 조용히 과거로 돌아간 뒤 다음 저장이 그 과거를 파일에 되쓴다. mtime 회계는
      // 이것을 잡지 못한다 — 자동 리로드가 `lastSaveMtime`을 `canReloadMtime`과 같은
      // 값으로 올려 두기 때문이다. 버리고 아래의 로드 경로로 흘려보내면 방금 갱신된
      // `openFiles`를 다시 읽는다.
      if (useEditorStore.getState().staleContentTabs.includes(tabId)) {
        editorStateCache.current.delete(tabId);
        useEditorStore.getState().clearContentStale(tabId);
      }
      const cachedState = editorStateCache.current.get(tabId);
      if (cachedState) {
        restoreCachedState(ctx, tabId, incomingTab, content, cachedState);
      } else {
        loadTabContent(ctx, tabId, incomingTab, content);
      }

      // Clean up cache for closed tabs — only reached on this markdown load
      // path, see gc-closed-tabs.ts placement contract.
      gcClosedTabs(ctx);
    }
    // Intentionally only re-run on activeTabId change; other values (editor,
    // tabs, openFiles, etc.) are read from store state or refs to avoid
    // re-registering the effect on every keystroke.
    return () => {
      // React runs this cleanup BEFORE the next effect body executes.
      // The next effect's outgoing-save block reads isTabLoading(prevTabId) at
      // the top of saveOutgoingTab to decide whether to skip caching a partial doc — so
      // we must NOT clear the loading flag here. Only stop the appender from ticking.
      // cancelInflightAppend() is called unconditionally after the outgoing-save
      // block above where the flag is no longer needed.
      appendHandleRef.current?.handle.cancel();
      // `progressiveLoadRef` is a cancellation token, not a DOM node ref: reading
      // `.current` live here is deliberate (§perf-large-file B2/C2). The reassignment
      // this rule can't see through the `loadTabContent()` call boundary happens
      // synchronously within the SAME effect run, before this cleanup can ever fire for
      // it — the split moved the assignment out of this file's visible AST, not the
      // timing.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      progressiveLoadRef.current.cancelled = true;
    };
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps
}

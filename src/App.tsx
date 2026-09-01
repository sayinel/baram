// §4.2 Baram App — 3-Column layout with editor
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { PdfFindApi } from "./components/editor/pdf/use-pdf-find";
import type { EditorTab } from "./stores/editor/editor";

import { Editor as TiptapCoreEditor } from "@tiptap/core";
import { useEditor } from "@tiptap/react";
import { useShallow } from "zustand/shallow";

import { PromptLintPanel } from "./components/ai/PromptLintPanel";
import { MarkdownSurface } from "./components/editor/MarkdownSurface";
import { PdfFindBar } from "./components/editor/pdf/PdfFindBar";
import { PluginViewerHost } from "./components/editor/PluginViewerHost";
import { createTabSurfaceRenderers } from "./components/editor/tab-surface-renderers";
import { TabSurface } from "./components/editor/TabSurface";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppDialogs } from "./components/layout/AppDialogs";
import { AppLayout } from "./components/layout/AppLayout";
import {
  type EditorMode,
  editorModeForSurfaceKind,
  StatusBar,
  vimSurfaceForMode,
} from "./components/layout/StatusBar";
import { TabBar } from "./components/layout/TabBar";
import { TabSwitcher } from "./components/layout/TabSwitcher";
import { GraphViewLazy } from "./components/sidebar/GraphViewLazy";
import { EditorProvider } from "./contexts/editor-context";
import { createBaramExtensions } from "./extensions";
import { setWysiwygVimStatusOwner } from "./extensions/plugins/vim/vim-status";
import { useAppStartup } from "./hooks/use-app-startup";
import { useAutoSave } from "./hooks/use-auto-save";
import { useAutoSnapshot } from "./hooks/use-auto-snapshot";
import { useCloseGuard } from "./hooks/use-close-guard";
import { useCodeAutoSave } from "./hooks/use-code-auto-save";
import { useEditorEffects } from "./hooks/use-editor-effects";
import { useExternalDrop } from "./hooks/use-external-drop";
import { useFileOperations } from "./hooks/use-file-operations";
import { useFileWatcher } from "./hooks/use-file-watcher";
import { useGhostText } from "./hooks/use-ghost-text";
import { useGlobalCaptureShortcut } from "./hooks/use-global-capture-shortcut";
import { useGlobalKeyboard } from "./hooks/use-global-keyboard";
import { useInlineAI } from "./hooks/use-inline-ai";
import { useJournal } from "./hooks/use-journal";
import { useJournalInitialCursor } from "./hooks/use-journal-initial-cursor";
import { useKeybindingActions } from "./hooks/use-keybinding-actions";
import { useLargeDocKeepalive } from "./hooks/use-large-doc-keepalive";
import { useMenuEventHandler } from "./hooks/use-menu-event-handler";
import { useNavigation } from "./hooks/use-navigation";
import { useRetainedTabs } from "./hooks/use-retained-tabs";
import { useSettingsEffects } from "./hooks/use-settings-effects";
import { useSkillsMode } from "./hooks/use-skills-mode";
import { type AppendHandleRef, useSourceMode } from "./hooks/use-source-mode";
import { useTabSwitching } from "./hooks/use-tab-switching";
import { useTaskWatcher } from "./hooks/use-task-watcher";
import { useZoom } from "./hooks/use-zoom";
import { useTranslation } from "./i18n/useTranslation";
import { writeFile } from "./ipc/invoke";
import {
  initializePlugins,
  notifyEditorReady,
  shutdownPlugins,
} from "./plugins/plugin-lifecycle";
import { pluginLoader } from "./plugins/plugin-loader";
import { matchFileViewer, usePluginUIStore } from "./plugins/plugin-ui-store";
import {
  startUpdateChecker,
  stopUpdateChecker,
} from "./plugins/update-checker";
import {
  startAppUpdateChecker,
  stopAppUpdateChecker,
} from "./services/app-update";
import { isImeProbeEnabled } from "./spike/ime-probe/ime-probe-enabled";
import { isVimWysiwygProbeEnabled } from "./spike/vim-wysiwyg-probe/vim-probe-enabled";
import { useEditorStore } from "./stores/editor/editor";
import { isFileTab } from "./stores/editor/editor";
import { useSnapshotStore } from "./stores/editor/snapshot";
import { useFileStore } from "./stores/file/file";
import { useUIStore } from "./stores/ui/ui";
import { editorSurfaceBlockReason } from "./utils/editor/active-tab";
import { initPerfTrace, instrumentEditor } from "./utils/editor/perf-trace";
import {
  resolveSurfaceKind,
  type SurfaceKind,
} from "./utils/editor/surface-kind";
import {
  getLanguageForFile,
  isBinaryViewerFile,
  isHtmlFile,
  isImageFile,
  isMarkdownFile,
  isPdfFile,
} from "./utils/file-type";
import { logger } from "./utils/logger";
import { logAppReady } from "./utils/perf";
// Stylesheet moved to `main.tsx` (§260 Phase 5 re-review, R3): App is dynamically
// imported, so a stylesheet imported here is bound to that chunk and never reaches
// index.html's <head> — a blank window on cold start.

// §8.4 Lazy-loaded components — split into separate chunks, loaded on first use
const HomeScreen = lazy(() =>
  import("./components/onboarding/HomeScreen").then((m) => ({
    default: m.HomeScreen,
  })),
);
// §298 measurement spikes. Lazy so they stay out of the main bundle; neither
// chunk is requested unless its VITE_*_PROBE flag is set in a dev build.
const VimWysiwygProbe = lazy(() =>
  import("./spike/vim-wysiwyg-probe/VimWysiwygProbe").then((m) => ({
    default: m.VimWysiwygProbe,
  })),
);
const ImeProbe = lazy(() =>
  import("./spike/ime-probe/ImeProbe").then((m) => ({ default: m.ImeProbe })),
);
const SkillPreviewPanel = lazy(() =>
  import("./components/ai/SkillPreviewPanel").then((m) => ({
    default: m.SkillPreviewPanel,
  })),
);

// §89 Lazy-loaded file editor for standalone file mode
const FileEditorLayout = lazy(() =>
  import("./components/layout/FileEditorLayout").then((m) => ({
    default: m.FileEditorLayout,
  })),
);

// A tab that toggles between rendered preview and raw source: HTML (built-in
// iframe preview) or any TEXT file a viewer plugin claims (e.g. SVG via the
// built-in media-viewer). Binary files never toggle — they have no source
// view. Reads the plugin registry non-reactively: callers are user-action
// callbacks, and the render path derives the same answer reactively.
function isPreviewToggleFile(filePath: string | undefined): boolean {
  if (!filePath || isMarkdownFile(filePath) || isBinaryViewerFile(filePath)) {
    return false;
  }
  if (isHtmlFile(filePath)) return true;
  return !!matchFileViewer(usePluginUIStore.getState().fileViewers, filePath);
}

// §89 File mode detection — resolved once at module load (URL params don't change)
const _fileModeParams = new URLSearchParams(window.location.search);
const FILE_MODE_PATH =
  _fileModeParams.get("mode") === "file" ? _fileModeParams.get("path") : null;

function App() {
  const { t } = useTranslation();
  const {
    toggleSidebar,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    setSidebarPanel,
  } = useUIStore(
    useShallow((s) => ({
      toggleSidebar: s.toggleSidebar,
      toggleCommandPalette: s.toggleCommandPalette,
      toggleQuickSwitcher: s.toggleQuickSwitcher,
      toggleSettings: s.toggleSettings,
      setSidebarPanel: s.setSidebarPanel,
    })),
  );
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeTabFilePath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab && isFileTab(tab) ? tab.filePath : null;
  });
  // The whole tab, not a boolean: `editorSurfaceBlockReason` asks `isFileTab` itself, which is
  // what makes "a tab kind that does not exist yet is blocked" a property of the tested
  // function rather than of this untested component.
  const activeTab = useEditorStore(
    useShallow((s) => s.tabs.find((t) => t.id === s.activeTabId)),
  );
  const markDirty = useEditorStore((s) => s.markDirty);
  const rootPath = useFileStore((s) => s.rootPath);

  // Derived: non-markdown code file detection for rendering branch
  const isCodeFile = !!activeTabFilePath && !isMarkdownFile(activeTabFilePath);
  // ‼️ "Not markdown" is NOT the same question as "may the text editor write this".
  // `isCodeFile` answers the first — a PDF passes it, because a PDF is not markdown —
  // and the non-markdown auto-save effect below used it as if it answered the second,
  // so a PDF that went dirty was a PDF about to be overwritten with
  // `sourceContentRef.current`. `autoSave` defaults to true, so that path was live.
  //
  // Named rather than inlined at the one call site on purpose: the next effect that
  // writes files must be able to ask this question by name instead of rediscovering it.
  // Guarding call sites one by one is what leaves the following one exposed.
  const isEditableTextFile =
    isCodeFile && !isBinaryViewerFile(activeTabFilePath);

  // PDF file viewer — read-only, built-in (PDF.js)
  const isPdfTab = !!activeTabFilePath && isPdfFile(activeTabFilePath);
  // Raster images — binary, rendered by a "viewer" plugin (built-in
  // media-viewer). The binary guards hold with or without a plugin.
  const isImageTab = !!activeTabFilePath && isImageFile(activeTabFilePath);

  // Plugin-registered file viewer matching the active tab (§69 "viewer")
  const fileViewers = usePluginUIStore((s) => s.fileViewers);
  const pluginViewer = matchFileViewer(
    fileViewers,
    activeTabFilePath ?? undefined,
  );
  // Text files a plugin claims (e.g. SVG) get the same preview ↔ source
  // toggle as HTML; binary files (images) are preview-only.
  const isPluginPreviewTab =
    !!pluginViewer && isCodeFile && !isPdfTab && !isImageTab;

  // HTML file viewer — rendered preview (default) vs raw source, tracked
  // per tab so toggling one tab doesn't affect others.
  const isHtmlTab = !!activeTabFilePath && isHtmlFile(activeTabFilePath);
  const [htmlSourceTabs, setHtmlSourceTabs] = useState<Set<string>>(
    () => new Set(),
  );
  const isHtmlSourceView = !!activeTabId && htmlSourceTabs.has(activeTabId);

  // Viewers reload whenever the file's saved/reloaded mtime bumps
  // (manual save, auto-save, toggle-flush, or external auto-reload)
  const previewFileMtime = useFileStore((s) =>
    (isHtmlTab || isPdfTab || isImageTab || isPluginPreviewTab) &&
    activeTabFilePath
      ? (s.fileMtimes.get(activeTabFilePath)?.lastSaveMtime ?? 0)
      : 0,
  );

  // §5.6 Find/Replace state
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findReplaceMode, setFindReplaceMode] = useState<"find" | "replace">(
    "find",
  );
  // §272 PDF 찾기 상태 — PdfPreview가 소유한 usePdfFind의 live API를 여기로
  // 끌어올려 PdfFindBar를 PdfPreview 바깥(FindReplaceBar와 같은 자리)에서
  // 그린다.
  const [pdfFindOpen, setPdfFindOpen] = useState(false);
  const [pdfFindApi, setPdfFindApi] = useState<null | PdfFindApi>(null);
  // Cmd+F/네이티브 메뉴가 부르는 setFindReplaceOpen을 여기 한 곳에서만
  // PDF 탭이면 PDF 찾기로, 아니면 원래 마크다운 찾기로 분기한다 — 키바인딩,
  // 네이티브 메뉴, 탭 전환 복원까지 4개 호출부가 각자 분기하면 어긋나기
  // 쉽다(§272 Task 5 corrections). value는 boolean이거나 함수형 업데이터일
  // 수 있다(네이티브 메뉴 edit_find_replace가 함수형을 쓴다) — 두 setState
  // setter 모두 SetStateAction을 그대로 받으므로 그대로 위임한다.
  const routeFindReplaceOpen = useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (value) => {
      if (isPdfTab) {
        setPdfFindOpen(value);
        return;
      }
      setFindReplaceOpen(value);
    },
    // §286 setState 세터는 항상 안정 참조라 재생성 빈도에 영향을 주지 않지만, React
    // Compiler가 이 함수 아래쪽에 `surfaceKind`(§286 표면 판정, `isHtmlSourceView`를
    // 읽는다)가 생기면서 추론한 의존성이 `isPdfTab` 단독과 달라져 수동 메모이제이션을
    // 보존하지 못한다고 보고했다 — 추론한 세터를 그대로 적어 둘 일치시킨다.
    [isPdfTab, setFindReplaceOpen, setPdfFindOpen],
  );
  // §276.1 PdfToolbar의 찾기 토글 — 같은 pdfFindOpen을 뒤집는다. 인라인
  // 화살표를 그대로 prop으로 넘기면 PdfPreview(memo)가 매 렌더 다시 그려진다.
  const handleTogglePdfFind = useCallback(() => {
    setPdfFindOpen((v) => !v);
  }, [setPdfFindOpen]);
  // §perf-large-file B2/C2: Loading state for async parse
  const [isParsing, setIsParsing] = useState(false);

  // §39 Tab switcher state
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false);
  const [tabSwitcherIndex, setTabSwitcherIndex] = useState(0);

  // §72 Skill Preview Panel state
  const [skillPreviewOpen, setSkillPreviewOpen] = useState(false);
  // Stable identity: this is a CommandPalette `commands` useMemo dep, so an
  // inline arrow here would rebuild the palette's 476-line buildCommands()
  // on every App re-render, even while the palette is closed.
  const handleSkillPreviewToggle = useCallback(() => {
    setSkillPreviewOpen((v) => !v);
  }, [setSkillPreviewOpen]);
  const tabSwitcherMruRef = useRef<EditorTab[]>([]);

  // §298 vim §12-⑪: extensions MUST be referentially stable across renders.
  // useEditor re-compares options every render (element-wise on extensions);
  // a mismatch triggers setOptions({ ..., editable: editor.isEditable }),
  // which would copy a vim-modal view.editable=false into options.editable
  // permanently (no event fires — the editor bricks to read-only).
  // The navigate refs are declared below (useNavigation) — safe: the arrows
  // only dereference .current when invoked, same as createKeepaliveEditor.
  const extensions = useMemo(
    () =>
      createBaramExtensions({
        onNavigate: (target, heading, vaultAlias) =>
          navigateRef.current(target, heading, vaultAlias),
        onNavigateBlockRef: (target, blockId) =>
          blockRefNavigateRef.current(target, blockId),
        onNavigateLocal: (href) => localLinkNavigateRef.current(href),
        onMentionNavigate: (type, value) =>
          mentionNavigateRef.current(type, value),
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const editor = useEditor({
    extensions,
    autofocus: true,
    immediatelyRender: false,
    onCreate: () => {
      logAppReady();
      notifyEditorReady();
    },
  });

  // §perf-large-file C3.5: keep-alive editor pool for large documents
  // mountedKeepaliveEditor: the editor whose EditorContent is mounted (stays
  // mounted as long as it's in the pool — this is the "keep-alive" part).
  // activeKeepaliveEditor: non-null only when the active tab uses a keep-alive
  // editor (controls visibility and hook binding).
  const [mountedKeepaliveEditor, setMountedKeepaliveEditor] = useState<
    import("@tiptap/react").Editor | null
  >(null);
  const [activeKeepaliveEditor, setActiveKeepaliveEditor] = useState<
    import("@tiptap/react").Editor | null
  >(null);
  // [MODERATE-9] On eviction, unmount EditorContent BEFORE editor.destroy().
  const handleEviction = useCallback(() => {
    setMountedKeepaliveEditor(null);
    setActiveKeepaliveEditor(null);
  }, []);
  const keepalive = useLargeDocKeepalive(handleEviction);
  const activeEditor = activeKeepaliveEditor ?? editor;
  // Stable callback for useTabSwitching to notify us of editor changes.
  // null = use shared editor; non-null = use this keep-alive editor.
  const handleActiveEditorChange = useCallback(
    (e: import("@tiptap/react").Editor | null) => {
      setActiveKeepaliveEditor(e);
      // Keep the EditorContent mounted as long as the editor exists
      if (e) setMountedKeepaliveEditor(e);
      // When switching away (e=null), do NOT unmount — the pool keeps it alive.
      // mountedKeepaliveEditor stays set so the DOM is preserved (hidden).
      // Keep plugin editor API pointed at the ACTIVE editor (keep-alive or shared)
      // synchronously — the tab-switch effect emits file:open in the same tick.
      pluginLoader.setEditor(e ?? editor);
    },
    [editor],
  );

  // [MINOR-11] Destroy pooled editors on App unmount / HMR cleanup.
  // [NEW-CRITICAL-A fix] Empty deps — true unmount-only. Pool identity is
  // now stable (ref-based) but we still read from a ref for belt-and-suspenders.
  const keepaliveRef = useRef(keepalive);
  keepaliveRef.current = keepalive;
  useEffect(() => {
    return () => keepaliveRef.current.destroyAll();
  }, []);

  // §perf-large-file C3.0: Install dev-only performance instrumentation
  useEffect(() => {
    if (import.meta.env.DEV) initPerfTrace();
  }, []);

  // §69 Plugin system — initialize plugins and update checker on mount
  useEffect(() => {
    // §260 3c-3 — the plugin runtime belongs to ONE host realm. A §89 file-mode
    // window is a second one: this effect runs before the `FILE_MODE_PATH` branch in
    // the render below, so a file window used to load plugins too. Nothing about the
    // design supports that — the Rust authorizer is keyed on `plugin-<id>` with no
    // realm dimension, so both realms fight over the same label, the same grant and
    // (since this phase) the same startup sweep, which would close and revoke the
    // MAIN window's live sandboxes the moment the user opens a file in a new window.
    if (!FILE_MODE_PATH) {
      initializePlugins().catch((err) =>
        logger.error("[App] Plugin initialization failed:", err),
      );
    }
    startUpdateChecker();
    startAppUpdateChecker();
    return () => {
      stopUpdateChecker();
      stopAppUpdateChecker();
      if (!FILE_MODE_PATH) shutdownPlugins().catch((e) => logger.error(e));
    };
  }, []);

  // §69 Plugin system — provide editor instance to plugin loader
  useEffect(() => {
    if (editor) pluginLoader.setEditor(editor);
  }, [editor]);

  // §perf-large-file C3.1/C4: Install per-plugin transaction cost instrumentation
  // on the ACTIVE editor — the keep-alive editor that renders large docs is a
  // separate instance, so instrumenting only the shared `editor` left its
  // txBreakdown reading 0. instrumentEditor is idempotent per instance (WeakSet),
  // so re-binding on activeEditor change instruments each editor exactly once.
  useEffect(() => {
    if (activeEditor) instrumentEditor(activeEditor);
    // §perf-large-file C4: expose the ACTIVE editor on window in DEV so perf
    // experiments can be driven from the DevTools console (e.g. fold-all to
    // simulate windowing, read doc size, dispatch commands).
    if (import.meta.env.DEV) {
      (globalThis as { __baramEditor?: unknown }).__baramEditor = activeEditor;
    }
  }, [activeEditor]);

  // §72 Skills mode — auto-detect skill files and switch right panel
  const { isSkill } = useSkillsMode();

  // Auto-save hook (markdown files — Tiptap editor.on("update") based)
  // §perf-large-file C3.5: use activeEditor so keep-alive tabs auto-save correctly
  useAutoSave(activeEditor);

  // §56 Place the caret on a body line below the date title when a freshly
  // created journal template loads (instead of at the end of the title).
  useJournalInitialCursor(activeEditor);

  // File system watcher — auto-refresh FileTree on external changes
  useFileWatcher();

  // §304 태스크 캐시 증분 갱신 — file:* 이벤트로 변경된 파일만 재스캔
  useTaskWatcher();

  // §313 전역 캡처 단축키 — 설정된 조합 하나를 OS에 등록해 둔다. 앱에서 **한 번만**
  // 마운트한다(두 번이면 같은 조합을 두 번 등록하려다 실패 상태가 남는다).
  useGlobalCaptureShortcut();

  // §71 Periodic auto-snapshot — fires performAutoSnapshot on the configured interval
  useAutoSnapshot();

  // Page zoom — trackpad pinch + Cmd+/Cmd-/Cmd+0
  // §perf-large-file C3.5: zoom against activeEditor's DOM
  useZoom(activeEditor);

  // External file drag & drop — Tauri OS-level file drop (Feature 1 & 2)
  useExternalDrop({ editor: activeEditor });

  // §43 Ghost Text — inline AI completion
  useGhostText(activeEditor);

  // §6.2 Inline AI — Cmd+J editing
  const inlineAI = useInlineAI(activeEditor);

  // Apply settings to DOM (theme, font, spellcheck, locale)
  useSettingsEffects(activeEditor);

  // §close-guard: intercept app close (red X) / quit (Cmd+Q) when tabs are dirty
  useCloseGuard();

  // [NEW-MODERATE-C] Shared ref for progressive append handles — owned here,
  // passed to both useSourceMode and useTabSwitching so cancelInflightAppend
  // covers source-mode fills and tab-switch cancellation covers both.
  const appendHandleRef: AppendHandleRef = useRef(null);

  // §291 탭별 스크롤 오프셋. MarkdownSurface가 scroll 이벤트로 **기록**하고,
  // useTabSwitching이 콘텐츠 설치 뒤에 **복원**한다 — 두 시점이 달라 맵을 공유한다.
  const scrollOffsets = useRef(new Map<string, number>());

  // --- Source mode (WYSIWYG ↔ raw markdown toggle) ---
  // Must be called before useFileOperations and useTabSwitching because it owns
  // editorStateCache and exposes isSourceMode / sourceContentRef they need.
  // [MAJOR-3 fix] Pass activeEditor so source-mode toggle reads/writes the
  // correct document for keep-alive tabs.
  const {
    bufferVersion,
    editorStateCache,
    getSourceBuffer,
    hasSourceBuffer,
    isSourceMode,
    setSourceBuffer,
    sourceCursorOffsetFor,
    sourceEditorRef,
    sourceModeTabs,
    toggleSourceMode,
  } = useSourceMode({ editor: activeEditor, appendHandleRef, pool: keepalive });

  // §286/§298 vim §8 — ONE surface computation (`resolveSurfaceKind`, `utils/editor/
  // surface-kind.ts`) now feeds the StatusBar, the wysiwyg status owner below, the
  // `isMarkdownSurfaceActive` gate, and the render chain further down — a single answer to
  // "what is the active tab showing" instead of four hand-written chains that had to agree.
  const surfaceKind: SurfaceKind = resolveSurfaceKind({
    activeTabId,
    fileViewers,
    isHtmlSourceView,
    isSourceMode,
    rootPath,
    tab: activeTab,
  });
  // Only the wysiwyg surface appoints an owner: the source surface (markdown source mode
  // AND non-markdown code tabs) has its own feeder, and graph/preview/plugin own no vim
  // surface — a hidden Tiptap view update must never overwrite them (S5-a review).
  const statusBarMode: EditorMode = editorModeForSurfaceKind(surfaceKind);
  useEffect(() => {
    setWysiwygVimStatusOwner(
      vimSurfaceForMode(statusBarMode) === "wysiwyg" ? activeEditor : null,
    );
  }, [activeEditor, statusBarMode]);

  // §285 유지 집합 — 마운트를 유지할 탭과 그 표면 종류.
  //
  // `pluginPreviewTabs`를 여기서 만드는 이유: 뷰어 레지스트리를 아는 것은 App뿐이다.
  // SVG처럼 **텍스트인데 플러그인이 그리는** 파일은 판정 함수만 보면 `code`로 떨어지는데,
  // 프리뷰 상태에서는 유지 대상이 아니다(§290에서 플러그인 뷰어를 제외했다).
  const tabs = useEditorStore((s) => s.tabs);
  const pluginPreviewTabs = useMemo(() => {
    const set = new Set<string>();
    for (const t of tabs) {
      if (isFileTab(t) && matchFileViewer(fileViewers, t.filePath)) {
        set.add(t.id);
      }
    }
    return set;
  }, [tabs, fileViewers]);
  const tabSurfaceRenderers = useMemo(
    () =>
      createTabSurfaceRenderers({
        codeLanguageFor: (filePath) =>
          getLanguageForFile(filePath) ?? undefined,
        getSourceBuffer,
        hasSourceBuffer,
        markDirty,
        onPdfFindApiChange: setPdfFindApi,
        onTogglePdfFind: handleTogglePdfFind,
        pdfFindOpen,
        scrollOffsets,
        pluginIdFor: (tabId) =>
          useEditorStore.getState().tabs.find((t) => t.id === tabId)
            ?.pluginId ?? "",
        setSourceBuffer,
        sourceCursorOffsetFor,
      }),
    [
      getSourceBuffer,
      hasSourceBuffer,
      handleTogglePdfFind,
      markDirty,
      pdfFindOpen,
      setSourceBuffer,
      sourceCursorOffsetFor,
    ],
  );

  // §286 MRU는 스토어가 관리한다(touchMru). 유지 집합은 그 순서의 순수 함수여야 한다 —
  // 렌더 도중 직전 결과를 기억하던 구현이 표면을 반복 재마운트했다(use-retained-tabs.ts).
  const mruOrder = useEditorStore((s) => s.mruOrder);
  const retainedTabs = useRetainedTabs(
    mruOrder,
    tabs,
    sourceModeTabs,
    htmlSourceTabs,
    pluginPreviewTabs,
  );

  // §286 마크다운 표면이 지금 보여야 하는가.
  //
  // 예전엔 아래 render 삼항 사슬의 마지막 else 조건을 손으로 그대로 부정한 별도 식이었다 —
  // "새 갈래를 추가하면 여기도 고쳐야 한다"는 사람이 지켜야 하는 계약이었던 것을,
  // `surfaceKind`가 단일 판정으로 대체했다(우선순위·이력은 `resolveSurfaceKind` docblock 참조).
  const isMarkdownSurfaceActive = surfaceKind === "markdown";

  // §260 Phase 4b — the policy and its rationale now live in `editorSurfaceBlockReason`, with
  // tests. It moved out because nothing imports `App`, so this gate was unverified.
  useEffect(() => {
    pluginLoader.setEditorSurfaceBlocked(
      editorSurfaceBlockReason({
        activeTab,
        isCodeFile,
        isPdfTab,
        isSourceMode,
      }),
    );
  }, [activeTab, isCodeFile, isPdfTab, isSourceMode]);

  // Auto-save for non-MD code files (debounced write when dirty)
  useCodeAutoSave({
    bufferVersion,
    getSourceBuffer,
    isEditableTextFile,
    markDirty,
  });

  // --- File operations ---
  // [CRITICAL-2 fix] Pass activeEditor so Cmd+S serializes the correct
  // document for keep-alive tabs (not the shared editor's stale content).
  const {
    handleCloseFolder,
    handleCloseTab,
    handleNewFile,
    handleOpenFile,
    handleOpenFilePath,
    handleOpenFolder,
    handleOpenRecentFile,
    handleOpenRecentFolder,
    handleSave,
    handleSaveAs,
  } = useFileOperations({
    editor: activeEditor,
    getSourceBuffer,
    sourceModeTabs,
  });

  // --- Navigation ---
  const {
    blockRefNavigateRef,
    handleGoBack,
    handleGoForward,
    isNavBackForwardRef,
    localLinkNavigateRef,
    mentionNavigateRef,
    navigateRef,
  } = useNavigation({
    editor,
    handleOpenFilePath,
  });

  // §perf-large-file C3.5: factory to create a keep-alive editor with the same extensions.
  // Placed after useNavigation so navigateRef et al. are already declared.
  // TiptapCoreEditor === @tiptap/react Editor (same class, re-exported via @tiptap/core).
  const createKeepaliveEditor = useCallback(() => {
    return new TiptapCoreEditor({
      extensions: createBaramExtensions({
        // §perf-large-file C4: this is the large-doc editor — enable windowing.
        isLargeKeepaliveEditor: true,
        onNavigate: (target, heading, vaultAlias) =>
          navigateRef.current(target, heading, vaultAlias),
        onNavigateBlockRef: (target, blockId) =>
          blockRefNavigateRef.current(target, blockId),
        onNavigateLocal: (href) => localLinkNavigateRef.current(href),
        onMentionNavigate: (type, value) =>
          mentionNavigateRef.current(type, value),
      }),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Tab switching ---
  useTabSwitching({
    appendHandleRef,
    editor,
    editorStateCache,
    isNavBackForwardRef,
    keepalive,
    scrollOffsets,
    createKeepaliveEditor,
    onActiveEditorChange: handleActiveEditorChange,
    setFindReplaceMode,
    setFindReplaceOpen: routeFindReplaceOpen,
    setIsParsing,
    setSourceBuffer,
    sourceModeTabs,
    getSourceBuffer,
  });

  // --- Editor effects (selection, content reload, goto-position, title) ---
  // §perf-large-file C3.5: use activeEditor so keep-alive tabs handle goto-position correctly
  useEditorEffects({
    editor: activeEditor,
    editorStateCache,
    inlineAI,
    setFindReplaceMode,
    setFindReplaceOpen: routeFindReplaceOpen,
  });

  // Toggle rendered preview ↔ raw source for the active HTML / plugin-viewed
  // text tab. The preview loads the file from disk (asset: protocol), so when
  // leaving source view with unsaved edits, flush them first — the mtime bump
  // then reloads the preview with the fresh content.
  const toggleHtmlView = useCallback(() => {
    const { activeTabId: tabId, tabs: currentTabs } = useEditorStore.getState();
    const tab = currentTabs.find((t) => t.id === tabId);
    if (!tab || !isFileTab(tab) || !isPreviewToggleFile(tab.filePath)) return;
    const leavingSourceView = htmlSourceTabs.has(tab.id);
    if (leavingSourceView && tab.isDirty && tab.filePath) {
      const filePath = tab.filePath;
      const content = getSourceBuffer(tab.id);
      void writeFile(filePath, content)
        .then(() => {
          useFileStore.getState().updateLastSaveMtime(filePath, Date.now());
          useFileStore.getState().setFileContent(filePath, content);
          markDirty(tab.id, false);
          useSnapshotStore.getState().markPendingAutoSnapshot();
        })
        .catch(() => {
          // Save failed — keep dirty state; preview shows last saved version
        });
    }
    setHtmlSourceTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tab.id)) next.delete(tab.id);
      else next.add(tab.id);
      return next;
    });
  }, [htmlSourceTabs, markDirty, getSourceBuffer]);

  // §5.1 HTML·플러그인 프리뷰 파일의 프리뷰 ↔ 원본 토글 버튼. 활성 표면 안에 겹쳐 그린다
  // (TabSurface의 `overlay` prop 주석 참조 — `.editor-area-scroll`의 CSS zoom 때문이다).
  const previewToggleButton =
    isHtmlTab || isPluginPreviewTab ? (
      <button
        className="mode-toggle-btn html-view-toggle"
        onClick={toggleHtmlView}
        title={t("htmlPreview.toggleTitle")}
        type="button"
      >
        {isHtmlSourceView
          ? t("htmlPreview.showPreview")
          : t("htmlPreview.showSource")}
      </button>
    ) : null;

  // Cmd+/ — route to the preview/source toggle when an HTML or plugin-viewed
  // text tab is active; otherwise fall through to the markdown source-mode
  // toggle.
  const handleToggleSourceMode = useCallback(() => {
    const { activeTabId: tabId, tabs: currentTabs } = useEditorStore.getState();
    const tab = currentTabs.find((t) => t.id === tabId);
    if (tab && isFileTab(tab) && isPreviewToggleFile(tab.filePath)) {
      toggleHtmlView();
      return;
    }
    toggleSourceMode();
  }, [toggleHtmlView, toggleSourceMode]);

  // §56 Journal — auto-create today's journal on startup
  useJournal(handleOpenFilePath);

  // App startup side effects — migration, onLaunch restore, file open events
  useAppStartup({ handleOpenFilePath, handleNewFile });

  // §39 Ctrl keyup — commit tab switcher selection
  useEffect(() => {
    if (!tabSwitcherOpen) return;

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") {
        const selectedTab = tabSwitcherMruRef.current[tabSwitcherIndex];
        if (selectedTab) {
          useEditorStore.getState().setActiveTab(selectedTab.id);
        }
        setTabSwitcherOpen(false);
      }
    };

    window.addEventListener("keyup", handleKeyUp);
    return () => window.removeEventListener("keyup", handleKeyUp);
  }, [tabSwitcherOpen, tabSwitcherIndex]);

  // --- Keybinding actions registration ---
  useKeybindingActions({
    editor: activeEditor,
    handleCloseFolder,
    handleCloseTab,
    handleNewFile,
    handleOpenFile,
    handleOpenFolder,
    handleSave,
    handleSaveAs,
    inlineAI,
    setFindReplaceMode,
    setFindReplaceOpen: routeFindReplaceOpen,
    setSidebarPanel,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    toggleSidebar,
    toggleSourceMode: handleToggleSourceMode,
  });

  // --- Global keyboard shortcuts ---
  useGlobalKeyboard({
    editor: activeEditor,
    findReplaceOpen,
    handleGoBack,
    handleGoForward,
    isSourceMode,
    setTabSwitcherIndex,
    setTabSwitcherOpen,
    tabSwitcherMruRef,
    tabSwitcherOpen,
  });

  // Native menu event listener (Tauri menu bar → frontend dispatch)
  useMenuEventHandler({
    editor: activeEditor,
    handleCloseFolder,
    handleCloseTab,
    handleGoBack,
    handleGoForward,
    handleNewFile,
    handleOpenFile,
    handleOpenFilePath,
    handleOpenFolder,
    handleSave,
    handleSaveAs,
    setFindReplaceOpen: routeFindReplaceOpen,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    toggleSidebar,
    toggleSourceMode: handleToggleSourceMode,
  });

  return (
    <EditorProvider value={activeEditor}>
      <AppLayout
        statusBar={
          rootPath ? (
            <StatusBar editor={activeEditor} mode={statusBarMode} />
          ) : undefined
        }
      >
        {!!rootPath && <TabBar />}
        <div className="editor-area">
          {surfaceKind === "home" ? (
            <div className="editor-area-scroll" data-editor-scroll>
              <Suspense fallback={null}>
                <HomeScreen
                  onNewFile={handleNewFile}
                  onNewVault={async () => {
                    const { open } = await import("@tauri-apps/plugin-dialog");
                    const selected = await open({ directory: true });
                    if (!selected) return;
                    const path =
                      typeof selected === "string" ? selected : selected[0];
                    if (!path) return;
                    const { initVault } = await import("./ipc/context");
                    const { useContextStore: ctxStore } =
                      await import("./stores/context/context");
                    const alias = path.split("/").pop() ?? "vault";
                    await initVault(path, alias);
                    await ctxStore
                      .getState()
                      .addContext("vault", path, { alias });
                    const { switchContext } =
                      await import("./services/vault-context-loader");
                    const activeId = ctxStore.getState().activeContextId;
                    if (activeId) await switchContext(activeId);
                  }}
                  onOpenFile={handleOpenFile}
                  onOpenFolder={handleOpenFolder}
                  onOpenRecentFile={handleOpenRecentFile}
                  onOpenRecentFolder={handleOpenRecentFolder}
                />
              </Suspense>
            </div>
          ) : surfaceKind === "empty" ? (
            <div className="editor-area-scroll" data-editor-scroll>
              <div className="empty-workspace">
                <p>{t("home.emptyWorkspace")}</p>
              </div>
            </div>
          ) : surfaceKind === "graph" ? (
            // §286 그래프는 유지 대상이 아니다 — cytoscape가 0×0 컨테이너에서 자기 카메라를
            // 흔들어, 세 번의 수정에도 실앱에서 계속 깨졌다(use-retained-tabs.ts 참조).
            <div className="editor-area-scroll" data-editor-scroll>
              <Suspense fallback={null}>
                <GraphViewLazy />
              </Suspense>
            </div>
          ) : surfaceKind === "image" && activeTabFilePath ? (
            <div
              className="editor-area-scroll plugin-viewer-scroll"
              data-editor-scroll
            >
              {pluginViewer ? (
                <PluginViewerHost
                  filePath={activeTabFilePath}
                  refreshKey={previewFileMtime}
                  viewer={pluginViewer}
                />
              ) : (
                <div className="viewer-missing">{t("viewer.noPlugin")}</div>
              )}
            </div>
          ) : surfaceKind === "preview" && pluginViewer ? (
            // §290 플러그인이 그리는 프리뷰는 유지하지 않는다 — 공개 viewer 계약에
            // 가시성 신호가 없어, 마운트를 유지하면 미디어 뷰어가 숨은 탭에서 계속
            // 재생된다(dev/backlog.md 참조). 활성일 때만 렌더한다. (HTML 프리뷰는
            // `surfaceKind === "preview"`에도 속하지만 `pluginViewer`가 없으므로 여기서
            // 걸러지고 유지 풀의 HtmlPreview가 그린다 — retainedKindForTab 참조.)
            <div
              className="editor-area-scroll plugin-viewer-scroll"
              data-editor-scroll
            >
              {previewToggleButton}
              <PluginViewerHost
                filePath={activeTabFilePath!}
                refreshKey={previewFileMtime}
                viewer={pluginViewer}
              />
            </div>
          ) : null}
          {/* §272 활성 PDF의 찾기 바 — 표면 바깥(FindReplaceBar와 같은 자리)에 그린다.
              유지 집합에는 PDF가 여러 개 있을 수 있으므로 여기 하나만 존재해야 한다. */}
          {surfaceKind === "pdf" && pdfFindOpen && pdfFindApi && (
            <PdfFindBar
              currentIdx={pdfFindApi.currentIdx}
              matchCount={pdfFindApi.matchCount}
              onClose={() => setPdfFindOpen(false)}
              onNext={pdfFindApi.onNext}
              onPrev={pdfFindApi.onPrev}
              onQueryChange={pdfFindApi.onQueryChange}
            />
          )}
          {/* §286 유지 집합 — 활성만 보이고 나머지는 마운트된 채 숨는다. */}
          {retainedTabs.map((entry) => (
            <TabSurface
              active={entry.tabId === activeTabId}
              entry={entry}
              key={`${entry.kind}-${entry.tabId}`}
              overlay={previewToggleButton}
              renderers={tabSurfaceRenderers}
              scrollOffsets={scrollOffsets}
              sourceEditorRef={sourceEditorRef}
            />
          ))}
          <MarkdownSurface
            active={isMarkdownSurfaceActive}
            activeEditor={activeEditor}
            activeKeepaliveEditor={activeKeepaliveEditor}
            editor={editor}
            findReplaceMode={findReplaceMode}
            findReplaceOpen={findReplaceOpen}
            inlineAI={inlineAI}
            isParsing={isParsing}
            mountedKeepaliveEditor={mountedKeepaliveEditor}
            onFindReplaceClose={() => setFindReplaceOpen(false)}
            onFindReplaceModeChange={setFindReplaceMode}
            scrollOffsets={scrollOffsets}
            tabId={activeTabId}
          />
        </div>
        <PromptLintPanel editor={activeEditor} />
        {isSkill && (
          <Suspense fallback={null}>
            <SkillPreviewPanel
              onClose={() => setSkillPreviewOpen(false)}
              visible={skillPreviewOpen}
            />
          </Suspense>
        )}
      </AppLayout>
      <AppDialogs
        activeEditor={activeEditor}
        handleCloseFolder={handleCloseFolder}
        handleNewFile={handleNewFile}
        handleOpenFile={handleOpenFile}
        handleOpenFolder={handleOpenFolder}
        handleSave={handleSave}
        handleSkillPreviewToggle={handleSkillPreviewToggle}
        handleToggleSourceMode={handleToggleSourceMode}
        markDirty={markDirty}
      />
      {tabSwitcherOpen && (
        <TabSwitcher
          mruTabs={tabSwitcherMruRef.current}
          selectedIndex={tabSwitcherIndex}
        />
      )}
    </EditorProvider>
  );
}

/** §89 Root component — routes between vault mode and file mode. */
function AppRoot() {
  // §298 IME probe spike — replaces the app UI entirely. Gate is off in every
  // shipped build (see spike/ime-probe/ime-probe-enabled.ts).
  if (isImeProbeEnabled()) {
    return (
      <Suspense fallback={null}>
        <ImeProbe />
      </Suspense>
    );
  }
  // §298 Phase 1 mechanism probe — same never-in-production gate.
  if (isVimWysiwygProbeEnabled()) {
    return (
      <Suspense fallback={null}>
        <VimWysiwygProbe />
      </Suspense>
    );
  }
  if (FILE_MODE_PATH) {
    return (
      <Suspense fallback={null}>
        <FileEditorLayout filePath={FILE_MODE_PATH} />
      </Suspense>
    );
  }
  return <App />;
}

function AppWithErrorBoundary() {
  // No custom fallback — ErrorBoundary's default UI shows the error message
  // and stack, so release-build crashes are diagnosable without devtools.
  return (
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  );
}

export default AppWithErrorBoundary;

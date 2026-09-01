// §4.2 Baram App — 3-Column layout with editor
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";

import { Editor as TiptapCoreEditor } from "@tiptap/core";
import { useEditor } from "@tiptap/react";
import { useShallow } from "zustand/shallow";

import { PromptLintPanel } from "./components/ai/PromptLintPanel";
import { MarkdownSurface } from "./components/editor/MarkdownSurface";
import { PdfFindBar } from "./components/editor/pdf/PdfFindBar";
import { PluginViewerHost } from "./components/editor/PluginViewerHost";
import { PreviewToggleButton } from "./components/editor/PreviewToggleButton";
import { TabSurface } from "./components/editor/TabSurface";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppDialogs } from "./components/layout/AppDialogs";
import { AppLayout } from "./components/layout/AppLayout";
import { StatusBar } from "./components/layout/StatusBar";
import { TabBar } from "./components/layout/TabBar";
import { TabSwitcher } from "./components/layout/TabSwitcher";
import { HomeSurface } from "./components/onboarding/HomeSurface";
import { GraphViewLazy } from "./components/sidebar/GraphViewLazy";
import { EditorProvider } from "./contexts/editor-context";
import { createBaramExtensions } from "./extensions";
import { useActiveTabSurface } from "./hooks/use-active-tab-surface";
import { useAppStartup } from "./hooks/use-app-startup";
import { useAutoSave } from "./hooks/use-auto-save";
import { useAutoSnapshot } from "./hooks/use-auto-snapshot";
import { useCloseGuard } from "./hooks/use-close-guard";
import { useCodeAutoSave } from "./hooks/use-code-auto-save";
import { useEditorEffects } from "./hooks/use-editor-effects";
import { useExternalDrop } from "./hooks/use-external-drop";
import { useFileOperations } from "./hooks/use-file-operations";
import { useFileWatcher } from "./hooks/use-file-watcher";
import { useFindReplaceRouting } from "./hooks/use-find-replace-routing";
import { useGhostText } from "./hooks/use-ghost-text";
import { useGlobalCaptureShortcut } from "./hooks/use-global-capture-shortcut";
import { useGlobalKeyboard } from "./hooks/use-global-keyboard";
import { useInlineAI } from "./hooks/use-inline-ai";
import { useJournal } from "./hooks/use-journal";
import { useJournalInitialCursor } from "./hooks/use-journal-initial-cursor";
import { useKeepaliveEditors } from "./hooks/use-keepalive-editors";
import { useKeybindingActions } from "./hooks/use-keybinding-actions";
import { useMenuEventHandler } from "./hooks/use-menu-event-handler";
import { useNavigation } from "./hooks/use-navigation";
import { usePerfInstrumentation } from "./hooks/use-perf-instrumentation";
import { usePluginLifecycle } from "./hooks/use-plugin-lifecycle";
import { usePreviewSourceView } from "./hooks/use-preview-source-view";
import { useRetainedSurfaces } from "./hooks/use-retained-surfaces";
import { useSettingsEffects } from "./hooks/use-settings-effects";
import { useSkillsMode } from "./hooks/use-skills-mode";
import { type AppendHandleRef, useSourceMode } from "./hooks/use-source-mode";
import { useTabSwitcherOverlay } from "./hooks/use-tab-switcher-overlay";
import { useTabSwitching } from "./hooks/use-tab-switching";
import { useTaskWatcher } from "./hooks/use-task-watcher";
import { useZoom } from "./hooks/use-zoom";
import { useTranslation } from "./i18n/useTranslation";
import { notifyEditorReady } from "./plugins/plugin-lifecycle";
import { isImeProbeEnabled } from "./spike/ime-probe/ime-probe-enabled";
import { isVimWysiwygProbeEnabled } from "./spike/vim-wysiwyg-probe/vim-probe-enabled";
import { useUIStore } from "./stores/ui/ui";
import { FILE_MODE_PATH } from "./utils/file-mode";
import { logAppReady } from "./utils/perf";
// Stylesheet moved to `main.tsx` (§260 Phase 5 re-review, R3): App is dynamically
// imported, so a stylesheet imported here is bound to that chunk and never reaches
// index.html's <head> — a blank window on cold start.

// §8.4 Lazy-loaded components — split into separate chunks, loaded on first use
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
  const {
    activeTab,
    activeTabFilePath,
    activeTabId,
    fileViewers,
    htmlSourceTabs,
    isCodeFile,
    isEditableTextFile,
    isHtmlSourceView,
    isHtmlTab,
    isPdfTab,
    isPluginPreviewTab,
    markDirty,
    pluginViewer,
    previewFileMtime,
    rootPath,
    setHtmlSourceTabs,
  } = useActiveTabSurface();

  const {
    findReplaceMode,
    findReplaceOpen,
    handleTogglePdfFind,
    pdfFindApi,
    pdfFindOpen,
    routeFindReplaceOpen,
    setFindReplaceMode,
    setFindReplaceOpen,
    setPdfFindApi,
    setPdfFindOpen,
  } = useFindReplaceRouting(isPdfTab);
  // §perf-large-file B2/C2: Loading state for async parse
  const [isParsing, setIsParsing] = useState(false);

  const {
    setTabSwitcherIndex,
    setTabSwitcherOpen,
    tabSwitcherIndex,
    tabSwitcherMruRef,
    tabSwitcherOpen,
  } = useTabSwitcherOverlay();

  // §72 Skill Preview Panel state
  const [skillPreviewOpen, setSkillPreviewOpen] = useState(false);
  // Stable identity: this is a CommandPalette `commands` useMemo dep, so an
  // inline arrow here would rebuild the palette's 476-line buildCommands()
  // on every App re-render, even while the palette is closed.
  const handleSkillPreviewToggle = useCallback(() => {
    setSkillPreviewOpen((v) => !v);
  }, [setSkillPreviewOpen]);

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
  const {
    activeEditor,
    activeKeepaliveEditor,
    keepalive,
    mountedKeepaliveEditor,
    onActiveEditorChange: handleActiveEditorChange,
  } = useKeepaliveEditors(editor);

  usePerfInstrumentation(activeEditor);
  usePluginLifecycle(editor);

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

  const {
    isMarkdownSurfaceActive,
    retainedTabs,
    statusBarMode,
    surfaceKind,
    tabSurfaceRenderers,
  } = useRetainedSurfaces({
    activeEditor,
    activeTab,
    activeTabId,
    fileViewers,
    getSourceBuffer,
    handleTogglePdfFind,
    hasSourceBuffer,
    htmlSourceTabs,
    isCodeFile,
    isHtmlSourceView,
    isPdfTab,
    isSourceMode,
    markDirty,
    pdfFindOpen,
    rootPath,
    scrollOffsets,
    setPdfFindApi,
    setSourceBuffer,
    sourceCursorOffsetFor,
    sourceModeTabs,
  });

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

  // Preview ↔ source toggle for HTML / plugin-previewed text tabs, and the
  // Cmd+/ router that falls through to the markdown source-mode toggle.
  const { handleToggleSourceMode, toggleHtmlView } = usePreviewSourceView({
    getSourceBuffer,
    htmlSourceTabs,
    markDirty,
    setHtmlSourceTabs,
    toggleSourceMode,
  });

  // §5.1 HTML·플러그인 프리뷰 파일의 프리뷰 ↔ 원본 토글 버튼. 활성 표면 안에 겹쳐 그린다
  // (TabSurface의 `overlay` prop 주석 참조 — `.editor-area-scroll`의 CSS zoom 때문이다).
  const previewToggleButton =
    isHtmlTab || isPluginPreviewTab ? (
      <PreviewToggleButton
        isSourceView={isHtmlSourceView}
        onClick={toggleHtmlView}
      />
    ) : null;

  // §56 Journal — auto-create today's journal on startup
  useJournal(handleOpenFilePath);

  // App startup side effects — migration, onLaunch restore, file open events
  useAppStartup({ handleOpenFilePath, handleNewFile });

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
            <HomeSurface
              onNewFile={handleNewFile}
              onOpenFile={handleOpenFile}
              onOpenFolder={handleOpenFolder}
              onOpenRecentFile={handleOpenRecentFile}
              onOpenRecentFolder={handleOpenRecentFolder}
            />
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

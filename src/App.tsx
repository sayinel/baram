// §4.2 Baram App — 3-Column layout with editor
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";

import { Editor as TiptapCoreEditor } from "@tiptap/core";
import { useEditor } from "@tiptap/react";

import { PromptLintPanel } from "./components/ai/PromptLintPanel";
import { PreviewToggleButton } from "./components/editor/PreviewToggleButton";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppDialogs } from "./components/layout/AppDialogs";
import { AppLayout } from "./components/layout/AppLayout";
import { EditorArea } from "./components/layout/EditorArea";
import { StatusBar } from "./components/layout/StatusBar";
import { TabBar } from "./components/layout/TabBar";
import { TabSwitcher } from "./components/layout/TabSwitcher";
import { EditorProvider } from "./contexts/editor-context";
import { createBaramExtensions } from "./extensions";
import { useActiveTabSurface } from "./hooks/use-active-tab-surface";
import { useAppCommands } from "./hooks/use-app-commands";
import { useAppStartup } from "./hooks/use-app-startup";
import { useCodeAutoSave } from "./hooks/use-code-auto-save";
import { useEditorEffects } from "./hooks/use-editor-effects";
import { useEditorFeatures } from "./hooks/use-editor-features";
import { useFileOperations } from "./hooks/use-file-operations";
import { useFindReplaceRouting } from "./hooks/use-find-replace-routing";
import { useJournal } from "./hooks/use-journal";
import { useKeepaliveEditors } from "./hooks/use-keepalive-editors";
import { useNavigation } from "./hooks/use-navigation";
import { usePerfInstrumentation } from "./hooks/use-perf-instrumentation";
import { usePluginLifecycle } from "./hooks/use-plugin-lifecycle";
import { usePreviewSourceView } from "./hooks/use-preview-source-view";
import { useRetainedSurfaces } from "./hooks/use-retained-surfaces";
import { type AppendHandleRef, useSourceMode } from "./hooks/use-source-mode";
import { useTabSwitcherOverlay } from "./hooks/use-tab-switcher-overlay";
import { useTabSwitching } from "./hooks/use-tab-switching";
import { notifyEditorReady } from "./plugins/plugin-lifecycle";
import { isImeProbeEnabled } from "./spike/ime-probe/ime-probe-enabled";
import { isVimWysiwygProbeEnabled } from "./spike/vim-wysiwyg-probe/vim-probe-enabled";
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
  const activeSurface = useActiveTabSurface();
  const {
    isEditableTextFile,
    isHtmlTab,
    isPluginPreviewTab,
    markDirty,
    rootPath,
  } = activeSurface;

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
  } = useFindReplaceRouting(activeSurface.isPdfTab);
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

  const { inlineAI, isSkill } = useEditorFeatures(activeEditor);

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

  const { retainedTabs, statusBarMode, surfaceKind, tabSurfaceRenderers } =
    useRetainedSurfaces({
      activeEditor,
      activeSurface,
      isSourceMode,
      pdfFind: {
        onToggle: handleTogglePdfFind,
        open: pdfFindOpen,
        setApi: setPdfFindApi,
      },
      scrollOffsets,
      sourceBuffers: {
        cursorOffsetFor: sourceCursorOffsetFor,
        get: getSourceBuffer,
        has: hasSourceBuffer,
        set: setSourceBuffer,
      },
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
    htmlSourceTabs: activeSurface.htmlSourceTabs,
    markDirty,
    setHtmlSourceTabs: activeSurface.setHtmlSourceTabs,
    toggleSourceMode,
  });

  // §5.1 HTML·플러그인 프리뷰 파일의 프리뷰 ↔ 원본 토글 버튼. 활성 표면 안에 겹쳐 그린다
  // (TabSurface의 `overlay` prop 주석 참조 — `.editor-area-scroll`의 CSS zoom 때문이다).
  const previewToggleButton =
    isHtmlTab || isPluginPreviewTab ? (
      <PreviewToggleButton
        isSourceView={activeSurface.isHtmlSourceView}
        onClick={toggleHtmlView}
      />
    ) : null;

  // §56 Journal — auto-create today's journal on startup
  useJournal(handleOpenFilePath);

  // App startup side effects — migration, onLaunch restore, file open events
  useAppStartup({ handleOpenFilePath, handleNewFile });

  // --- Keybindings, global keyboard shortcuts, native menu ---
  useAppCommands({
    activeEditor,
    fileOps: {
      handleCloseFolder,
      handleCloseTab,
      handleNewFile,
      handleOpenFile,
      handleOpenFilePath,
      handleOpenFolder,
      handleSave,
      handleSaveAs,
    },
    find: {
      findReplaceOpen,
      routeFindReplaceOpen,
      setFindReplaceMode,
    },
    handleToggleSourceMode,
    inlineAI,
    isSourceMode,
    navigation: {
      handleGoBack,
      handleGoForward,
    },
    tabSwitcher: {
      setTabSwitcherIndex,
      setTabSwitcherOpen,
      tabSwitcherMruRef,
      tabSwitcherOpen,
    },
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
        <EditorArea
          find={{
            findReplaceMode,
            findReplaceOpen,
            pdfFindApi,
            pdfFindOpen,
            setFindReplaceMode,
            setFindReplaceOpen,
            setPdfFindOpen,
          }}
          home={{
            handleNewFile,
            handleOpenFile,
            handleOpenFolder,
            handleOpenRecentFile,
            handleOpenRecentFolder,
          }}
          markdown={{
            activeEditor,
            activeKeepaliveEditor,
            editor,
            inlineAI,
            isParsing,
            mountedKeepaliveEditor,
            scrollOffsets,
          }}
          previewToggleButton={previewToggleButton}
          surface={{
            activeSurface,
            retainedTabs,
            sourceEditorRef,
            surfaceKind,
            tabSurfaceRenderers,
          }}
        />
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

// §4.2 Baram App — 3-Column layout with editor
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { MergeSegment } from "./ipc/types";
import type { EditorTab } from "./stores/editor/editor";

import { Editor as TiptapCoreEditor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useShallow } from "zustand/shallow";

import { InlineAIPrompt } from "./components/ai/InlineAIPrompt";
import { PromptLintPanel } from "./components/ai/PromptLintPanel";
import { FindReplaceBar } from "./components/editor/FindReplaceBar";
import { UnsavedChangesModal } from "./components/editor/UnsavedChangesModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppLayout } from "./components/layout/AppLayout";
import { StatusBar } from "./components/layout/StatusBar";
import { TabBar } from "./components/layout/TabBar";
import { TabSwitcher } from "./components/layout/TabSwitcher";
import { BlockHandle } from "./components/toolbar/BlockHandle";
import { ContextMenu } from "./components/toolbar/ContextMenu";
import { FloatingToolbar } from "./components/toolbar/FloatingToolbar";
import { TableInsertButtons } from "./components/toolbar/TableInsertButtons";
import { TableSelectionHandles } from "./components/toolbar/TableSelectionHandles";
import { TableToolbar } from "./components/toolbar/TableToolbar";
import { EditorProvider } from "./contexts/editor-context";
import { createBaramExtensions } from "./extensions";
import { useAppStartup } from "./hooks/use-app-startup";
import { useAutoSave } from "./hooks/use-auto-save";
import { useCloseGuard } from "./hooks/use-close-guard";
import { useEditorEffects } from "./hooks/use-editor-effects";
import { useExternalDrop } from "./hooks/use-external-drop";
import {
  triggerAutoReload,
  useFileOperations,
} from "./hooks/use-file-operations";
import { useFileWatcher } from "./hooks/use-file-watcher";
import { useGhostText } from "./hooks/use-ghost-text";
import { useInlineAI } from "./hooks/use-inline-ai";
import { useJournal } from "./hooks/use-journal";
import { useJournalInitialCursor } from "./hooks/use-journal-initial-cursor";
import {
  useGlobalKeyboard,
  useKeybindingActions,
} from "./hooks/use-keybinding-actions";
import { useLargeDocKeepalive } from "./hooks/use-large-doc-keepalive";
import { useMenuEventHandler } from "./hooks/use-menu-event-handler";
import { useNavigation } from "./hooks/use-navigation";
import { useSettingsEffects } from "./hooks/use-settings-effects";
import { useSkillsMode } from "./hooks/use-skills-mode";
import { type AppendHandleRef, useSourceMode } from "./hooks/use-source-mode";
import { useTabSwitching } from "./hooks/use-tab-switching";
import { useZoom } from "./hooks/use-zoom";
import { useTranslation } from "./i18n/useTranslation";
import { llmComplete, readFile, writeFile } from "./ipc/invoke";
import { mergeTexts } from "./ipc/snapshot";
import { markdownToProsemirror } from "./pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "./pipeline/pm-to-md";
import {
  initializePlugins,
  notifyEditorReady,
  shutdownPlugins,
} from "./plugins/plugin-lifecycle";
import { pluginLoader } from "./plugins/plugin-loader";
import {
  startUpdateChecker,
  stopUpdateChecker,
} from "./plugins/update-checker";
import { useAIStore } from "./stores/ai/ai";
import { useEditorStore } from "./stores/editor/editor";
import { isFileTab, isGraphTab } from "./stores/editor/editor";
import { useFileStore } from "./stores/file/file";
import { useSettingsStore } from "./stores/settings/store";
import { useUIStore } from "./stores/ui/ui";
import { initPerfTrace, instrumentEditor } from "./utils/editor/perf-trace";
import { getLanguageForFile, isMarkdownFile } from "./utils/file-type";
import { createLLMStream } from "./utils/llm-stream";
import { logger } from "./utils/logger";
import { getConfigForTask } from "./utils/model-selection";
import { logAppReady } from "./utils/perf";
import { buildTemplatePrompt } from "./utils/smart-templates";
import "./styles/index.css";

// §8.4 Lazy-loaded components — split into separate chunks, loaded on first use
const SourceCodeEditor = lazy(() =>
  import("./components/editor/SourceCodeEditor").then((m) => ({
    default: m.SourceCodeEditor,
  })),
);
const CommandPalette = lazy(() =>
  import("./components/command/CommandPalette").then((m) => ({
    default: m.CommandPalette,
  })),
);
const ExportDialog = lazy(() =>
  import("./components/export/ExportDialog").then((m) => ({
    default: m.ExportDialog,
  })),
);
const HomeScreen = lazy(() =>
  import("./components/onboarding/HomeScreen").then((m) => ({
    default: m.HomeScreen,
  })),
);
const QuickSwitcher = lazy(() =>
  import("./components/command/QuickSwitcher").then((m) => ({
    default: m.QuickSwitcher,
  })),
);
const HoverPreview = lazy(() =>
  import("./components/editor/HoverPreview").then((m) => ({
    default: m.HoverPreview,
  })),
);
const SettingsModal = lazy(() =>
  import("./components/settings/SettingsModal").then((m) => ({
    default: m.SettingsModal,
  })),
);
const AboutModal = lazy(() =>
  import("./components/settings/AboutModal").then((m) => ({
    default: m.AboutModal,
  })),
);
const GraphViewTab = lazy(() =>
  import("./components/sidebar/GraphView").then((m) => ({
    default: m.GraphView,
  })),
);
const SkillGeneratorDialog = lazy(() =>
  import("./components/ai/SkillGeneratorDialog").then((m) => ({
    default: m.SkillGeneratorDialog,
  })),
);
const SmartTemplateDialog = lazy(() =>
  import("./components/ai/SmartTemplateDialog").then((m) => ({
    default: m.SmartTemplateDialog,
  })),
);
const SkillTestDialog = lazy(() =>
  import("./components/ai/SkillTestDialog").then((m) => ({
    default: m.SkillTestDialog,
  })),
);
const SkillPreviewPanel = lazy(() =>
  import("./components/ai/SkillPreviewPanel").then((m) => ({
    default: m.SkillPreviewPanel,
  })),
);
const QuickCaptureDialog = lazy(() =>
  import("./components/journal/QuickCaptureDialog").then((m) => ({
    default: m.QuickCaptureDialog,
  })),
);
const ZettelTitleDialog = lazy(() =>
  import("./components/journal/ZettelTitleDialog").then((m) => ({
    default: m.ZettelTitleDialog,
  })),
);
const ConflictModalWrapper = lazy(() =>
  import("./components/editor/ConflictModal").then((m) => ({
    default: m.ConflictModalWrapper,
  })),
);
const ToastHost = lazy(() =>
  import("./components/editor/Toast").then((m) => ({
    default: m.ToastHost,
  })),
);
const MergeView = lazy(() =>
  import("./components/editor/MergeView").then((m) => ({
    default: m.MergeView,
  })),
);

// §89 Lazy-loaded file editor for standalone file mode
const FileEditorLayout = lazy(() =>
  import("./components/layout/FileEditorLayout").then((m) => ({
    default: m.FileEditorLayout,
  })),
);

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
  const isGraphTabActive = useEditorStore((s) =>
    isGraphTab(s.tabs.find((t) => t.id === s.activeTabId)),
  );
  const markDirty = useEditorStore((s) => s.markDirty);
  const rootPath = useFileStore((s) => s.rootPath);

  // Derived: non-markdown code file detection for rendering branch
  const isCodeFile = !!activeTabFilePath && !isMarkdownFile(activeTabFilePath);
  const codeLanguage = activeTabFilePath
    ? getLanguageForFile(activeTabFilePath)
    : null;

  // §5.6 Find/Replace state
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findReplaceMode, setFindReplaceMode] = useState<"find" | "replace">(
    "find",
  );
  // §perf-large-file B2/C2: Loading state for async parse
  const [isParsing, setIsParsing] = useState(false);

  // §39 Tab switcher state
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false);
  const [mergeState, setMergeState] = useState<null | {
    filePath: string;
    segments: MergeSegment[];
  }>(null);
  const [tabSwitcherIndex, setTabSwitcherIndex] = useState(0);

  // §72 Skill Preview Panel state
  const [skillPreviewOpen, setSkillPreviewOpen] = useState(false);
  const tabSwitcherMruRef = useRef<EditorTab[]>([]);

  const editor = useEditor({
    extensions: createBaramExtensions({
      onNavigate: (target, heading, vaultAlias) =>
        navigateRef.current(target, heading, vaultAlias),
      onNavigateBlockRef: (target, blockId) =>
        blockRefNavigateRef.current(target, blockId),
      onNavigateLocal: (href) => localLinkNavigateRef.current(href),
      onMentionNavigate: (type, value) =>
        mentionNavigateRef.current(type, value),
    }),
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
    initializePlugins().catch((err) =>
      logger.error("[App] Plugin initialization failed:", err),
    );
    startUpdateChecker();
    return () => {
      stopUpdateChecker();
      shutdownPlugins().catch((e) => logger.error(e));
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

  // --- Source mode (WYSIWYG ↔ raw markdown toggle) ---
  // Must be called before useFileOperations and useTabSwitching because it owns
  // editorStateCache and exposes isSourceMode / sourceContentRef they need.
  // [MAJOR-3 fix] Pass activeEditor so source-mode toggle reads/writes the
  // correct document for keep-alive tabs.
  const {
    isSourceMode,
    setIsSourceMode,
    sourceContent,
    setSourceContent,
    sourceCursorOffset,
    sourceEditorRef,
    sourceContentRef,
    editorStateCache,
    toggleSourceMode,
    handleSourceChange,
  } = useSourceMode({ editor: activeEditor, appendHandleRef, pool: keepalive });

  // Auto-save for non-MD code files (debounced write when dirty)
  const { autoSave, autoSaveDelay } = useSettingsStore(
    useShallow((s) => ({
      autoSave: s.autoSave,
      autoSaveDelay: s.autoSaveDelay,
    })),
  );
  const { setFileContent } = useFileStore();
  const codeAutoSaveTimer = useRef<null | ReturnType<typeof setTimeout>>(null);
  useEffect(() => {
    if (!isCodeFile || !autoSave) return;
    const { activeTabId: tabId, tabs: currentTabs } = useEditorStore.getState();
    const tab = currentTabs.find((t) => t.id === tabId);
    if (!tab?.isDirty || !tab.filePath) return;

    if (codeAutoSaveTimer.current) clearTimeout(codeAutoSaveTimer.current);
    codeAutoSaveTimer.current = setTimeout(async () => {
      try {
        await writeFile(tab.filePath!, sourceContentRef.current);
        useFileStore.getState().updateLastSaveMtime(tab.filePath!, Date.now());
        setFileContent(tab.filePath!, sourceContentRef.current);
        markDirty(tab.id, false);
      } catch {
        // Save failed — keep dirty state
      }
    }, autoSaveDelay);

    return () => {
      if (codeAutoSaveTimer.current) clearTimeout(codeAutoSaveTimer.current);
    };
  }, [
    isCodeFile,
    autoSave,
    autoSaveDelay,
    sourceContent,
    markDirty,
    setFileContent,
    sourceContentRef,
  ]);

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
    isSourceMode,
    sourceContentRef,
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
    isSourceMode,
    keepalive,
    createKeepaliveEditor,
    onActiveEditorChange: handleActiveEditorChange,
    setFindReplaceMode,
    setFindReplaceOpen,
    setIsSourceMode,
    setIsParsing,
    setSourceContent,
    sourceContentRef,
  });

  // --- Editor effects (selection, content reload, goto-position, title) ---
  // §perf-large-file C3.5: use activeEditor so keep-alive tabs handle goto-position correctly
  useEditorEffects({
    editor: activeEditor,
    editorStateCache,
    inlineAI,
    setFindReplaceMode,
    setFindReplaceOpen,
  });

  // onChange for non-MD code files — same as source but also marks dirty
  const handleCodeFileChange = useCallback(
    (content: string) => {
      sourceContentRef.current = content;
      setSourceContent(content);
      const { activeTabId: tabId } = useEditorStore.getState();
      if (tabId) markDirty(tabId, true);
    },
    // setSourceContent (useState setter) and sourceContentRef (useRef) are stable —
    // intentionally omitted from deps for consistency with toggleSourceMode pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markDirty],
  );

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
    setFindReplaceOpen,
    setSidebarPanel,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    toggleSidebar,
    toggleSourceMode,
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
    setFindReplaceOpen,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    toggleSidebar,
    toggleSourceMode,
  });

  return (
    <EditorProvider value={activeEditor}>
      <AppLayout
        statusBar={
          rootPath ? (
            <StatusBar
              editor={activeEditor}
              mode={
                isGraphTabActive ? "graph" : isSourceMode ? "source" : "wysiwyg"
              }
            />
          ) : undefined
        }
      >
        {!!rootPath && <TabBar />}
        <div className="editor-area">
          {!rootPath && !activeTabId ? (
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
                      await import("./stores/file/file");
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
          ) : !activeTabId ? (
            <div className="editor-area-scroll" data-editor-scroll>
              <div className="empty-workspace">
                <p>{t("home.emptyWorkspace")}</p>
              </div>
            </div>
          ) : isGraphTabActive ? (
            <div className="editor-area-scroll" data-editor-scroll>
              <Suspense fallback={null}>
                <GraphViewTab />
              </Suspense>
            </div>
          ) : isCodeFile ? (
            <div className="editor-area-scroll" data-editor-scroll>
              <Suspense fallback={null}>
                <SourceCodeEditor
                  content={sourceContent}
                  key={`code-${activeTabId}`}
                  language={codeLanguage ?? undefined}
                  onChange={handleCodeFileChange}
                  ref={sourceEditorRef}
                />
              </Suspense>
            </div>
          ) : isSourceMode ? (
            <div className="editor-area-scroll" data-editor-scroll>
              <Suspense fallback={null}>
                <SourceCodeEditor
                  content={sourceContent}
                  initialCursorOffset={sourceCursorOffset}
                  onChange={handleSourceChange}
                  ref={sourceEditorRef}
                />
              </Suspense>
            </div>
          ) : (
            <>
              {findReplaceOpen && activeEditor && (
                <FindReplaceBar
                  editor={activeEditor}
                  mode={findReplaceMode}
                  onClose={() => setFindReplaceOpen(false)}
                  onSetMode={setFindReplaceMode}
                />
              )}
              <div
                className="editor-area-scroll"
                data-editor-active
                data-editor-scroll
              >
                {/* §perf-large-file B2: Loading skeleton while Worker parses */}
                {isParsing && (
                  <div className="editor-loading-skeleton">
                    <div className="skeleton-line w-3/4" />
                    <div className="skeleton-line w-full" />
                    <div className="skeleton-line w-5/6" />
                    <div className="skeleton-line w-2/3" />
                    <div className="skeleton-line w-full" />
                    <div className="skeleton-line w-1/2" />
                  </div>
                )}
                {/* §perf-large-file C3.5: keep-alive editor — stays mounted while
                    in pool (DOM kept alive), hidden when another tab is active. */}
                {mountedKeepaliveEditor && (
                  <div
                    data-keepalive-editor
                    style={{
                      display: activeKeepaliveEditor ? "" : "none",
                    }}
                  >
                    <EditorContent editor={mountedKeepaliveEditor} />
                  </div>
                )}
                {/* Shared editor — hidden when a keep-alive editor is active */}
                <div style={{ display: activeKeepaliveEditor ? "none" : "" }}>
                  <EditorContent editor={editor} />
                </div>
                {activeEditor && (
                  <>
                    <FloatingToolbar editor={activeEditor} />
                    <TableToolbar editor={activeEditor} />
                    <BlockHandle editor={activeEditor} />
                    <TableInsertButtons editor={activeEditor} />
                    <TableSelectionHandles editor={activeEditor} />
                    <ContextMenu editor={activeEditor} />
                    {inlineAI.isActive && inlineAI.phase !== "idle" && (
                      <InlineAIPrompt
                        editor={activeEditor}
                        hasSelection={inlineAI.hasSelection}
                        hunks={inlineAI.hunks}
                        onAccept={inlineAI.accept}
                        onAcceptHunk={inlineAI.acceptHunk}
                        onClose={inlineAI.cancel}
                        onRegenerate={inlineAI.regenerate}
                        onReject={inlineAI.reject}
                        onRejectHunk={inlineAI.rejectHunk}
                        onSubmit={inlineAI.submitPrompt}
                        phase={
                          inlineAI.phase as "completed" | "input" | "streaming"
                        }
                        selectionFrom={inlineAI.selectionFrom}
                        selectionTo={inlineAI.selectionTo}
                      />
                    )}
                  </>
                )}
              </div>
            </>
          )}
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
      <Suspense fallback={null}>
        <CommandPalette
          editor={activeEditor}
          onCloseFolder={handleCloseFolder}
          onNewFile={handleNewFile}
          onOpenFile={handleOpenFile}
          onOpenFolder={handleOpenFolder}
          onSave={handleSave}
          onSkillPreview={() => setSkillPreviewOpen((v) => !v)}
          onToggleSourceMode={toggleSourceMode}
        />
        <ExportDialog editor={activeEditor} />
        <QuickSwitcher editor={activeEditor} onNewFile={handleNewFile} />
        <SettingsModal />
        <AboutModal />
        <UnsavedChangesModal
          editor={activeEditor}
          handleSave={handleSave}
          isSourceMode={isSourceMode}
          sourceContentRef={sourceContentRef}
        />
        <HoverPreview />
        <SkillGeneratorDialogWrapper />
        <SkillTestDialogWrapper />
        <SmartTemplateDialogWrapper editor={activeEditor} />
        <QuickCaptureDialog />
        <ZettelTitleDialog />
        <ConflictModalWrapper
          onKeepLocal={(filePath) => {
            // Keep local edits: clear the mtime guard so the next save (and the
            // immediate save below) overwrites the external change on disk.
            const entry = useFileStore.getState().getFileMtime(filePath);
            useFileStore
              .getState()
              .updateLastSaveMtime(filePath, entry?.canReloadMtime ?? 0);
            // If the conflicted file is the active tab, persist local edits now so
            // they aren't lost if the user doesn't edit again before quitting.
            const { activeTabId, tabs } = useEditorStore.getState();
            const activeTab = tabs.find((t) => t.id === activeTabId);
            if (activeTab?.filePath === filePath) void handleSave();
          }}
          onMerge={async (filePath, base) => {
            if (!activeEditor || activeEditor.isDestroyed) return;
            const local = prosemirrorToMarkdown(activeEditor.state.doc);
            const external = await readFile(filePath);
            const result = await mergeTexts(base, local, external);
            setMergeState({ filePath, segments: result.segments });
          }}
          onReload={(filePath, externalMtime) => {
            void triggerAutoReload(filePath, externalMtime).catch(() => {});
          }}
        />
        <ToastHost />
        {mergeState && (
          <MergeView
            filePath={mergeState.filePath}
            onApply={(merged) => {
              const fp = mergeState.filePath;
              void (async () => {
                try {
                  await writeFile(fp, merged);
                  useFileStore.getState().setFileContent(fp, merged);
                  useFileStore.getState().updateLastSaveMtime(fp, Date.now());
                  useEditorStore.getState().requestContentRefresh();
                  const { activeTabId: tid } = useEditorStore.getState();
                  if (tid) markDirty(tid, false);
                } catch (err) {
                  logger.error("[App] merge apply failed", err);
                }
              })();
              setMergeState(null);
            }}
            onCancel={() => setMergeState(null)}
            segments={mergeState.segments}
          />
        )}
      </Suspense>
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
  return (
    <ErrorBoundary
      fallback={
        <div
          style={{
            padding: 24,
            fontFamily: "monospace",
            color: "red",
          }}
        >
          <h2>Something went wrong</h2>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      }
    >
      <AppRoot />
    </ErrorBoundary>
  );
}

function SkillGeneratorDialogWrapper() {
  const { skillGeneratorDialogOpen, toggleSkillGeneratorDialog } = useUIStore(
    useShallow((s) => ({
      skillGeneratorDialogOpen: s.skillGeneratorDialogOpen,
      toggleSkillGeneratorDialog: s.toggleSkillGeneratorDialog,
    })),
  );
  return (
    <SkillGeneratorDialog
      onClose={toggleSkillGeneratorDialog}
      open={skillGeneratorDialogOpen}
    />
  );
}

function SkillTestDialogWrapper() {
  const { skillTestDialogOpen, toggleSkillTestDialog } = useUIStore(
    useShallow((s) => ({
      skillTestDialogOpen: s.skillTestDialogOpen,
      toggleSkillTestDialog: s.toggleSkillTestDialog,
    })),
  );
  return (
    <SkillTestDialog
      onClose={toggleSkillTestDialog}
      open={skillTestDialogOpen}
    />
  );
}

function SmartTemplateDialogWrapper({
  editor,
}: {
  editor: null | ReturnType<typeof useEditor>;
}) {
  const { smartTemplateDialogOpen, toggleSmartTemplateDialog } = useUIStore();
  const handleGenerate = useCallback(
    (templateId: string) => {
      if (!editor) return;
      toggleSmartTemplateDialog();
      const isCustom = templateId.startsWith("custom:");
      const prompt = isCustom
        ? templateId.slice("custom:".length)
        : buildTemplatePrompt(templateId);
      const systemPrompt = isCustom
        ? "Generate a well-structured markdown document based on the user's description. Include headings, sections, and placeholder content."
        : "Generate a complete markdown document based on the template structure. Fill each section with relevant placeholder content.";

      // Accumulate all tokens, then insert parsed markdown (not raw text)
      const inlineCfg = getConfigForTask("inline-edit");
      if (!inlineCfg.apiKey && inlineCfg.provider !== "ollama") {
        logger.error("SmartTemplate: no API key configured");
        return;
      }
      const store = useAIStore.getState();
      const requestId = `ai_template_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      let accumulated = "";

      void (async () => {
        const cleanupFn = await createLLMStream(requestId, {
          onToken: (token) => {
            accumulated += token;
          },
          onDone: () => {
            if (accumulated.trim()) {
              const doc = markdownToProsemirror(accumulated, editor.schema);
              const { from } = editor.state.selection;
              editor.view.dispatch(
                editor.state.tr.insert(from, doc.content).scrollIntoView(),
              );
              editor.view.focus();
            }
          },
          onError: (error) => {
            logger.error("SmartTemplate error:", error);
          },
        });
        try {
          await llmComplete(
            prompt,
            inlineCfg.model,
            requestId,
            systemPrompt,
            undefined,
            inlineCfg.provider,
            inlineCfg.baseUrl,
            store.privacyMode,
          );
        } catch (e) {
          logger.error(e);
        } finally {
          cleanupFn();
        }
      })();
    },
    [editor, toggleSmartTemplateDialog],
  );
  return (
    <SmartTemplateDialog
      isOpen={smartTemplateDialogOpen}
      onClose={toggleSmartTemplateDialog}
      onGenerate={handleGenerate}
    />
  );
}

export default AppWithErrorBoundary;

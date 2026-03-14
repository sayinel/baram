// §4.2 Baram App — 3-Column layout with editor
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { EditorTab } from "./stores/editor-store";

import { EditorContent, useEditor } from "@tiptap/react";

import { InlineAIPrompt } from "./components/ai/InlineAIPrompt";
import { PromptLintPanel } from "./components/ai/PromptLintPanel";
import { FindReplaceBar } from "./components/editor/FindReplaceBar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FollowUpCard } from "./components/journal/FollowUpCard";
import { MoodBar } from "./components/journal/MoodBar";
import {
  detectPeriodicType,
  PeriodicInsightBanner,
} from "./components/journal/PeriodicInsightBanner";
import { AppLayout } from "./components/layout/AppLayout";
import { StatusBar } from "./components/layout/StatusBar";
import { TabBar } from "./components/layout/TabBar";
import { TabSwitcher } from "./components/layout/TabSwitcher";
import { BlockHandle } from "./components/toolbar/BlockHandle";
import { ContextMenu } from "./components/toolbar/ContextMenu";
import { FloatingToolbar } from "./components/toolbar/FloatingToolbar";
import { TableInsertButtons } from "./components/toolbar/TableInsertButtons";
import { TableToolbar } from "./components/toolbar/TableToolbar";
import { createBaramExtensions } from "./extensions";
import { useAppStartup } from "./hooks/use-app-startup";
import { useAutoSave } from "./hooks/use-auto-save";
import { useEditorEffects } from "./hooks/use-editor-effects";
import { useExternalDrop } from "./hooks/use-external-drop";
import { useFileOperations } from "./hooks/use-file-operations";
import { useFileWatcher } from "./hooks/use-file-watcher";
import { useGhostText } from "./hooks/use-ghost-text";
import { useInlineAI } from "./hooks/use-inline-ai";
import { useJournal } from "./hooks/use-journal";
import {
  useGlobalKeyboard,
  useKeybindingActions,
} from "./hooks/use-keybinding-actions";
import { useMenuEventHandler } from "./hooks/use-menu-event-handler";
import { useNavigation } from "./hooks/use-navigation";
import { useSettingsEffects } from "./hooks/use-settings-effects";
import { useSkillsMode } from "./hooks/use-skills-mode";
import { useSourceMode } from "./hooks/use-source-mode";
import { useTabSwitching } from "./hooks/use-tab-switching";
import { useZoom } from "./hooks/use-zoom";
import { useTranslation } from "./i18n/useTranslation";
import { writeFile } from "./ipc/invoke";
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
import { useEditorStore } from "./stores/editor-store";
import { isFileTab, isGraphTab } from "./stores/editor-store";
import { useFileStore } from "./stores/file-store";
import { useSettingsStore } from "./stores/settings-store";
import { useUIStore } from "./stores/ui-store";
import { getLanguageForFile, isMarkdownFile } from "./utils/file-type";
import { logger } from "./utils/logger";
import { logAppReady } from "./utils/perf";
import "./App.css";

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

function App() {
  const { t } = useTranslation();
  const {
    toggleSidebar,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    setSidebarPanel,
  } = useUIStore();
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
  const [tabSwitcherIndex, setTabSwitcherIndex] = useState(0);

  // §72 Skill Preview Panel state
  const [skillPreviewOpen, setSkillPreviewOpen] = useState(false);
  const tabSwitcherMruRef = useRef<EditorTab[]>([]);

  const editor = useEditor({
    extensions: createBaramExtensions({
      onNavigate: (target, heading) => navigateRef.current(target, heading),
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

  // §72 Skills mode — auto-detect skill files and switch right panel
  const { isSkill } = useSkillsMode();

  // Auto-save hook (markdown files — Tiptap editor.on("update") based)
  useAutoSave(editor);

  // File system watcher — auto-refresh FileTree on external changes
  useFileWatcher();

  // Page zoom — trackpad pinch + Cmd+/Cmd-/Cmd+0
  useZoom();

  // External file drag & drop — Tauri OS-level file drop (Feature 1 & 2)
  useExternalDrop({ editor });

  // §43 Ghost Text — inline AI completion
  useGhostText(editor);

  // §6.2 Inline AI — Cmd+J editing
  const inlineAI = useInlineAI(editor);

  // Apply settings to DOM (theme, font, spellcheck, locale)
  useSettingsEffects(editor);

  // --- Source mode (WYSIWYG ↔ raw markdown toggle) ---
  // Must be called before useFileOperations and useTabSwitching because it owns
  // editorStateCache and exposes isSourceMode / sourceContentRef they need.
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
  } = useSourceMode({ editor });

  // Auto-save for non-MD code files (debounced write when dirty)
  const { autoSave, autoSaveDelay } = useSettingsStore();
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
    editor,
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

  // --- Tab switching ---
  useTabSwitching({
    editor,
    editorStateCache,
    isNavBackForwardRef,
    isSourceMode,
    setFindReplaceMode,
    setFindReplaceOpen,
    setIsSourceMode,
    setIsParsing,
    setSourceContent,
    sourceContentRef,
  });

  // --- Editor effects (selection, content reload, goto-position, title) ---
  useEditorEffects({
    editor,
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
    editor,
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
    editor,
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
    editor,
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
    <>
      <AppLayout
        editor={editor}
        statusBar={
          rootPath ? (
            <StatusBar
              editor={editor}
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
              {findReplaceOpen && editor && (
                <FindReplaceBar
                  editor={editor}
                  mode={findReplaceMode}
                  onClose={() => setFindReplaceOpen(false)}
                  onSetMode={setFindReplaceMode}
                />
              )}
              <MoodBar editor={editor} />
              <FollowUpCard editor={editor} />
              {activeTabFilePath && detectPeriodicType(activeTabFilePath) && (
                <PeriodicInsightBanner
                  filePath={activeTabFilePath}
                  type={detectPeriodicType(activeTabFilePath)!}
                />
              )}
              <div className="editor-area-scroll" data-editor-scroll>
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
                <EditorContent editor={editor} />
                {editor && (
                  <>
                    <FloatingToolbar editor={editor} />
                    <TableToolbar editor={editor} />
                    <BlockHandle editor={editor} />
                    <TableInsertButtons editor={editor} />
                    <ContextMenu editor={editor} />
                    {inlineAI.isActive && inlineAI.phase !== "idle" && (
                      <InlineAIPrompt
                        editor={editor}
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
        <PromptLintPanel editor={editor} />
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
          editor={editor}
          onCloseFolder={handleCloseFolder}
          onNewFile={handleNewFile}
          onOpenFile={handleOpenFile}
          onOpenFolder={handleOpenFolder}
          onSave={handleSave}
          onSkillPreview={() => setSkillPreviewOpen((v) => !v)}
          onToggleSourceMode={toggleSourceMode}
        />
        <ExportDialog editor={editor} />
        <QuickSwitcher editor={editor} onNewFile={handleNewFile} />
        <SettingsModal />
        <AboutModal />
        <HoverPreview />
        <SkillGeneratorDialogWrapper />
        <SkillTestDialogWrapper />
        <QuickCaptureDialog />
      </Suspense>
      {tabSwitcherOpen && (
        <TabSwitcher
          mruTabs={tabSwitcherMruRef.current}
          selectedIndex={tabSwitcherIndex}
        />
      )}
    </>
  );
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
      <App />
    </ErrorBoundary>
  );
}

function SkillGeneratorDialogWrapper() {
  const { skillGeneratorDialogOpen, toggleSkillGeneratorDialog } = useUIStore();
  return (
    <SkillGeneratorDialog
      onClose={toggleSkillGeneratorDialog}
      open={skillGeneratorDialogOpen}
    />
  );
}

function SkillTestDialogWrapper() {
  const { skillTestDialogOpen, toggleSkillTestDialog } = useUIStore();
  return (
    <SkillTestDialog
      onClose={toggleSkillTestDialog}
      open={skillTestDialogOpen}
    />
  );
}

export default AppWithErrorBoundary;

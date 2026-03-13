// §4.2 Baram App — 3-Column layout with editor
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { listen } from "@tauri-apps/api/event";

import type { SourceCodeEditorRef } from "./components/editor/SourceCodeEditor";
import type { EditorTab } from "./stores/editor-store";

import { EditorState, TextSelection } from "@tiptap/pm/state";
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
import { forceCollapseSyntaxReveal } from "./extensions/plugins/syntax-reveal";
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
import { useTabSwitching } from "./hooks/use-tab-switching";
import { useZoom } from "./hooks/use-zoom";
import { useTranslation } from "./i18n/useTranslation";
import { getOpenedUrls, writeFile } from "./ipc/invoke";
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
import { useEditorStore } from "./stores/editor-store";
import { isFileTab, isGraphTab } from "./stores/editor-store";
import { openFolder, useFileStore } from "./stores/file-store";
import { useSettingsStore } from "./stores/settings-store";
import { migrateFromLocalStorage } from "./stores/tauri-storage";
import { useUIStore } from "./stores/ui-store";
import { mdOffsetToPmPos, pmPosToMdOffset } from "./utils/cursor-mapper";
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
  const [isSourceMode, setIsSourceMode] = useState(false);
  const [sourceContent, setSourceContent] = useState("");
  const [sourceCursorOffset, setSourceCursorOffset] = useState(0);
  const sourceEditorRef = useRef<SourceCodeEditorRef>(null);
  // Ref mirrors sourceContent state — always has the latest value, immune to stale closures
  const sourceContentRef = useRef("");
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
  ]);

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

  // §3.2 One-time migration: localStorage → Tauri app_data_dir
  useEffect(() => {
    migrateFromLocalStorage().catch(() => {});
  }, []);

  // Apply settings to DOM (theme, font, spellcheck, locale)
  useSettingsEffects(editor);

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
  const { editorStateCache } = useTabSwitching({
    editor,
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

  // Stable onChange for SourceCodeEditor — updates both ref and state
  const handleSourceChange = useCallback((content: string) => {
    sourceContentRef.current = content;
    setSourceContent(content);
  }, []);

  // onChange for non-MD code files — same as source but also marks dirty
  const handleCodeFileChange = useCallback(
    (content: string) => {
      sourceContentRef.current = content;
      setSourceContent(content);
      const { activeTabId: tabId } = useEditorStore.getState();
      if (tabId) markDirty(tabId, true);
    },
    [markDirty],
  );

  // Cmd+/ toggle between WYSIWYG and Source Code mode (§5.1 cursor preservation)
  const toggleSourceMode = useCallback(() => {
    if (!editor) return;
    const { tabs: currentTabs, activeTabId: currentTabId } =
      useEditorStore.getState();
    const currentTab = currentTabs.find((t) => t.id === currentTabId);
    // Graph tab / non-MD file — source mode not applicable
    if (isGraphTab(currentTab)) return;
    if (
      currentTab &&
      isFileTab(currentTab) &&
      !isMarkdownFile(currentTab.filePath)
    )
      return;

    if (!isSourceMode) {
      // WYSIWYG → Source: collapse any active syntax reveal expansion first
      // (SyntaxReveal replaces marks with literal delimiter text, which would
      // cause remark-stringify to escape angle brackets like \<u>)
      forceCollapseSyntaxReveal(editor.view);
      const md = prosemirrorToMarkdown(editor.state.doc);
      const pmPos = editor.state.selection.from;
      const mdOffset = pmPosToMdOffset(editor.state.doc, pmPos, md);

      sourceContentRef.current = md;
      setSourceContent(md);
      setSourceCursorOffset(mdOffset);
      setIsSourceMode(true);
    } else {
      // Source → WYSIWYG
      // Use original markdown unless the user actually edited in Source mode.
      // WebKit injects "<!--  -->" into CodeMirror on focus — getContent()
      // would return corrupted content if the user didn't edit.
      const userEdited = sourceEditorRef.current?.hasUserEdited() ?? false;
      const currentSource = userEdited
        ? (sourceEditorRef.current?.getContent() ?? sourceContentRef.current)
        : sourceContentRef.current;
      const mdOffset = sourceEditorRef.current?.getCursorOffset() ?? 0;

      const newDoc = markdownToProsemirror(currentSource, editor.schema);
      const pmPos = mdOffsetToPmPos(newDoc, mdOffset, currentSource);

      const clampedPos = Math.min(Math.max(pmPos, 0), newDoc.content.size);

      // Update the document immediately so EditorContent renders correct
      // content when it mounts. Use a temporary selection (atStart) because
      // the DOM is detached — ProseMirror's selectionToDOM fails silently
      // with detached DOM, and DOMObserver can overwrite our selection when
      // the DOM re-attaches. The real cursor is set via dispatch in the RAF
      // below, after EditorContent has mounted and DOM is attached.
      const tempState = EditorState.create({
        doc: newDoc,
        plugins: editor.state.plugins,
        selection: TextSelection.atStart(newDoc),
      });
      editor.view.updateState(tempState);

      // Cache state with correct selection for tab-switching safety
      const targetPos = clampedPos;
      if (currentTabId) {
        const sel = TextSelection.near(newDoc.resolve(clampedPos));
        const cachedState = EditorState.create({
          doc: newDoc,
          plugins: editor.state.plugins,
          selection: sel,
        });
        editorStateCache.current.set(currentTabId, cachedState);
      }

      setIsSourceMode(false);

      // Apply cursor AFTER EditorContent mounts (DOM attached).
      // Double RAF: first waits for React render, second for layout.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            const doc = editor.view.state.doc;
            const pos = Math.min(targetPos, doc.content.size);
            const resolvedSel = TextSelection.near(doc.resolve(pos));

            // Suppress DOMObserver during focus+dispatch to prevent it
            // from reading a stale native selection (from the previous
            // EditorState) and overwriting our target cursor position.
            // ProseMirror's view.focus() triggers DOMObserver flush which
            // dispatches a transaction based on native selection — this
            // races with our setSelection dispatch.
            const domObserver = (
              editor.view as { domObserver?: { start(): void; stop(): void } }
            ).domObserver;
            domObserver?.stop();
            try {
              editor.view.dispatch(
                editor.view.state.tr.setSelection(resolvedSel).scrollIntoView(),
              );
              editor.view.focus();
            } finally {
              domObserver?.start();
            }

            // DOM-level scroll fallback for .editor-area-scroll
            const domInfo = editor.view.domAtPos(resolvedSel.from);
            const el =
              domInfo.node instanceof HTMLElement
                ? domInfo.node
                : domInfo.node.parentElement;
            el?.scrollIntoView({ block: "center" });
          } catch {
            // ignore focus errors
          }
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editorStateCache is a stable ref
  }, [editor, isSourceMode]);

  // §56 Journal — auto-create today's journal on startup
  useJournal(handleOpenFilePath);

  // onLaunch — restore folder/file on startup
  const onLaunchDone = useRef(false);
  // Capture latest handleNewFile in a ref so the mount-only effect does not need
  // it as a dep (handleNewFile changes identity when `tabs` changes, which would
  // incorrectly re-run the startup restore logic on every tab mutation).
  const handleNewFileRef = useRef(handleNewFile);
  handleNewFileRef.current = handleNewFile;
  useEffect(() => {
    if (onLaunchDone.current) return;
    onLaunchDone.current = true;

    const { onLaunch, lastOpenedFolder, lastOpenedFile } =
      useSettingsStore.getState();

    (async () => {
      if (onLaunch === "restoreLastFolder" && lastOpenedFolder) {
        try {
          await openFolder(lastOpenedFolder);
          useSettingsStore.getState().addRecentFolder(lastOpenedFolder);
        } catch {
          /* folder may have been deleted */
        }
      } else if (onLaunch === "restoreLastFile" && lastOpenedFolder) {
        try {
          await openFolder(lastOpenedFolder);
          useSettingsStore.getState().addRecentFolder(lastOpenedFolder);
          if (lastOpenedFile) {
            await handleOpenFilePath(lastOpenedFile);
          }
        } catch {
          /* ignore */
        }
      } else if (onLaunch === "newFile") {
        handleNewFileRef.current();
      }
    })();
  }, [handleOpenFilePath]);

  // Listen for file open events from macOS (Finder "Open With" / double-click)
  useEffect(() => {
    // Cold start: check for files queued before frontend was ready
    getOpenedUrls()
      .then((paths) => {
        for (const path of paths) {
          handleOpenFilePath(path);
        }
      })
      .catch(() => {});

    // Hot open: listen for files opened while app is running
    const unlisten = listen<string>("file:open-request", (event) => {
      handleOpenFilePath(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleOpenFilePath]);

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

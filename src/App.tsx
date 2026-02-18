// §4.2 Baram App — 3-Column layout with editor
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import type { ReactNode, ErrorInfo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { createBaramExtensions } from "./extensions";
import { prosemirrorToMarkdown } from "./pipeline/pm-to-md";
import { markdownToProsemirror } from "./pipeline/md-to-pm";
import type { SourceCodeEditorRef } from "./components/editor/SourceCodeEditor";
import type { EditorTab } from "./stores/editor-store";
import { TabSwitcher } from "./components/layout/TabSwitcher";
import { pmPosToMdOffset, mdOffsetToPmPos } from "./utils/cursor-mapper";
import { AppLayout } from "./components/layout/AppLayout";
import { TabBar } from "./components/layout/TabBar";
import { StatusBar } from "./components/layout/StatusBar";
import { FloatingToolbar } from "./components/toolbar/FloatingToolbar";
import { BlockHandle } from "./components/toolbar/BlockHandle";
import { ContextMenu } from "./components/toolbar/ContextMenu";
import { useEditorStore } from "./stores/editor-store";
import { useFileStore, openFolder } from "./stores/file-store";
import { useUIStore } from "./stores/ui-store";
import { useNavigationStore } from "./stores/navigation-store";
import { useAutoSave } from "./hooks/use-auto-save";
import { readFile, writeFile, getOpenedUrls, updateFileIndex } from "./ipc/invoke";
import { useLinkStore } from "./stores/link-store";
import { logAppReady } from "./utils/perf";
import { resolveWikilinkTarget } from "./utils/wikilink-nav";
import { forceCollapseSyntaxReveal } from "./extensions/plugins/syntax-reveal";
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
const WelcomeScreen = lazy(() =>
  import("./components/onboarding/WelcomeScreen").then((m) => ({
    default: m.WelcomeScreen,
  })),
);
const QuickSwitcher = lazy(() =>
  import("./components/command/QuickSwitcher").then((m) => ({
    default: m.QuickSwitcher,
  })),
);

// Error boundary to catch and display runtime errors
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Baram ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: "red", fontFamily: "monospace" }}>
          <h2>Runtime Error</h2>
          <pre>{this.state.error.message}</pre>
          <pre style={{ fontSize: "0.8em", color: "#666" }}>
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [isSourceMode, setIsSourceMode] = useState(false);
  const [sourceContent, setSourceContent] = useState("");
  const [sourceCursorOffset, setSourceCursorOffset] = useState(0);
  const sourceEditorRef = useRef<SourceCodeEditorRef>(null);
  // Ref mirrors sourceContent state — always has the latest value, immune to stale closures
  const sourceContentRef = useRef("");
  const { toggleSidebar, toggleCommandPalette, toggleQuickSwitcher, setSidebarPanel, welcomeOpen } =
    useUIStore();
  const { activeTabId, tabs, openTab, markDirty } = useEditorStore();
  const { openFiles, setFileContent } = useFileStore();

  // §28 Wikilink navigation ref — breaks circular dependency (editor ↔ navigate)
  const navigateRef = useRef<(target: string, heading?: string | null) => void>(() => {});

  // Track previously active tab to save its content on switch
  const prevTabRef = useRef<string | null>(null);
  // §37 Ref-based flag for back/forward navigation (avoids _navigating timing bug)
  const isNavBackForwardRef = useRef(false);
  // §39 Tab switcher state
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false);
  const [tabSwitcherIndex, setTabSwitcherIndex] = useState(0);
  const tabSwitcherMruRef = useRef<EditorTab[]>([]);

  const editor = useEditor({
    extensions: createBaramExtensions({
      onNavigate: (target, heading) => navigateRef.current(target, heading),
    }),
    autofocus: true,
    immediatelyRender: false,
    onCreate: () => logAppReady(),
  });

  // Auto-save hook
  useAutoSave(editor);

  // --- Tab switching: swap editor content when activeTabId changes ---
  useEffect(() => {
    if (!editor) return;

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

    // Save outgoing tab content
    if (prevTabId && prevTabId !== activeTabId) {
      const prevTab = tabs.find((t) => t.id === prevTabId);
      if (prevTab?.filePath) {
        try {
          const md = prosemirrorToMarkdown(editor.state.doc);
          setFileContent(prevTab.filePath, md);
        } catch {
          // ignore serialization errors for outgoing tab
        }
      }
    }

    // Load incoming tab content
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) {
      // No active tab — clear editor
      const emptyDoc = markdownToProsemirror("", editor.schema);
      const newState = EditorState.create({
        doc: emptyDoc,
        plugins: editor.state.plugins,
      });
      editor.view.updateState(newState);
      return;
    }

    const content = activeTab.filePath
      ? openFiles.get(activeTab.filePath)
      : openFiles.get(activeTab.id);

    if (content !== undefined) {
      const newDoc = markdownToProsemirror(content, editor.schema);
      const newState = EditorState.create({
        doc: newDoc,
        plugins: editor.state.plugins,
        selection: TextSelection.atStart(newDoc),
      });
      editor.view.updateState(newState);
    }
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // §29 Scroll to wikilink node after backlink navigation
  useEffect(() => {
    const target = useLinkStore.getState().pendingScrollTarget;
    if (!target || !editor) return;

    // Clear immediately so it only fires once
    useLinkStore.getState().setPendingScrollTarget(null);

    // Wait for editor to render the new doc
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!editor) return;

        // Find the first wikilink node whose target matches
        const targetLower = target.toLowerCase();
        let targetPos: number | null = null;

        editor.state.doc.descendants((node, pos) => {
          if (targetPos !== null) return false;
          if (
            node.type.name === "wikilink" &&
            (node.attrs.target as string).toLowerCase() === targetLower
          ) {
            targetPos = pos;
            return false;
          }
          return true;
        });

        if (targetPos !== null) {
          editor.commands.setTextSelection(targetPos);
          editor.commands.scrollIntoView();
        }
      });
    });
  }, [activeTabId, editor]);

  // --- Window title update ---
  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    document.title = tab
      ? `${tab.isDirty ? "\u25CF " : ""}${tab.title} \u2014 Baram`
      : "Baram";
  }, [activeTabId, tabs]);

  // Stable onChange for SourceCodeEditor — updates both ref and state
  const handleSourceChange = useCallback((content: string) => {
    sourceContentRef.current = content;
    setSourceContent(content);
  }, []);

  // Cmd+/ toggle between WYSIWYG and Source Code mode (§5.1 cursor preservation)
  const toggleSourceMode = useCallback(() => {
    if (!editor) return;

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

      // Replace the ProseMirror state directly (bypasses Tiptap setContent
      // which can conflict with EditorContent mount/unmount lifecycle)
      const clampedPos = Math.min(Math.max(pmPos, 0), newDoc.content.size);
      const newState = EditorState.create({
        doc: newDoc,
        plugins: editor.state.plugins,
        selection: TextSelection.near(newDoc.resolve(clampedPos)),
      });
      editor.view.updateState(newState);

      setIsSourceMode(false);

      // Focus after EditorContent mounts
      requestAnimationFrame(() => {
        try {
          editor.commands.focus();
        } catch {
          // ignore focus errors
        }
      });
    }
  }, [editor, isSourceMode]);

  // --- File action handlers ---
  const handleNewFile = useCallback(() => {
    const id = crypto.randomUUID();
    const tabNumber =
      tabs.filter((t) => t.title.startsWith("Untitled")).length + 1;
    const title = tabNumber === 1 ? "Untitled" : `Untitled ${tabNumber}`;
    useFileStore.getState().setFileContent(id, "");
    openTab({ id, filePath: "", title, isDirty: false });
    // Store content under tab id for untitled files
    const { openFiles: of } = useFileStore.getState();
    if (!of.has(id)) {
      useFileStore.getState().setFileContent(id, "");
    }
  }, [tabs, openTab]);

  const handleOpenFile = useCallback(async () => {
    const selected = await open({
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "mdx"] },
        { name: "Text", extensions: ["txt", "text"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (!selected) return;

    // Check if already open
    const existing = tabs.find((t) => t.filePath === selected);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
      return;
    }

    try {
      const content = await readFile(selected);
      const fileName = selected.split("/").pop() ?? "Unknown";
      setFileContent(selected, content);
      openTab({
        id: crypto.randomUUID(),
        filePath: selected,
        title: fileName,
        isDirty: false,
      });
    } catch (err) {
      console.error("[App] Failed to open file:", err);
    }
  }, [tabs, setFileContent, openTab]);

  const handleSave = useCallback(async () => {
    if (!editor) return;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;

    const md = prosemirrorToMarkdown(editor.state.doc);

    if (activeTab.filePath) {
      // Existing file — save directly
      try {
        await writeFile(activeTab.filePath, md);
        setFileContent(activeTab.filePath, md);
        markDirty(activeTab.id, false);
        updateFileIndex(activeTab.filePath)
          .then(() => useLinkStore.getState().invalidate())
          .catch(() => {});
      } catch (err) {
        console.error("[App] Failed to save:", err);
      }
    } else {
      // Untitled — Save As dialog
      const savePath = await save({
        filters: [
          { name: "Markdown", extensions: ["md"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (!savePath) return;

      try {
        await writeFile(savePath, md);
        updateFileIndex(savePath)
          .then(() => useLinkStore.getState().invalidate())
          .catch(() => {});
        // Update tab with real path
        const fileName = savePath.split("/").pop() ?? "Unknown";
        // Remove old untitled content
        useFileStore.getState().removeFileContent(activeTab.id);
        setFileContent(savePath, md);
        // Update the tab in store
        useEditorStore.setState((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === activeTab.id
              ? { ...t, filePath: savePath, title: fileName, isDirty: false }
              : t,
          ),
        }));
      } catch (err) {
        console.error("[App] Failed to save as:", err);
      }
    }
  }, [editor, tabs, activeTabId, setFileContent, markDirty]);

  const handleOpenFolder = useCallback(async () => {
    const selected = await open({ directory: true });
    if (selected) {
      await openFolder(selected);
    }
  }, []);

  // Open file by path — used by macOS file association (Finder → Baram)
  const handleOpenFilePath = useCallback(async (filePath: string) => {
    const { tabs: currentTabs } = useEditorStore.getState();
    const existing = currentTabs.find((t) => t.filePath === filePath);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
      return;
    }

    try {
      const content = await readFile(filePath);
      const fileName = filePath.split("/").pop() ?? "Unknown";
      useFileStore.getState().setFileContent(filePath, content);
      useEditorStore.getState().openTab({
        id: crypto.randomUUID(),
        filePath,
        title: fileName,
        isDirty: false,
      });
    } catch (err) {
      console.error("[App] Failed to open file from OS:", err);
    }
  }, []);

  // §28 Wikilink Cmd+Click navigation
  const handleWikilinkNavigate = useCallback(
    (target: string, heading?: string | null) => {
      const resolved = resolveWikilinkTarget(target);
      if (!resolved) return;

      // Open the file (reuses existing tab if already open)
      handleOpenFilePath(resolved.path).then(() => {
        if (!heading || !editor) return;

        // Wait for editor state to settle after tab switch
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!editor) return;
            const headingLower = heading.toLowerCase();
            let targetPos: number | null = null;

            editor.state.doc.descendants((node, pos) => {
              if (targetPos !== null) return false;
              if (
                node.type.name === "heading" &&
                node.textContent.toLowerCase() === headingLower
              ) {
                targetPos = pos;
                return false;
              }
              return true;
            });

            if (targetPos !== null) {
              editor.commands.setTextSelection(targetPos + 1);
              editor.commands.scrollIntoView();
            }
          });
        });
      });
    },
    [handleOpenFilePath, editor],
  );

  // Keep navigateRef in sync
  useEffect(() => {
    navigateRef.current = handleWikilinkNavigate;
  }, [handleWikilinkNavigate]);

  // Listen for file open events from macOS (Finder "Open With" / double-click)
  useEffect(() => {
    // Cold start: check for files queued before frontend was ready
    getOpenedUrls().then((paths) => {
      for (const path of paths) {
        handleOpenFilePath(path);
      }
    }).catch(() => {});

    // Hot open: listen for files opened while app is running
    const unlisten = listen<string>("file:open-request", (event) => {
      handleOpenFilePath(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleOpenFilePath]);

  // §37 Navigation back/forward handlers
  const handleGoBack = useCallback(() => {
    const { activeTabId: currentId, tabs: currentTabs } =
      useEditorStore.getState();
    if (!currentId) return;
    const openTabIds = new Set(currentTabs.map((t) => t.id));
    const targetId = useNavigationStore.getState().goBack(currentId, openTabIds);
    if (targetId) {
      isNavBackForwardRef.current = true;
      useEditorStore.getState().setActiveTab(targetId);
    }
  }, []);

  const handleGoForward = useCallback(() => {
    const { activeTabId: currentId, tabs: currentTabs } =
      useEditorStore.getState();
    if (!currentId) return;
    const openTabIds = new Set(currentTabs.map((t) => t.id));
    const targetId = useNavigationStore
      .getState()
      .goForward(currentId, openTabIds);
    if (targetId) {
      isNavBackForwardRef.current = true;
      useEditorStore.getState().setActiveTab(targetId);
    }
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // §39 Escape closes tab switcher without switching
      if (e.key === "Escape" && tabSwitcherOpen) {
        e.preventDefault();
        setTabSwitcherOpen(false);
        return;
      }

      // §39 Ctrl+Tab — MRU tab switcher popup
      if (e.ctrlKey && !e.metaKey && e.key === "Tab") {
        e.preventDefault();
        const { mruOrder, tabs: currentTabs } = useEditorStore.getState();
        if (mruOrder.length <= 1) return;

        if (!tabSwitcherOpen) {
          // Freeze MRU order and open the switcher
          const mruTabs = mruOrder
            .map((id) => currentTabs.find((t) => t.id === id))
            .filter((t): t is EditorTab => t !== undefined);
          if (mruTabs.length <= 1) return;
          tabSwitcherMruRef.current = mruTabs;
          setTabSwitcherIndex(e.shiftKey ? mruTabs.length - 1 : 1);
          setTabSwitcherOpen(true);
        } else {
          // Navigate within the open switcher
          const len = tabSwitcherMruRef.current.length;
          setTabSwitcherIndex((prev) =>
            e.shiftKey ? (prev - 1 + len) % len : (prev + 1) % len,
          );
        }
        return;
      }

      // §37 Ctrl+- — navigate back (macOS: ⌃-, Windows/Linux: Alt+←)
      if (
        (e.ctrlKey && !e.shiftKey && !e.metaKey && (e.key === "-" || e.code === "Minus")) ||
        (!e.metaKey && e.altKey && e.key === "ArrowLeft")
      ) {
        e.preventDefault();
        handleGoBack();
        return;
      }

      // §37 Ctrl+Shift+- — navigate forward (macOS: ⌃⇧-, Windows/Linux: Alt+→)
      // Note: Shift+- produces key="_" on most keyboards, so check both
      if (
        (e.ctrlKey && e.shiftKey && !e.metaKey && (e.key === "_" || e.key === "-" || e.code === "Minus")) ||
        (!e.metaKey && e.altKey && e.key === "ArrowRight")
      ) {
        e.preventDefault();
        handleGoForward();
        return;
      }

      // Cmd+/ — toggle source mode
      if (mod && e.key === "/") {
        e.preventDefault();
        toggleSourceMode();
        return;
      }

      // Cmd+Shift+L — toggle left sidebar
      if (mod && e.shiftKey && e.key === "L") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // §29 Cmd+Shift+B — open backlinks panel
      if (mod && e.shiftKey && e.key === "B") {
        e.preventDefault();
        const ui = useUIStore.getState();
        if (!ui.sidebarOpen) ui.toggleSidebar();
        setSidebarPanel("backlinks");
        return;
      }

      // Cmd+K — command palette
      if (mod && e.key === "k") {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // §35 Cmd+P — quick switcher
      if (mod && e.key === "p") {
        e.preventDefault();
        toggleQuickSwitcher();
        return;
      }

      // Cmd+N — new file
      if (mod && e.key === "n") {
        e.preventDefault();
        handleNewFile();
        return;
      }

      // Cmd+O — open file
      if (mod && e.key === "o") {
        e.preventDefault();
        handleOpenFile();
        return;
      }

      // Cmd+S — save
      if (mod && e.key === "s") {
        e.preventDefault();
        handleSave();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    toggleSourceMode,
    toggleSidebar,
    toggleCommandPalette,
    toggleQuickSwitcher,
    setSidebarPanel,
    handleNewFile,
    handleOpenFile,
    handleSave,
    handleGoBack,
    handleGoForward,
    editor,
    isSourceMode,
    tabSwitcherOpen,
  ]);

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

  // Native menu event listener (Tauri menu bar → frontend dispatch)
  useEffect(() => {
    const unlisten = listen<string>("menu-event", (event) => {
      switch (event.payload) {
        case "file_new":
          handleNewFile();
          break;
        case "file_open":
          handleOpenFile();
          break;
        case "file_open_folder":
          handleOpenFolder();
          break;
        case "file_save":
          handleSave();
          break;
        case "export_html":
          useUIStore.getState().openExportDialog("html");
          break;
        case "export_pdf":
          useUIStore.getState().openExportDialog("pdf");
          break;
        case "view_source":
          toggleSourceMode();
          break;
        case "view_sidebar":
          toggleSidebar();
          break;
        case "view_palette":
        case "go_palette":
          toggleCommandPalette();
          break;
        case "go_back":
          handleGoBack();
          break;
        case "go_forward":
          handleGoForward();
          break;
        case "go_quick_switcher":
          toggleQuickSwitcher();
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [
    handleNewFile,
    handleOpenFile,
    handleOpenFolder,
    handleSave,
    handleGoBack,
    handleGoForward,
    toggleSourceMode,
    toggleSidebar,
    toggleCommandPalette,
    toggleQuickSwitcher,
  ]);

  return (
    <>
      <AppLayout
        editor={editor}
        statusBar={<StatusBar editor={editor} isSourceMode={isSourceMode} />}
      >
        <TabBar />
        <div className="editor-area">
          {welcomeOpen && !activeTabId ? (
            <Suspense fallback={null}>
              <WelcomeScreen
                onNewFile={handleNewFile}
                onOpenFile={handleOpenFile}
                onOpenFolder={handleOpenFolder}
              />
            </Suspense>
          ) : isSourceMode ? (
            <Suspense fallback={null}>
              <SourceCodeEditor
                ref={sourceEditorRef}
                content={sourceContent}
                onChange={handleSourceChange}
                initialCursorOffset={sourceCursorOffset}
              />
            </Suspense>
          ) : (
            <>
              <EditorContent editor={editor} />
              {editor && (
              <>
                <FloatingToolbar editor={editor} />
                <BlockHandle editor={editor} />
                <ContextMenu editor={editor} />
              </>
            )}
            </>
          )}
        </div>
      </AppLayout>
      <Suspense fallback={null}>
        <CommandPalette
          editor={editor}
          onToggleSourceMode={toggleSourceMode}
          onNewFile={handleNewFile}
          onOpenFile={handleOpenFile}
          onSave={handleSave}
          onOpenFolder={handleOpenFolder}
        />
        <ExportDialog editor={editor} />
        <QuickSwitcher editor={editor} onNewFile={handleNewFile} />
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
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default AppWithErrorBoundary;

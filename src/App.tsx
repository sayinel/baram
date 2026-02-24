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
import { openUrl } from "@tauri-apps/plugin-opener";
import { createBaramExtensions } from "./extensions";
import { prosemirrorToMarkdown } from "./pipeline/pm-to-md";
import { markdownToProsemirror } from "./pipeline/md-to-pm";
import type { SourceCodeEditorRef } from "./components/editor/SourceCodeEditor";
import type { EditorTab } from "./stores/editor-store";
import { isFileTab, isGraphTab } from "./stores/editor-store";
import { TabSwitcher } from "./components/layout/TabSwitcher";
import {
  pmPosToMdOffset,
  mdOffsetToPmPos,
  mdLineToPmBlockStart,
} from "./utils/cursor-mapper";
import { AppLayout } from "./components/layout/AppLayout";
import { TabBar } from "./components/layout/TabBar";
import { StatusBar } from "./components/layout/StatusBar";
import { FloatingToolbar } from "./components/toolbar/FloatingToolbar";
import { BlockHandle } from "./components/toolbar/BlockHandle";
import { ContextMenu } from "./components/toolbar/ContextMenu";
import { useEditorStore } from "./stores/editor-store";
import { useFileStore, openFolder } from "./stores/file-store";
import { useUIStore } from "./stores/ui-store";
import { useSettingsStore } from "./stores/settings-store";
import { useNavigationStore } from "./stores/navigation-store";
import { useAutoSave } from "./hooks/use-auto-save";
import { useGhostText } from "./hooks/use-ghost-text";
import { useInlineAI } from "./hooks/use-inline-ai";
import { readFile, writeFile, getOpenedUrls, updateFileIndex } from "./ipc/invoke";
import { useLinkStore } from "./stores/link-store";
import { migrateFromLocalStorage } from "./stores/tauri-storage";
import { useBookmarkStore } from "./stores/bookmark-store";
import { logAppReady } from "./utils/perf";
import { resolveWikilinkTarget } from "./utils/wikilink-nav";
import { findBlockPosById } from "./utils/block-nav";
import { showPrompt } from "./utils/ai-commands";
import { forceCollapseSyntaxReveal } from "./extensions/plugins/syntax-reveal";
import { FindReplaceBar } from "./components/editor/FindReplaceBar";
import { InlineAIPrompt } from "./components/ai/InlineAIPrompt";
import { PromptLintPanel } from "./components/ai/PromptLintPanel";
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
const AIChatPanel = lazy(() =>
  import("./components/ai/AIChatPanel").then((m) => ({
    default: m.AIChatPanel,
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
  const { toggleSidebar, toggleCommandPalette, toggleQuickSwitcher, toggleSettings, setSidebarPanel, welcomeOpen } =
    useUIStore();
  const { activeTabId, tabs, openTab, markDirty } = useEditorStore();
  const { openFiles, setFileContent } = useFileStore();

  // §28 Wikilink navigation ref — breaks circular dependency (editor ↔ navigate)
  const navigateRef = useRef<(target: string, heading?: string | null) => void>(() => {});
  // §30c Block reference navigation ref
  const blockRefNavigateRef = useRef<(target: string, blockId: string) => void>(() => {});
  // §5.1 Local .md link navigation ref (e.g. [text](sub/doc.md))
  const localLinkNavigateRef = useRef<(href: string) => void>(() => {});

  // Track previously active tab to save its content on switch
  const prevTabRef = useRef<string | null>(null);
  // Per-tab EditorState cache — preserves undo/redo history across tab switches
  const editorStateCache = useRef(new Map<string, EditorState>());
  // Per-tab scroll position cache — preserves view position across tab switches
  const scrollTopCache = useRef(new Map<string, number>());
  // §37 Ref-based flag for back/forward navigation (avoids _navigating timing bug)
  const isNavBackForwardRef = useRef(false);
  // §5.6 Find/Replace state
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findReplaceMode, setFindReplaceMode] = useState<"find" | "replace">("find");

  // §39 Tab switcher state
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false);
  const [tabSwitcherIndex, setTabSwitcherIndex] = useState(0);
  const tabSwitcherMruRef = useRef<EditorTab[]>([]);

  const editor = useEditor({
    extensions: createBaramExtensions({
      onNavigate: (target, heading) => navigateRef.current(target, heading),
      onNavigateBlockRef: (target, blockId) => blockRefNavigateRef.current(target, blockId),
      onNavigateLocal: (href) => localLinkNavigateRef.current(href),
    }),
    autofocus: true,
    immediatelyRender: false,
    onCreate: () => logAppReady(),
  });

  // §44 Track editor selection text for @selection reference
  useEffect(() => {
    if (!editor) return;
    const handleSelectionUpdate = () => {
      const { from, to } = editor.state.selection;
      const text = from === to ? "" : editor.state.doc.textBetween(from, to, " ");
      useEditorStore.getState().setCurrentSelection(text);
    };
    editor.on("selectionUpdate", handleSelectionUpdate);
    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor]);

  // Auto-save hook
  useAutoSave(editor);

  // §43 Ghost Text — inline AI completion
  useGhostText(editor);

  // §6.2 Inline AI — Cmd+J editing
  const inlineAI = useInlineAI(editor);

  // §44 Apply AI chat content to editor — with diff preview when selection exists
  useEffect(() => {
    const unsub = useUIStore.subscribe((state) => {
      const content = state.pendingApplyContent;
      if (!content || !editor) return;
      const { from, to } = editor.state.selection;
      if (from !== to) {
        // Selection exists — show diff preview via AI Diff plugin
        inlineAI.applyContent(content);
      } else {
        // No selection — insert at cursor directly
        editor.chain().focus().insertContentAt(from, content).run();
      }
      useUIStore.getState().setPendingApplyContent(null);
    });
    return unsub;
  }, [editor, inlineAI]);

  // §3.2 One-time migration: localStorage → Tauri app_data_dir
  useEffect(() => {
    migrateFromLocalStorage().catch(() => {});
  }, []);

  // Apply settings to DOM
  const { theme, fontSize, fontFamily, lineHeight, spellCheck, editorMaxWidth } = useSettingsStore();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.dataset.theme = theme;
    }
  }, [theme]);

  useEffect(() => {
    const tiptap = document.querySelector<HTMLElement>(".tiptap");
    if (!tiptap) return;
    tiptap.style.fontSize = `${fontSize}px`;
    tiptap.style.fontFamily = fontFamily
      ? `${fontFamily}, var(--font-editor)`
      : "";
    tiptap.style.lineHeight = String(lineHeight);
    tiptap.style.maxWidth = editorMaxWidth > 0 ? `${editorMaxWidth}px` : "";
    tiptap.style.marginLeft = editorMaxWidth > 0 ? "auto" : "";
    tiptap.style.marginRight = editorMaxWidth > 0 ? "auto" : "";
  }, [fontSize, fontFamily, lineHeight, editorMaxWidth, editor]);

  useEffect(() => {
    const tiptap = document.querySelector<HTMLElement>(".tiptap");
    if (tiptap) {
      tiptap.setAttribute("spellcheck", String(spellCheck));
    }
  }, [spellCheck, editor]);

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

    // Save outgoing tab content + cache EditorState (preserves undo history)
    if (prevTabId && prevTabId !== activeTabId) {
      const prevTab = tabs.find((t) => t.id === prevTabId);
      // Save scroll position of .editor-area-scroll for the outgoing tab
      const scrollContainer = document.querySelector(".editor-area-scroll");
      if (scrollContainer) {
        scrollTopCache.current.set(prevTabId, scrollContainer.scrollTop);
      }
      // Only save ProseMirror state for file tabs (graph tabs have no editor state)
      if (isFileTab(prevTab)) {
        // Cache EditorState before switching (keeps undo/redo stack intact)
        if (!isSourceMode) {
          editorStateCache.current.set(prevTabId, editor.state);
        }
        if (prevTab?.filePath) {
          try {
            // In source mode, save from CodeMirror (ProseMirror is stale)
            const md = isSourceMode
              ? sourceContentRef.current
              : prosemirrorToMarkdown(editor.state.doc);
            setFileContent(prevTab.filePath, md);
          } catch {
            // ignore serialization errors for outgoing tab
          }
        }
      }
      // Exit source mode when switching tabs
      if (isSourceMode) {
        setIsSourceMode(false);
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

    // Graph tab — no ProseMirror content to load
    if (isGraphTab(activeTab)) return;

    const content = activeTab.filePath
      ? openFiles.get(activeTab.filePath)
      : openFiles.get(activeTab.id);

    if (content !== undefined) {
      // Try cached EditorState first (preserves undo/redo history)
      const cachedState = editorStateCache.current.get(activeTabId!);
      const cachedScrollTop = scrollTopCache.current.get(activeTabId!);
      if (cachedState) {
        editor.view.updateState(cachedState);
        // Restore exact scroll position (not just cursor visibility)
        if (cachedScrollTop !== undefined) {
          requestAnimationFrame(() => {
            const scrollContainer = document.querySelector(".editor-area-scroll");
            if (scrollContainer) {
              scrollContainer.scrollTop = cachedScrollTop;
            }
          });
        } else {
          editor.commands.scrollIntoView();
        }
      } else {
        // No cache — create fresh state from markdown (first open)
        const newDoc = markdownToProsemirror(content, editor.schema);
        const newState = EditorState.create({
          doc: newDoc,
          plugins: editor.state.plugins,
          selection: TextSelection.atStart(newDoc),
        });
        editor.view.updateState(newState);
      }

      // §29 Check if navigating from backlinks — compute scroll position
      const pendingLine = useLinkStore.getState().pendingScrollLine;
      const pendingBlockId = useLinkStore.getState().pendingScrollBlockId;
      let scrollPos: number | null = null;
      const doc = editor.view.state.doc;
      if (pendingBlockId) {
        useLinkStore.getState().setPendingScrollBlockId(null);
        const blockPos = findBlockPosById(doc, pendingBlockId);
        if (blockPos !== null) {
          scrollPos = Math.min(Math.max(blockPos, 0), doc.content.size);
        }
      } else if (pendingLine) {
        useLinkStore.getState().setPendingScrollLine(null);
        const pmPos = mdLineToPmBlockStart(doc, content, pendingLine);
        scrollPos = Math.min(Math.max(pmPos, 0), doc.content.size);
      }

      // Dispatch a proper transaction for selection + scroll, then
      // use DOM scrollIntoView as fallback for the scroll container
      if (scrollPos !== null) {
        requestAnimationFrame(() => {
          try {
            const resolvedPos = editor.view.state.doc.resolve(scrollPos);
            const tr = editor.view.state.tr
              .setSelection(TextSelection.near(resolvedPos))
              .scrollIntoView();
            editor.view.dispatch(tr);
            editor.view.focus();

            // DOM-level scroll fallback — ensures .editor-area scrolls
            const domInfo = editor.view.domAtPos(scrollPos);
            const el =
              domInfo.node instanceof HTMLElement
                ? domInfo.node
                : domInfo.node.parentElement;
            el?.scrollIntoView({ block: "center" });
          } catch {
            // ignore invalid position
          }
        });
      }

      // Clean up cache for closed tabs
      const openTabIds = new Set(tabs.map((t) => t.id));
      for (const cachedId of editorStateCache.current.keys()) {
        if (!openTabIds.has(cachedId)) {
          editorStateCache.current.delete(cachedId);
          scrollTopCache.current.delete(cachedId);
        }
      }
    }
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Window title update ---
  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    document.title = tab
      ? `${tab.isDirty && isFileTab(tab) ? "\u25CF " : ""}${tab.title} \u2014 Baram`
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
    // Graph tab has no editor content — source mode not applicable
    const currentTab = tabs.find((t) => t.id === activeTabId);
    if (isGraphTab(currentTab)) return;

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

      // Focus and scroll to cursor after EditorContent mounts.
      // Double RAF: first waits for React render, second for layout.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            editor.commands.focus();
            // ProseMirror scrollIntoView + DOM fallback for .editor-area-scroll
            const sel = editor.view.state.selection;
            const tr = editor.view.state.tr.setSelection(sel).scrollIntoView();
            editor.view.dispatch(tr);
            const domInfo = editor.view.domAtPos(sel.from);
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
  }, [editor, isSourceMode, tabs, activeTabId]);

  // --- File action handlers ---
  const handleNewFile = useCallback((name?: string) => {
    const id = crypto.randomUUID();
    let title: string;
    if (name) {
      title = name;
    } else {
      const tabNumber =
        tabs.filter((t) => t.title.startsWith("Untitled")).length + 1;
      title = tabNumber === 1 ? "Untitled" : `Untitled ${tabNumber}`;
    }
    useFileStore.getState().setFileContent(id, "");
    openTab({ id, filePath: "", title, isDirty: false, isPinned: false });
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
        isPinned: false,
      });
    } catch (err) {
      console.error("[App] Failed to open file:", err);
    }
  }, [tabs, setFileContent, openTab]);

  const handleSave = useCallback(async () => {
    if (!editor) return;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;
    if (isGraphTab(activeTab)) return;

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

  const handleSaveAs = useCallback(async () => {
    if (!editor) return;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;
    if (isGraphTab(activeTab)) return;

    const md = prosemirrorToMarkdown(editor.state.doc);
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
      const fileName = savePath.split("/").pop() ?? "Unknown";
      if (!activeTab.filePath) {
        useFileStore.getState().removeFileContent(activeTab.id);
      }
      setFileContent(savePath, md);
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
  }, [editor, tabs, activeTabId, setFileContent]);

  const handleCloseTab = useCallback(() => {
    if (!activeTabId) return;
    useEditorStore.getState().closeTab(activeTabId);
  }, [activeTabId]);

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
        isPinned: false,
      });
    } catch (err) {
      console.error("[App] Failed to open file from OS:", err);
    }
  }, []);

  // §28 Wikilink Cmd+Click navigation
  const handleWikilinkNavigate = useCallback(
    (target: string, heading?: string | null) => {
      const resolved = resolveWikilinkTarget(target);

      // File doesn't exist → create it, refresh tree, then open
      if (!resolved) {
        const { rootPath } = useFileStore.getState();
        if (!rootPath) return;
        const newPath = `${rootPath}/${target}.md`;
        writeFile(newPath, `# ${target}\n`)
          .then(async () => {
            const { refreshIndex, listDir } = await import("./ipc/invoke");
            const { buildFileTree } = await import("./stores/file-store");
            await refreshIndex(rootPath);
            const entries = await listDir(rootPath, true);
            const tree = buildFileTree(entries, rootPath);
            useFileStore.getState().setFileTree(tree);
            await handleOpenFilePath(newPath);
          })
          .catch(console.error);
        return;
      }

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

  // §30c Block reference Cmd+Click navigation
  const handleBlockRefNavigate = useCallback(
    (target: string, blockId: string) => {
      if (!editor) return;

      if (!target) {
        // Same file — find block in current doc and scroll
        const pos = findBlockPosById(editor.state.doc, blockId);
        if (pos !== null) {
          editor.commands.setTextSelection(pos + 1);
          editor.commands.scrollIntoView();
        }
        return;
      }

      // Different file — resolve and open
      const resolved = resolveWikilinkTarget(target);
      if (!resolved) return;

      // Set pending block ID for scroll after tab switch
      useLinkStore.getState().setPendingScrollBlockId(blockId);

      handleOpenFilePath(resolved.path).then(() => {
        // Wait for editor state to settle
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!editor) return;
            const pos = findBlockPosById(editor.state.doc, blockId);
            if (pos !== null) {
              try {
                editor.commands.setTextSelection(pos + 1);
                editor.commands.scrollIntoView();
              } catch {
                // ignore invalid position
              }
            }
            useLinkStore.getState().setPendingScrollBlockId(null);
          });
        });
      });
    },
    [handleOpenFilePath, editor],
  );

  // §5.1 Local .md link Cmd+Click navigation (e.g. [text](sub/doc.md#heading))
  const handleLocalLinkNavigate = useCallback(
    (href: string) => {
      // Same-doc heading link: #heading
      if (href.startsWith("#")) {
        if (!editor) return;
        const headingLower = href.slice(1).replace(/-/g, " ").toLowerCase();
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
        return;
      }

      // Split href into file path and optional heading fragment
      const [filePart, headingFragment] = href.split("#", 2);
      const heading = headingFragment
        ? headingFragment.replace(/-/g, " ")
        : null;

      // Resolve relative path against the current file's directory
      const { activeTabId: currentTabId, tabs: currentTabs } =
        useEditorStore.getState();
      const activeTab = currentTabs.find((t) => t.id === currentTabId);
      if (!activeTab?.filePath) return;

      const currentDir = activeTab.filePath.substring(
        0,
        activeTab.filePath.lastIndexOf("/"),
      );
      // Normalize simple relative path (handles ../ and ./)
      const resolvedPath = `${currentDir}/${filePart}`;

      handleOpenFilePath(resolvedPath).then(() => {
        if (!heading || !editor) return;

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

  // Keep blockRefNavigateRef in sync
  useEffect(() => {
    blockRefNavigateRef.current = handleBlockRefNavigate;
  }, [handleBlockRefNavigate]);

  // Keep localLinkNavigateRef in sync
  useEffect(() => {
    localLinkNavigateRef.current = handleLocalLinkNavigate;
  }, [handleLocalLinkNavigate]);

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

      // §47 Cmd+Shift+T — open skill test dialog
      if (mod && e.shiftKey && e.key === "T") {
        e.preventDefault();
        useUIStore.getState().toggleSkillTestDialog();
        return;
      }

      // §44 Cmd+Shift+A — toggle AI chat panel
      if (mod && e.shiftKey && e.code === "KeyA") {
        e.preventDefault();
        useUIStore.getState().toggleRightPanel();
        return;
      }

      // §5.6 Cmd+F — find
      if (mod && !e.shiftKey && e.key === "f") {
        e.preventDefault();
        setFindReplaceMode("find");
        setFindReplaceOpen(true);
        return;
      }

      // §5.6 Cmd+H — find and replace
      if (mod && !e.shiftKey && e.key === "h") {
        e.preventDefault();
        setFindReplaceMode("replace");
        setFindReplaceOpen(true);
        return;
      }

      // §6.2 Cmd+J — inline AI prompt
      if (mod && !e.shiftKey && e.key === "j") {
        e.preventDefault();
        inlineAI.activate();
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

      // §36 Cmd+D — bookmark current file
      if (mod && e.key === "d") {
        e.preventDefault();
        const bs = useBookmarkStore.getState();
        const es = useEditorStore.getState();
        const fs = useFileStore.getState();
        const activeTab = es.tabs.find((t) => t.id === es.activeTabId);
        if (activeTab?.filePath && fs.rootPath) {
          const fileName = activeTab.filePath.split("/").pop() ?? activeTab.filePath;
          bs.addBookmark({
            type: "file",
            filePath: activeTab.filePath,
            label: fileName,
            group: "Default",
          });
          bs.saveBookmarks(fs.rootPath);
        }
        return;
      }

      // Cmd+K — quick switcher (file list)
      if (mod && e.key === "k") {
        e.preventDefault();
        toggleQuickSwitcher();
        return;
      }

      // Cmd+Shift+P — command palette (alternate)
      if (mod && e.shiftKey && e.key === "P") {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // Cmd+P — command palette
      if (mod && e.key === "p") {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // Cmd+, — settings
      if (mod && e.key === ",") {
        e.preventDefault();
        toggleSettings();
        return;
      }

      // Cmd+W — close tab
      if (mod && e.key === "w") {
        e.preventDefault();
        handleCloseTab();
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

      // Cmd+Shift+S — save as
      if (mod && e.shiftKey && (e.key === "S" || e.key === "s")) {
        e.preventDefault();
        handleSaveAs();
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
    toggleSettings,
    setSidebarPanel,
    handleNewFile,
    handleOpenFile,
    handleSave,
    handleSaveAs,
    handleCloseTab,
    handleGoBack,
    handleGoForward,
    inlineAI,
    editor,
    isSourceMode,
    tabSwitcherOpen,
    findReplaceOpen,
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
    const unlisten = listen<string>("menu-event", async (event) => {
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
        case "file_save_as":
          handleSaveAs();
          break;
        case "file_close_tab":
          handleCloseTab();
          break;
        case "app_about":
          useUIStore.getState().toggleAbout();
          break;
        case "file_settings":
          toggleSettings();
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

        // --- Insert menu handlers ---
        case "insert_h1":
          editor?.chain().focus().toggleHeading({ level: 1 }).run();
          break;
        case "insert_h2":
          editor?.chain().focus().toggleHeading({ level: 2 }).run();
          break;
        case "insert_h3":
          editor?.chain().focus().toggleHeading({ level: 3 }).run();
          break;
        case "insert_paragraph":
          editor?.chain().focus().setNode("paragraph").run();
          break;
        case "insert_bold":
          editor?.chain().focus().toggleBold().run();
          break;
        case "insert_italic":
          editor?.chain().focus().toggleItalic().run();
          break;
        case "insert_underline":
          editor?.chain().focus().toggleUnderline().run();
          break;
        case "insert_strikethrough":
          editor?.chain().focus().toggleStrike().run();
          break;
        case "insert_inline_code":
          editor?.chain().focus().toggleCode().run();
          break;
        case "insert_link": {
          if (!editor) break;
          const { from, to } = editor.state.selection;
          if (from === to) break; // Need selection for link
          showPrompt("Enter URL:").then((url) => {
            if (url) {
              editor.chain().focus().toggleLink({ href: url }).run();
            }
          });
          break;
        }
        case "insert_image": {
          if (!editor) break;
          const imagePath = await open({
            filters: [
              { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"] },
            ],
          });
          if (imagePath) {
            editor.chain().focus().setImage({ src: imagePath }).run();
          }
          break;
        }
        case "insert_table":
          editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          break;
        case "insert_code_block":
          editor?.chain().focus().toggleCodeBlock().run();
          break;
        case "insert_math_block":
          editor?.chain().focus().setMathBlock().run();
          break;
        case "insert_blockquote":
          editor?.chain().focus().toggleBlockquote().run();
          break;
        case "insert_ordered_list":
          editor?.chain().focus().toggleOrderedList().run();
          break;
        case "insert_unordered_list":
          editor?.chain().focus().toggleBulletList().run();
          break;
        case "insert_task_list":
          editor?.chain().focus().toggleTaskList().run();
          break;
        case "insert_hr":
          editor?.chain().focus().setHorizontalRule().run();
          break;
        case "insert_frontmatter":
          editor?.chain().focus().insertContent({ type: "frontmatter", attrs: { yaml: "" } }).run();
          break;

        // --- Help menu handlers ---
        case "help_shortcuts": {
          const { rootPath } = useFileStore.getState();
          if (rootPath) {
            const shortcutsPath = `${rootPath}/docs/keyboard-shortcuts.md`;
            handleOpenFilePath(shortcutsPath).catch(() => {});
          }
          break;
        }
        case "help_report":
          openUrl("https://github.com/anthropics/baram/issues").catch(() => {});
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
    handleSaveAs,
    handleCloseTab,
    handleGoBack,
    handleGoForward,
    handleOpenFilePath,
    toggleSourceMode,
    toggleSidebar,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    editor,
  ]);

  const isGraphTabActive = isGraphTab(tabs.find((t) => t.id === activeTabId));

  return (
    <>
      <AppLayout
        editor={editor}
        statusBar={<StatusBar editor={editor} isSourceMode={isSourceMode} isGraphMode={isGraphTabActive} />}
      >
        <TabBar />
        <div className="editor-area">
          {welcomeOpen && !activeTabId ? (
            <div className="editor-area-scroll">
              <Suspense fallback={null}>
                <WelcomeScreen
                  onNewFile={handleNewFile}
                  onOpenFile={handleOpenFile}
                  onOpenFolder={handleOpenFolder}
                />
              </Suspense>
            </div>
          ) : isGraphTabActive ? (
            <div className="editor-area-scroll">
              <Suspense fallback={null}>
                <GraphViewTab />
              </Suspense>
            </div>
          ) : isSourceMode ? (
            <div className="editor-area-scroll">
              <Suspense fallback={null}>
                <SourceCodeEditor
                  ref={sourceEditorRef}
                  content={sourceContent}
                  onChange={handleSourceChange}
                  initialCursorOffset={sourceCursorOffset}
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
              <div className="editor-area-scroll">
                <EditorContent editor={editor} />
                {editor && (
                  <>
                    <FloatingToolbar editor={editor} />
                    <BlockHandle editor={editor} />
                    <ContextMenu editor={editor} />
                    {inlineAI.isActive && inlineAI.phase !== "idle" && (
                      <InlineAIPrompt
                        editor={editor}
                        selectionFrom={inlineAI.selectionFrom}
                        selectionTo={inlineAI.selectionTo}
                        hasSelection={inlineAI.hasSelection}
                        phase={inlineAI.phase as "input" | "streaming" | "completed"}
                        hunks={inlineAI.hunks}
                        onSubmit={inlineAI.submitPrompt}
                        onAccept={inlineAI.accept}
                        onReject={inlineAI.reject}
                        onRegenerate={inlineAI.regenerate}
                        onAcceptHunk={inlineAI.acceptHunk}
                        onRejectHunk={inlineAI.rejectHunk}
                        onClose={inlineAI.cancel}
                      />
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <PromptLintPanel editor={editor} />
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
        <SettingsModal />
        <AboutModal />
        <AIChatPanel />
        <HoverPreview />
        <SkillGeneratorDialogWrapper />
        <SkillTestDialogWrapper />
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

function SkillGeneratorDialogWrapper() {
  const { skillGeneratorDialogOpen, toggleSkillGeneratorDialog } = useUIStore();
  return (
    <SkillGeneratorDialog
      open={skillGeneratorDialogOpen}
      onClose={toggleSkillGeneratorDialog}
    />
  );
}

function SkillTestDialogWrapper() {
  const { skillTestDialogOpen, toggleSkillTestDialog } = useUIStore();
  return (
    <SkillTestDialog
      open={skillTestDialogOpen}
      onClose={toggleSkillTestDialog}
    />
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

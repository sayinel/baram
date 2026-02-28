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
import { TableToolbar } from "./components/toolbar/TableToolbar";
import { BlockHandle } from "./components/toolbar/BlockHandle";
import { TableInsertButtons } from "./components/toolbar/TableInsertButtons";
import { ContextMenu } from "./components/toolbar/ContextMenu";
import { useEditorStore } from "./stores/editor-store";
import { useFileStore, openFolder } from "./stores/file-store";
import { useUIStore } from "./stores/ui-store";
import { useSettingsStore } from "./stores/settings-store";
import { useNavigationStore } from "./stores/navigation-store";
import { useAutoSave } from "./hooks/use-auto-save";
import { useGhostText } from "./hooks/use-ghost-text";
import { useInlineAI } from "./hooks/use-inline-ai";
import { useFileWatcher } from "./hooks/use-file-watcher";
import { useExternalDrop } from "./hooks/use-external-drop";
import { useJournal } from "./hooks/use-journal";
import { isDateString, getJournalFilePath, resolveJournalDir, generateDefaultJournal, applyJournalTemplate } from "./utils/journal";
import { parseCapturesFromMarkdown, buildNoteFromCapture, buildPromotedCaptureLink } from "./utils/journal-capture";
import { readFile, writeFile, createDir, getOpenedUrls, updateFileIndex } from "./ipc/invoke";
import { useLinkStore } from "./stores/link-store";
import { migrateFromLocalStorage } from "./stores/tauri-storage";
import { useBookmarkStore } from "./stores/bookmark-store";
import { useWorkspaceStore } from "./stores/workspace-store";
import { useAIStore } from "./stores/ai-store";
import { logAppReady } from "./utils/perf";
import { resolveWikilinkTarget } from "./utils/wikilink-nav";
import { findBlockPosById } from "./utils/block-nav";
import { showPrompt } from "./utils/ai-commands";
import { forceCollapseSyntaxReveal } from "./extensions/plugins/syntax-reveal";
import { showTableGridPicker } from "./utils/table-grid-picker";
import { MoodBar } from "./components/journal/MoodBar";
import { FindReplaceBar } from "./components/editor/FindReplaceBar";
import { dispatchSetSearchTerm } from "./extensions/plugins/find-replace";
import { InlineAIPrompt } from "./components/ai/InlineAIPrompt";
import { PromptLintPanel } from "./components/ai/PromptLintPanel";
import { findThemeById } from "./types/theme";
import type { ThemeColors } from "./types/theme";
import { isMarkdownFile, getLanguageForFile } from "./utils/file-type";
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
const QuickCaptureDialog = lazy(() =>
  import("./components/journal/QuickCaptureDialog").then((m) => ({
    default: m.QuickCaptureDialog,
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

  // Derived: non-markdown code file detection for rendering branch
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isCodeFile = !!activeTab && isFileTab(activeTab) && !isMarkdownFile(activeTab.filePath);
  const codeLanguage = activeTab?.filePath ? getLanguageForFile(activeTab.filePath) : null;

  // §28 Wikilink navigation ref — breaks circular dependency (editor ↔ navigate)
  const navigateRef = useRef<(target: string, heading?: string | null) => void>(() => {});
  // §30c Block reference navigation ref
  const blockRefNavigateRef = useRef<(target: string, blockId: string) => void>(() => {});
  // §5.1 Local .md link navigation ref (e.g. [text](sub/doc.md))
  const localLinkNavigateRef = useRef<(href: string) => void>(() => {});
  // §57 Mention navigation ref
  const mentionNavigateRef = useRef<(type: string, value: string) => void>(() => {});

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
      onMentionNavigate: (type, value) => mentionNavigateRef.current(type, value),
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

  // Auto-save hook (markdown files — Tiptap editor.on("update") based)
  useAutoSave(editor);

  // Auto-save for non-MD code files (debounced write when dirty)
  const { autoSave, autoSaveDelay } = useSettingsStore();
  const codeAutoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  }, [isCodeFile, autoSave, autoSaveDelay, sourceContent, markDirty, setFileContent]);

  // File system watcher — auto-refresh FileTree on external changes
  useFileWatcher();

  // External file drag & drop — Tauri OS-level file drop (Feature 1 & 2)
  useExternalDrop({ editor });

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
  const { activeThemeId, customThemes, fontSize, fontFamily, lineHeight, spellCheck, editorMaxWidth } = useSettingsStore();

  useEffect(() => {
    const root = document.documentElement;
    const cssKeys: (keyof ThemeColors)[] = [
      "--color-bg-primary", "--color-bg-secondary", "--color-bg-sidebar", "--color-bg-tertiary",
      "--color-text-primary", "--color-text-secondary", "--color-text-muted",
      "--color-border", "--color-border-light",
      "--color-accent", "--color-accent-hover",
      "--color-editor-bg", "--color-editor-text", "--color-editor-selection",
      "--color-editor-cursor", "--color-editor-line-highlight",
    ];

    // Clear previous CSS variable overrides
    for (const key of cssKeys) {
      root.style.removeProperty(key);
    }

    if (activeThemeId === "system") {
      root.removeAttribute("data-theme");
      return;
    }

    const themeDef = findThemeById(activeThemeId, customThemes);
    if (!themeDef) {
      root.removeAttribute("data-theme");
      return;
    }

    // Set base mode (light/dark) for CSS + CodeMirror/Mermaid
    root.dataset.theme = themeDef.base;

    // For non-default themes, apply CSS variable overrides
    const isDefault = activeThemeId === "default-light" || activeThemeId === "default-dark";
    if (!isDefault) {
      for (const [key, value] of Object.entries(themeDef.colors)) {
        root.style.setProperty(key, value);
      }
    }
  }, [activeThemeId, customThemes]);

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
        const prevIsCode = !isMarkdownFile(prevTab?.filePath);
        // Cache EditorState before switching (keeps undo/redo stack intact)
        // Non-MD files don't use ProseMirror — skip caching
        if (!isSourceMode && !prevIsCode) {
          editorStateCache.current.set(prevTabId, editor.state);
        }
        if (prevTab?.filePath) {
          try {
            const md = prevIsCode || isSourceMode
              ? sourceContentRef.current
              : prosemirrorToMarkdown(editor.state.doc);
            setFileContent(prevTab.filePath, md);
          } catch {
            // ignore serialization errors for outgoing tab
          }
        }
      }
      // Exit source mode when switching tabs (only applies to markdown)
      if (isSourceMode) {
        setIsSourceMode(false);
      }
    }

    // Load incoming tab content
    const incomingTab = tabs.find((t) => t.id === activeTabId);
    if (!incomingTab) {
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
    if (isGraphTab(incomingTab)) return;

    const content = incomingTab.filePath
      ? openFiles.get(incomingTab.filePath)
      : openFiles.get(incomingTab.id);

    if (content !== undefined) {
      // Non-markdown file — load into source editor, skip ProseMirror entirely
      if (!isMarkdownFile(incomingTab.filePath)) {
        sourceContentRef.current = content;
        setSourceContent(content);
        return;
      }

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

  // §5.11 Activate Find highlights from Global Search result click
  const pendingSearchHighlight = useUIStore((s) => s.pendingSearchHighlight);
  useEffect(() => {
    if (!pendingSearchHighlight || !editor?.view) return;
    useUIStore.getState().setPendingSearchHighlight(null);
    // Also consume pending scroll line for same-tab navigation
    const pendingLine = useLinkStore.getState().pendingScrollLine;
    if (pendingLine !== null) {
      useLinkStore.getState().setPendingScrollLine(null);
    }
    // Delay to ensure editor state is settled after tab switch
    requestAnimationFrame(() => {
      if (!editor?.view) return;
      // Scroll to specific line if pending (same-tab search result click)
      if (pendingLine !== null) {
        const { activeTabId: tabId, tabs: currentTabs } = useEditorStore.getState();
        const incomingTab = currentTabs.find((t) => t.id === tabId);
        const content = incomingTab?.filePath
          ? useFileStore.getState().openFiles.get(incomingTab.filePath)
          : useFileStore.getState().openFiles.get(incomingTab?.id ?? "");
        if (content !== undefined) {
          const doc = editor.view.state.doc;
          const pmPos = mdLineToPmBlockStart(doc, content, pendingLine);
          const scrollPos = Math.min(Math.max(pmPos, 0), doc.content.size);
          try {
            const resolvedPos = editor.view.state.doc.resolve(scrollPos);
            const tr = editor.view.state.tr
              .setSelection(TextSelection.near(resolvedPos))
              .scrollIntoView();
            editor.view.dispatch(tr);
            editor.view.focus();
            const domInfo = editor.view.domAtPos(scrollPos);
            const el =
              domInfo.node instanceof HTMLElement
                ? domInfo.node
                : domInfo.node.parentElement;
            el?.scrollIntoView({ block: "center" });
          } catch {
            // ignore invalid position
          }
        }
      }
      dispatchSetSearchTerm(editor.view, pendingSearchHighlight);
      setFindReplaceOpen(true);
      setFindReplaceMode("find");
    });
  }, [pendingSearchHighlight, editor]);

  // §5.11 Reload editor content after Global Search Replace
  const contentReloadVersion = useUIStore((s) => s.contentReloadVersion);
  useEffect(() => {
    if (!contentReloadVersion || !editor?.view) return;
    const { activeTabId: tabId, tabs: currentTabs } = useEditorStore.getState();
    const incomingTab = currentTabs.find((t) => t.id === tabId);
    if (!incomingTab?.filePath) return;
    const content = useFileStore.getState().openFiles.get(incomingTab.filePath);
    if (content === undefined) return;
    // Invalidate stale EditorState caches for replaced files
    editorStateCache.current.clear();
    // Re-parse and update editor from file-store
    const newDoc = markdownToProsemirror(content, editor.schema);
    const newState = EditorState.create({
      doc: newDoc,
      plugins: editor.state.plugins,
    });
    editor.view.updateState(newState);
  }, [contentReloadVersion]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // onChange for non-MD code files — same as source but also marks dirty
  const handleCodeFileChange = useCallback((content: string) => {
    sourceContentRef.current = content;
    setSourceContent(content);
    const { activeTabId: tabId } = useEditorStore.getState();
    if (tabId) markDirty(tabId, true);
  }, [markDirty]);

  // Cmd+/ toggle between WYSIWYG and Source Code mode (§5.1 cursor preservation)
  const toggleSourceMode = useCallback(() => {
    if (!editor) return;
    const currentTab = tabs.find((t) => t.id === activeTabId);
    // Graph tab / non-MD file — source mode not applicable
    if (isGraphTab(currentTab)) return;
    if (currentTab && isFileTab(currentTab) && !isMarkdownFile(currentTab.filePath)) return;

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
    const saveTab = tabs.find((t) => t.id === activeTabId);
    if (!saveTab) return;
    if (isGraphTab(saveTab)) return;

    const isCode = saveTab.filePath && !isMarkdownFile(saveTab.filePath);
    const md = isCode || isSourceMode
      ? sourceContentRef.current
      : prosemirrorToMarkdown(editor.state.doc);

    if (saveTab.filePath) {
      // Existing file — save directly
      try {
        await writeFile(saveTab.filePath, md);
        setFileContent(saveTab.filePath, md);
        markDirty(saveTab.id, false);
        // Only index markdown files (link indexing not relevant for code files)
        if (!isCode) {
          updateFileIndex(saveTab.filePath)
            .then(() => useLinkStore.getState().invalidate())
            .catch(() => {});
        }
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
        if (!isCode) {
          updateFileIndex(savePath)
            .then(() => useLinkStore.getState().invalidate())
            .catch(() => {});
        }
        // Update tab with real path
        const fileName = savePath.split("/").pop() ?? "Unknown";
        // Remove old untitled content
        useFileStore.getState().removeFileContent(saveTab.id);
        setFileContent(savePath, md);
        // Update the tab in store
        useEditorStore.setState((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === saveTab.id
              ? { ...t, filePath: savePath, title: fileName, isDirty: false }
              : t,
          ),
        }));
      } catch (err) {
        console.error("[App] Failed to save as:", err);
      }
    }
  }, [editor, tabs, activeTabId, isSourceMode, setFileContent, markDirty]);

  const handleSaveAs = useCallback(async () => {
    if (!editor) return;
    const saveAsTab = tabs.find((t) => t.id === activeTabId);
    if (!saveAsTab) return;
    if (isGraphTab(saveAsTab)) return;

    const isCode = saveAsTab.filePath && !isMarkdownFile(saveAsTab.filePath);
    const md = isCode || isSourceMode
      ? sourceContentRef.current
      : prosemirrorToMarkdown(editor.state.doc);
    const savePath = await save({
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (!savePath) return;

    try {
      await writeFile(savePath, md);
      if (!isCode) {
        updateFileIndex(savePath)
          .then(() => useLinkStore.getState().invalidate())
          .catch(() => {});
      }
      const fileName = savePath.split("/").pop() ?? "Unknown";
      if (!saveAsTab.filePath) {
        useFileStore.getState().removeFileContent(saveAsTab.id);
      }
      setFileContent(savePath, md);
      useEditorStore.setState((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === saveAsTab.id
            ? { ...t, filePath: savePath, title: fileName, isDirty: false }
            : t,
        ),
      }));
    } catch (err) {
      console.error("[App] Failed to save as:", err);
    }
  }, [editor, tabs, activeTabId, isSourceMode, setFileContent]);

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

  // §56 Journal — auto-create today's journal on startup
  useJournal(handleOpenFilePath);

  // §28 Wikilink Cmd+Click navigation
  const handleWikilinkNavigate = useCallback(
    (target: string, heading?: string | null) => {
      // §56 Date wikilink → open/create journal file
      if (isDateString(target)) {
        const { journalEnabled, journalDirectory, journalFilenameFormat, journalTemplatePath } =
          useSettingsStore.getState();
        if (!journalEnabled) return;
        const { rootPath } = useFileStore.getState();
        const resolvedDir = resolveJournalDir(rootPath, journalDirectory);
        if (!resolvedDir) return;
        const date = new Date(target + "T00:00:00");
        const journalPath = getJournalFilePath(rootPath, journalDirectory, date, journalFilenameFormat);
        if (!journalPath) return;
        (async () => {
          try {
            // Check if file exists
            let exists = true;
            try {
              await readFile(journalPath);
            } catch {
              exists = false;
            }
            if (!exists) {
              const { createDir } = await import("./ipc/invoke");
              await createDir(resolvedDir);
              let content: string;
              if (journalTemplatePath) {
                try {
                  const tpl = await readFile(journalTemplatePath);
                  content = applyJournalTemplate(tpl, date);
                } catch {
                  content = generateDefaultJournal(date);
                }
              } else {
                content = generateDefaultJournal(date);
              }
              await writeFile(journalPath, content);
            }
            await handleOpenFilePath(journalPath);
          } catch (err) {
            console.error("[App] Failed to open journal:", err);
          }
        })();
        return;
      }

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

  // §57 Keep mentionNavigateRef in sync — delegates to wikilink navigate
  useEffect(() => {
    mentionNavigateRef.current = (_type: string, value: string) => {
      handleWikilinkNavigate(value);
    };
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

      // §52 Cmd+Alt+1/2/3 — workspace presets
      if (e.altKey && mod && e.code === "Digit1") {
        e.preventDefault();
        useWorkspaceStore.getState().applyPreset("writing");
        return;
      }
      if (e.altKey && mod && e.code === "Digit2") {
        e.preventDefault();
        useWorkspaceStore.getState().applyPreset("skills");
        return;
      }
      if (e.altKey && mod && e.code === "Digit3") {
        e.preventDefault();
        useWorkspaceStore.getState().applyPreset("research");
        return;
      }
      // §56 Alt+Cmd+4 — journal workspace preset
      if (e.altKey && mod && e.code === "Digit4") {
        e.preventDefault();
        useWorkspaceStore.getState().applyPreset("journal");
        return;
      }

      // §56l Cmd+Shift+N — quick capture dialog
      if (mod && e.shiftKey && e.code === "KeyN") {
        e.preventDefault();
        useUIStore.getState().toggleQuickCapture();
        return;
      }

      // §56l Cmd+Shift+E — promote capture to standalone note
      if (mod && e.shiftKey && e.code === "KeyE") {
        e.preventDefault();
        (async () => {
          try {
            const store = useEditorStore.getState();
            const tab = store.tabs.find((t) => t.id === store.activeTabId);
            if (!tab || !tab.filePath) return;
            const content = useFileStore.getState().openFiles.get(tab.filePath);
            if (!content) return;

            // Parse captures from the current file
            const captures = parseCapturesFromMarkdown(content);
            if (captures.length === 0) return;

            // Use the last capture for promotion (most recent)
            const capture = captures[captures.length - 1];
            const { filename, content: noteContent } = buildNoteFromCapture(capture);

            // Determine notes directory
            const { rootPath } = useFileStore.getState();
            const { journalDirectory } = useSettingsStore.getState();
            if (!rootPath || !journalDirectory) return;
            const resolvedJournalDir = resolveJournalDir(rootPath, journalDirectory);
            if (!resolvedJournalDir) return;
            const notesDir = `${resolvedJournalDir}/notes`;
            const notePath = `${notesDir}/${filename}`;

            // Create notes dir and write note file
            await createDir(notesDir);
            await writeFile(notePath, noteContent);

            // Replace the capture line in journal with a wikilink
            const noteName = filename.replace(/\.md$/, "");
            const linkLine = buildPromotedCaptureLink(capture, noteName);
            const originalLine = content.split("\n").find((line) => {
              const icon = capture.type === "idea" ? "✦" : capture.type === "link" ? "↗" : capture.type === "quote" ? "❝" : "☰";
              return line.startsWith(`- ${icon}`) && (capture.title ? line.includes(capture.title) : true);
            });
            if (originalLine) {
              const updated = content.replace(originalLine, linkLine);
              await writeFile(tab.filePath, updated);
              useFileStore.getState().setFileContent(tab.filePath, updated);
            }

            // Open the promoted note
            useFileStore.getState().setFileContent(notePath, noteContent);
            useEditorStore.getState().openTab({
              id: crypto.randomUUID(),
              filePath: notePath,
              title: filename,
              isDirty: false,
              isPinned: false,
            });
          } catch (err) {
            console.error("[PromoteCapture] Failed:", err);
          }
        })();
        return;
      }

      // §47 Cmd+Shift+T — open skill test dialog
      if (mod && e.shiftKey && e.code === "KeyT") {
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

      // §5.5 Cmd+Enter — add row after in table
      if (mod && e.key === "Enter" && editor && editor.isActive("table")) {
        e.preventDefault();
        editor.chain().focus().addRowAfter().run();
        return;
      }

      // §5.5 Cmd+T — insert table via grid picker (disabled inside tables)
      if (mod && !e.shiftKey && e.key === "t" && editor && !editor.isActive("table")) {
        e.preventDefault();
        const { from } = editor.state.selection;
        const coords = editor.view.coordsAtPos(from);
        showTableGridPicker(coords.left, coords.bottom + 4).then((result) => {
          if (!result) return;
          editor
            .chain()
            .focus()
            .insertTable({ rows: result.rows, cols: result.cols, withHeaderRow: true })
            .run();
        });
        return;
      }

      // Cmd+/ — toggle source mode
      if (mod && e.key === "/") {
        e.preventDefault();
        toggleSourceMode();
        return;
      }

      // Cmd+Shift+L — toggle left sidebar
      if (mod && e.shiftKey && e.code === "KeyL") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // §5.11 Cmd+Shift+F — open global search panel
      if (mod && e.shiftKey && e.code === "KeyF") {
        e.preventDefault();
        const ui = useUIStore.getState();
        if (!ui.sidebarOpen) ui.toggleSidebar();
        setSidebarPanel("search");
        return;
      }

      // §6.2 Cmd+Shift+G — toggle ghost text
      if (mod && e.shiftKey && e.code === "KeyG") {
        e.preventDefault();
        const ai = useAIStore.getState();
        ai.setGhostTextEnabled(!ai.ghostTextEnabled);
        return;
      }

      // §29 Cmd+Shift+B — open backlinks panel
      if (mod && e.shiftKey && e.code === "KeyB") {
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
      if (mod && e.shiftKey && e.code === "KeyP") {
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

      // Cmd+Shift+O — open folder
      if (mod && e.shiftKey && e.code === "KeyO") {
        e.preventDefault();
        handleOpenFolder();
        return;
      }

      // Cmd+O — open file
      if (mod && e.key === "o") {
        e.preventDefault();
        handleOpenFile();
        return;
      }

      // Cmd+Shift+S — save as
      if (mod && e.shiftKey && e.code === "KeyS") {
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
        case "export_doc":
          useUIStore.getState().openExportDialog("html");
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
        case "help_user_guide":
          useUIStore.getState().setRightPanelMode("help");
          if (!useUIStore.getState().rightPanelOpen) {
            useUIStore.getState().toggleRightPanel();
          }
          window.dispatchEvent(new CustomEvent("help-tab", { detail: "guide" }));
          break;
        case "help_shortcuts":
          useUIStore.getState().setRightPanelMode("help");
          if (!useUIStore.getState().rightPanelOpen) {
            useUIStore.getState().toggleRightPanel();
          }
          window.dispatchEvent(new CustomEvent("help-tab", { detail: "shortcuts" }));
          break;
        case "help_faq":
          useUIStore.getState().setRightPanelMode("help");
          if (!useUIStore.getState().rightPanelOpen) {
            useUIStore.getState().toggleRightPanel();
          }
          window.dispatchEvent(new CustomEvent("help-tab", { detail: "faq" }));
          break;
        case "help_report":
          openUrl("https://github.com/anthropics/baram/issues").catch(() => {});
          break;

        // --- Workspace menu handlers (§52) ---
        case "workspace_writing":
          useWorkspaceStore.getState().applyPreset("writing");
          break;
        case "workspace_skills":
          useWorkspaceStore.getState().applyPreset("skills");
          break;
        case "workspace_research":
          useWorkspaceStore.getState().applyPreset("research");
          break;
        case "workspace_journal":
          useWorkspaceStore.getState().applyPreset("journal");
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
          ) : isCodeFile ? (
            <div className="editor-area-scroll">
              <Suspense fallback={null}>
                <SourceCodeEditor
                  key={`code-${activeTabId}`}
                  ref={sourceEditorRef}
                  content={sourceContent}
                  onChange={handleCodeFileChange}
                  language={codeLanguage ?? undefined}
                />
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
              <MoodBar editor={editor} />
              <div className="editor-area-scroll">
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

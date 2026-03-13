// §4.2 Baram App — 3-Column layout with editor
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ErrorInfo, ReactNode } from "react";

import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

import type { SourceCodeEditorRef } from "./components/editor/SourceCodeEditor";
import type { EditorTab } from "./stores/editor-store";
import type { ThemeColors } from "./types/theme";

import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";

import { InlineAIPrompt } from "./components/ai/InlineAIPrompt";
import { PromptLintPanel } from "./components/ai/PromptLintPanel";
import { FindReplaceBar } from "./components/editor/FindReplaceBar";
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
import { dispatchSetSearchTerm } from "./extensions/plugins/find-replace";
import {
  anchorsToPositions,
  dispatchFoldAll,
  dispatchRestoreFolds,
  dispatchUnfoldAll,
  foldPluginKey,
  positionsToAnchors,
  toggleFoldAtCursor,
} from "./extensions/plugins/fold";
import { forceCollapseSyntaxReveal } from "./extensions/plugins/syntax-reveal";
import { useAutoSave } from "./hooks/use-auto-save";
import { useExternalDrop } from "./hooks/use-external-drop";
import { useFileWatcher } from "./hooks/use-file-watcher";
import { useGhostText } from "./hooks/use-ghost-text";
import { useInlineAI } from "./hooks/use-inline-ai";
import { useJournal } from "./hooks/use-journal";
import { useMenuEventHandler } from "./hooks/use-menu-event-handler";
import { useSkillsMode } from "./hooks/use-skills-mode";
import { useZoom } from "./hooks/use-zoom";
import { useTranslation } from "./i18n/useTranslation";
import {
  createDir,
  getOpenedUrls,
  readFile,
  updateFileIndex,
  writeFile,
} from "./ipc/invoke";
import { normalizeKeyEvent } from "./keybindings/key-utils";
import {
  clearActions,
  getAction,
  registerAction,
} from "./keybindings/keybinding-actions";
import { findCommandByKey } from "./keybindings/use-keybindings";
import {
  markdownToProsemirror,
  mdastBlocksToPmNodes,
} from "./pipeline/md-to-pm";
import { parseMdastAsync } from "./pipeline/parse-async";
import { prosemirrorToMarkdown } from "./pipeline/pm-to-md";
import {
  initializePlugins,
  notifyEditorReady,
  notifyFileOpen,
  notifyFileSave,
  shutdownPlugins,
} from "./plugins/plugin-lifecycle";
import { pluginLoader } from "./plugins/plugin-loader";
import {
  startUpdateChecker,
  stopUpdateChecker,
} from "./plugins/update-checker";
import { useAIStore } from "./stores/ai-store";
import { useBookmarkStore } from "./stores/bookmark-store";
import { isFileTab, isGraphTab } from "./stores/editor-store";
import { useEditorStore } from "./stores/editor-store";
import { openFolder, useFileStore } from "./stores/file-store";
import { useFoldStore } from "./stores/fold-store";
import { useLinkStore } from "./stores/link-store";
import { useNavigationStore } from "./stores/navigation-store";
import { useSettingsStore } from "./stores/settings-store";
import { migrateFromLocalStorage } from "./stores/tauri-storage";
import { useUIStore } from "./stores/ui-store";
import { useWorkspaceStore } from "./stores/workspace-store";
import { findThemeById } from "./types/theme";
import { findBlockPosById } from "./utils/block-nav";
import {
  mdLineToPmBlockStart,
  mdOffsetToPmPos,
  pmPosToMdOffset,
} from "./utils/cursor-mapper";
import { getLanguageForFile, isMarkdownFile } from "./utils/file-type";
import {
  applyJournalTemplate,
  generateDefaultJournal,
  getHierarchicalJournalPath,
  getJournalFilePath,
  isDateString,
  resolveJournalDir,
} from "./utils/journal";
import {
  buildNoteFromCapture,
  buildPromotedCaptureLink,
  parseCapturesFromMarkdown,
} from "./utils/journal-capture";
import { logAppReady } from "./utils/perf";
import { showTableGridPicker } from "./utils/table-grid-picker";
import { resolveWikilinkTarget } from "./utils/wikilink-nav";
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
  const { activeTabId, tabs, openTab, markDirty } = useEditorStore();
  const { openFiles, setFileContent } = useFileStore();
  const rootPath = useFileStore((s) => s.rootPath);

  // Derived: non-markdown code file detection for rendering branch
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isCodeFile =
    !!activeTab && isFileTab(activeTab) && !isMarkdownFile(activeTab.filePath);
  const codeLanguage = activeTab?.filePath
    ? getLanguageForFile(activeTab.filePath)
    : null;

  // §28 Wikilink navigation ref — breaks circular dependency (editor ↔ navigate)
  const navigateRef = useRef<(target: string, heading?: null | string) => void>(
    () => {},
  );
  // §30c Block reference navigation ref
  const blockRefNavigateRef = useRef<(target: string, blockId: string) => void>(
    () => {},
  );
  // §5.1 Local .md link navigation ref (e.g. [text](sub/doc.md))
  const localLinkNavigateRef = useRef<(href: string) => void>(() => {});
  // §57 Mention navigation ref
  const mentionNavigateRef = useRef<(type: string, value: string) => void>(
    () => {},
  );

  // Track previously active tab to save its content on switch
  const prevTabRef = useRef<null | string>(null);
  // Per-tab EditorState cache — preserves undo/redo history across tab switches
  const editorStateCache = useRef(new Map<string, EditorState>());
  // Per-tab scroll position cache — preserves view position across tab switches
  const scrollTopCache = useRef(new Map<string, number>());
  // §37 Ref-based flag for back/forward navigation (avoids _navigating timing bug)
  const isNavBackForwardRef = useRef(false);
  // §5.6 Find/Replace state
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findReplaceMode, setFindReplaceMode] = useState<"find" | "replace">(
    "find",
  );
  // §perf-large-file B2/C2: Loading state for async parse + progressive loading
  const [isParsing, setIsParsing] = useState(false);
  const progressiveLoadRef = useRef<{ cancelled: boolean }>({
    cancelled: false,
  });

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
      console.error("[App] Plugin initialization failed:", err),
    );
    startUpdateChecker();
    return () => {
      stopUpdateChecker();
      shutdownPlugins().catch(console.error);
    };
  }, []);

  // §69 Plugin system — provide editor instance to plugin loader
  useEffect(() => {
    if (editor) pluginLoader.setEditor(editor);
  }, [editor]);

  // §44 Track editor selection text for @selection reference
  useEffect(() => {
    if (!editor) return;
    const handleSelectionUpdate = () => {
      const { from, to } = editor.state.selection;
      const text =
        from === to ? "" : editor.state.doc.textBetween(from, to, " ");
      useEditorStore.getState().setCurrentSelection(text);
    };
    editor.on("selectionUpdate", handleSelectionUpdate);
    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor]);

  // §72 Skills mode — auto-detect skill files and switch right panel
  const { isSkill } = useSkillsMode();

  // Auto-save hook (markdown files — Tiptap editor.on("update") based)
  useAutoSave(editor);

  // Auto-save for non-MD code files (debounced write when dirty)
  const { autoSave, autoSaveDelay } = useSettingsStore();
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
  const {
    activeThemeId,
    customThemes,
    fontSize,
    fontFamily,
    lineHeight,
    spellCheck,
    editorMaxWidth,
  } = useSettingsStore();

  useEffect(() => {
    const root = document.documentElement;
    const cssKeys: (keyof ThemeColors)[] = [
      "--color-bg-primary",
      "--color-bg-secondary",
      "--color-bg-sidebar",
      "--color-bg-tertiary",
      "--color-text-primary",
      "--color-text-secondary",
      "--color-text-muted",
      "--color-border",
      "--color-border-light",
      "--color-accent",
      "--color-accent-hover",
      "--color-editor-bg",
      "--color-editor-text",
      "--color-editor-selection",
      "--color-editor-cursor",
      "--color-editor-line-highlight",
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
    const isDefault =
      activeThemeId === "default-light" || activeThemeId === "default-dark";
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
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          ...((editor.options.editorProps?.attributes as Record<
            string,
            string
          >) ?? {}),
          spellcheck: String(spellCheck),
        },
      },
    });
  }, [spellCheck, editor]);

  // Sync OS menu labels when locale changes (and on mount)
  const locale = useSettingsStore((s) => s.locale);
  useEffect(() => {
    import("./ipc/menu-locale").then(({ syncMenuLocale }) => {
      syncMenuLocale(locale as "en" | "ko").catch(console.error);
    });
  }, [locale]);

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
          // Save fold state as content-based anchors
          if (prevTab?.filePath) {
            const pluginState = foldPluginKey.getState(editor.state);
            if (pluginState && pluginState.foldedPositions.size > 0) {
              const anchors = positionsToAnchors(
                editor.state.doc,
                pluginState.foldedPositions,
              );
              useFoldStore.getState().saveFolds(prevTab.filePath, anchors);
            } else if (prevTab?.filePath) {
              useFoldStore.getState().clearFolds(prevTab.filePath);
            }
          }
        }
        if (prevTab?.filePath) {
          try {
            const md =
              prevIsCode || isSourceMode
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

      // §perf-large-file B1: Post-load handler (scroll + search highlight)
      const afterDocLoad = () => {
        // §29 Check if navigating from backlinks — compute scroll position
        const pendingLine = useLinkStore.getState().pendingScrollLine;
        const pendingBlockId = useLinkStore.getState().pendingScrollBlockId;
        let scrollPos: null | number = null;
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

        // §5.11 Handle pending search highlight after document load
        const pendingHighlight = useUIStore.getState().pendingSearchHighlight;
        if (pendingHighlight) {
          useUIStore.getState().setPendingSearchHighlight(null);
          setTimeout(() => {
            if (!editor?.view) return;
            dispatchSetSearchTerm(editor.view, pendingHighlight);
            setFindReplaceOpen(true);
            setFindReplaceMode("find");
          }, 50);
        }
      };

      // Try cached EditorState first (preserves undo/redo history)
      const cachedState = editorStateCache.current.get(activeTabId!);
      const cachedScrollTop = scrollTopCache.current.get(activeTabId!);
      if (cachedState) {
        editor.view.updateState(cachedState);
        // Restore exact scroll position (not just cursor visibility)
        if (cachedScrollTop !== undefined) {
          requestAnimationFrame(() => {
            const scrollContainer = document.querySelector(
              ".editor-area-scroll",
            );
            if (scrollContainer) {
              scrollContainer.scrollTop = cachedScrollTop;
            }
          });
        } else {
          // No cached scroll — reset to top (avoid stale scroll from previous tab)
          requestAnimationFrame(() => {
            const sc = document.querySelector(".editor-area-scroll");
            if (sc) sc.scrollTop = 0;
          });
        }
        afterDocLoad();
      } else {
        // §perf-large-file B1: Parse in Worker, load full doc at once
        // Rendering perf is handled by content-visibility: auto (C1)
        progressiveLoadRef.current.cancelled = true;
        const loadToken = { cancelled: false };
        progressiveLoadRef.current = loadToken;
        setIsParsing(true);

        parseMdastAsync(content).then((mdast) => {
          if (loadToken.cancelled) return;
          if (useEditorStore.getState().activeTabId !== activeTabId) return;

          const allNodes = mdastBlocksToPmNodes(mdast, editor.schema);
          const doc = editor.schema.nodes.doc.create(null, allNodes);
          const newState = EditorState.create({
            doc,
            plugins: editor.state.plugins,
            selection: TextSelection.atStart(doc),
          });
          editor.view.updateState(newState);
          setIsParsing(false);
          // Reset scroll to top for freshly opened documents
          requestAnimationFrame(() => {
            const scrollContainer = document.querySelector(
              ".editor-area-scroll",
            );
            if (scrollContainer) {
              scrollContainer.scrollTop = 0;
            }
          });
          afterDocLoad();

          // Restore fold state from persistence
          const inTab = tabs.find((t) => t.id === activeTabId);
          if (inTab?.filePath) {
            const savedAnchors = useFoldStore
              .getState()
              .getFolds(inTab.filePath);
            if (savedAnchors.length > 0) {
              const positions = anchorsToPositions(doc, savedAnchors);
              if (positions.length > 0) {
                dispatchRestoreFolds(editor.view, positions);
              }
            }
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

  // §5.11 Activate Find highlights from Global Search result click (same-tab case)
  const pendingSearchHighlight = useUIStore((s) => s.pendingSearchHighlight);
  useEffect(() => {
    if (!pendingSearchHighlight || !editor?.view) return;
    // If already consumed by activeTabId effect (tab-switch case), skip
    if (!useUIStore.getState().pendingSearchHighlight) return;
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
        const { activeTabId: tabId, tabs: currentTabs } =
          useEditorStore.getState();
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

  // §5.11 Reload editor content after Global Search Replace / Quick Capture
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
    const cursorEnd = useUIStore.getState().contentReloadCursorEnd;
    // Re-parse and update editor from file-store
    const newDoc = markdownToProsemirror(content, editor.schema);
    const prevPos = editor.state.selection.anchor;
    const selPos = cursorEnd
      ? newDoc.content.size
      : Math.min(prevPos, newDoc.content.size);
    const newState = EditorState.create({
      doc: newDoc,
      selection: TextSelection.near(newDoc.resolve(selPos), -1),
      plugins: editor.state.plugins,
    });
    editor.view.updateState(newState);
    // Focus and scroll to new cursor position after dialog closes.
    // Use DOM scrollIntoView (not ProseMirror tr.scrollIntoView) because
    // updateState bypasses the normal transaction pipeline.
    setTimeout(() => {
      try {
        editor.view.focus();
        const { from } = editor.view.state.selection;
        const domInfo = editor.view.domAtPos(from);
        const el =
          domInfo.node instanceof HTMLElement
            ? domInfo.node
            : domInfo.node.parentElement;
        el?.scrollIntoView({ block: "center" });
      } catch {
        /* ignore */
      }
    }, 50);
  }, [contentReloadVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // §72 External content refresh (PropertiesPanel → editor sync)
  const contentRefreshKey = useEditorStore((s) => s.contentRefreshKey);
  useEffect(() => {
    if (!contentRefreshKey || !editor?.view) return;
    const { activeTabId: tabId, tabs: currentTabs } = useEditorStore.getState();
    const tab = currentTabs.find((t) => t.id === tabId);
    if (!tab?.filePath) return;
    const content = useFileStore.getState().openFiles.get(tab.filePath);
    if (content === undefined) return;
    const newDoc = markdownToProsemirror(content, editor.schema);
    const prevPos = editor.state.selection.anchor;
    const selPos = Math.min(prevPos, newDoc.content.size);
    const newState = EditorState.create({
      doc: newDoc,
      selection: TextSelection.near(newDoc.resolve(selPos), -1),
      plugins: editor.state.plugins,
    });
    editor.view.updateState(newState);
  }, [contentRefreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // §72c Navigate to ProseMirror position from lint results / external panels
  useEffect(() => {
    const handler = (e: CustomEvent<{ from: number }>) => {
      if (!editor) return;
      editor.commands.setTextSelection(e.detail.from);
      editor.commands.scrollIntoView();
      editor.commands.focus();
    };
    window.addEventListener("baram:goto-position", handler as EventListener);
    return () =>
      window.removeEventListener(
        "baram:goto-position",
        handler as EventListener,
      );
  }, [editor]);

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
    const currentTab = tabs.find((t) => t.id === activeTabId);
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
      if (activeTabId) {
        const sel = TextSelection.near(newDoc.resolve(clampedPos));
        const cachedState = EditorState.create({
          doc: newDoc,
          plugins: editor.state.plugins,
          selection: sel,
        });
        editorStateCache.current.set(activeTabId, cachedState);
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
  }, [editor, isSourceMode, tabs, activeTabId]);

  // --- File action handlers ---
  const handleNewFile = useCallback(
    (name?: string) => {
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
    },
    [tabs, openTab],
  );

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
    const md =
      isCode || isSourceMode
        ? sourceContentRef.current
        : prosemirrorToMarkdown(editor.state.doc);

    if (saveTab.filePath) {
      // Existing file — save directly
      try {
        await writeFile(saveTab.filePath, md);
        setFileContent(saveTab.filePath, md);
        markDirty(saveTab.id, false);
        notifyFileSave(saveTab.filePath);
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
    const md =
      isCode || isSourceMode
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
      useSettingsStore.getState().addRecentFolder(selected);
    }
  }, []);

  const handleOpenRecentFolder = useCallback(async (path: string) => {
    await openFolder(path);
    useSettingsStore.getState().addRecentFolder(path);
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
      notifyFileOpen(filePath);
      useSettingsStore.getState().addRecentFile(filePath);
      useSettingsStore.getState().setLastOpenedFile(filePath);
    } catch (err) {
      console.error("[App] Failed to open file from OS:", err);
    }
  }, []);

  const handleOpenRecentFile = useCallback(
    async (path: string) => {
      await handleOpenFilePath(path);
    },
    [handleOpenFilePath],
  );

  const handleCloseFolder = useCallback(() => {
    useFileStore.getState().closeFolder();
  }, []);

  // §56 Journal — auto-create today's journal on startup
  useJournal(handleOpenFilePath);

  // onLaunch — restore folder/file on startup
  const onLaunchDone = useRef(false);
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
        handleNewFile();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // §28 Wikilink Cmd+Click navigation
  const handleWikilinkNavigate = useCallback(
    (target: string, heading?: null | string) => {
      // §56 Date wikilink → open/create journal file
      if (isDateString(target)) {
        const {
          journalEnabled,
          journalDirectory,
          journalFilenameFormat,
          journalTemplatePath,
          journalUseHierarchy,
        } = useSettingsStore.getState();
        if (!journalEnabled) return;
        const { rootPath } = useFileStore.getState();
        const resolvedDir = resolveJournalDir(rootPath, journalDirectory);
        if (!resolvedDir) return;
        const date = new Date(target + "T00:00:00");
        const journalPath = journalUseHierarchy
          ? getHierarchicalJournalPath(resolvedDir, date, journalFilenameFormat)
          : getJournalFilePath(
              rootPath,
              journalDirectory,
              date,
              journalFilenameFormat,
            );
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
              const parentDir = journalPath.substring(
                0,
                journalPath.lastIndexOf("/"),
              );
              await createDir(parentDir);
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
        const { rootPath, isJournalScoped } = useFileStore.getState();
        if (!rootPath) return;

        // §56l Journal scope: create new notes in {journalDir}/notes/
        let newPath: string;
        if (isJournalScoped) {
          const { journalDirectory } = useSettingsStore.getState();
          const journalDir = resolveJournalDir(rootPath, journalDirectory);
          if (journalDir) {
            newPath = `${journalDir}/notes/${target}.md`;
          } else {
            newPath = `${rootPath}/${target}.md`;
          }
        } else {
          newPath = `${rootPath}/${target}.md`;
        }

        (async () => {
          try {
            // Ensure parent directory exists
            const parentDir = newPath.substring(0, newPath.lastIndexOf("/"));
            const { createDir } = await import("./ipc/invoke");
            await createDir(parentDir).catch(() => {});

            await writeFile(newPath, `# ${target}\n`);
            const { refreshIndex, listDir } = await import("./ipc/invoke");
            const { buildFileTree } = await import("./stores/file-store");
            await refreshIndex(rootPath);
            const entries = await listDir(rootPath, true);
            const tree = buildFileTree(entries, rootPath);
            useFileStore.getState().setFileTree(tree);
            await handleOpenFilePath(newPath);
          } catch (err) {
            console.error("[App] Failed to create wikilink target:", err);
          }
        })();
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
            let targetPos: null | number = null;

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
        let targetPos: null | number = null;
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
            let targetPos: null | number = null;
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

  // §72 참조 링크 네비게이션 — Cmd+click on file paths in Skills files
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string }>).detail;
      if (!detail?.path) return;
      const filePath = detail.path;

      // Resolve relative paths against current file's directory or rootPath
      const resolveAbsolute = (p: string): null | string => {
        if (p.startsWith("/")) return p;
        const { activeTabId: curTabId, tabs: curTabs } =
          useEditorStore.getState();
        const curTab = curTabs.find((t) => t.id === curTabId);
        if (curTab?.filePath) {
          const curDir = curTab.filePath.substring(
            0,
            curTab.filePath.lastIndexOf("/"),
          );
          return `${curDir}/${p}`;
        }
        const { rootPath } = useFileStore.getState();
        if (rootPath) return `${rootPath}/${p}`;
        return null;
      };

      const resolved = resolveAbsolute(filePath);
      if (resolved) handleOpenFilePath(resolved);
    };
    window.addEventListener("baram:open-filepath", handler);
    return () => window.removeEventListener("baram:open-filepath", handler);
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

  // §37 Navigation back/forward handlers
  const handleGoBack = useCallback(() => {
    const { activeTabId: currentId, tabs: currentTabs } =
      useEditorStore.getState();
    if (!currentId) return;
    const openTabIds = new Set(currentTabs.map((t) => t.id));
    const targetId = useNavigationStore
      .getState()
      .goBack(currentId, openTabIds);
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

  // §settings: Register keybinding actions — maps command IDs to handler functions
  useEffect(() => {
    clearActions();

    // File
    registerAction("file.new", () => handleNewFile());
    registerAction("file.open", () => handleOpenFile());
    registerAction("file.openFolder", () => handleOpenFolder());
    registerAction("file.save", () => handleSave());
    registerAction("file.saveAs", () => handleSaveAs());
    registerAction("file.closeTab", () => handleCloseTab());
    registerAction("file.closeFolder", () => handleCloseFolder());

    // Edit
    registerAction("edit.find", () => {
      setFindReplaceMode("find");
      setFindReplaceOpen(true);
    });
    registerAction("edit.findReplace", () => {
      setFindReplaceMode("replace");
      setFindReplaceOpen(true);
    });
    registerAction("edit.toggleFold", () => {
      if (editor?.view) toggleFoldAtCursor(editor.view);
    });
    registerAction("edit.foldAll", () => {
      if (editor?.view) dispatchFoldAll(editor.view);
    });
    registerAction("edit.unfoldAll", () => {
      if (editor?.view) dispatchUnfoldAll(editor.view);
    });

    // View
    registerAction("view.sourceMode", () => toggleSourceMode());
    registerAction("view.toggleSidebar", () => toggleSidebar());
    registerAction("view.commandPalette", () => toggleCommandPalette());
    registerAction("view.quickSwitcher", () => toggleQuickSwitcher());
    registerAction("view.settings", () => toggleSettings());
    registerAction("view.bookmark", () => {
      const bs = useBookmarkStore.getState();
      const es = useEditorStore.getState();
      const fs = useFileStore.getState();
      const activeTab = es.tabs.find((t) => t.id === es.activeTabId);
      if (activeTab?.filePath && fs.rootPath) {
        const fileName =
          activeTab.filePath.split("/").pop() ?? activeTab.filePath;
        bs.addBookmark({
          type: "file",
          filePath: activeTab.filePath,
          label: fileName,
          group: "Default",
        });
        bs.saveBookmarks(fs.rootPath);
      }
    });

    // Search
    registerAction("search.globalSearch", () => {
      const ui = useUIStore.getState();
      if (!ui.sidebarOpen) ui.toggleSidebar();
      setSidebarPanel("search");
    });
    registerAction("search.backlinks", () => {
      const ui = useUIStore.getState();
      if (!ui.sidebarOpen) ui.toggleSidebar();
      setSidebarPanel("backlinks");
    });

    // Insert
    registerAction("insert.table", () => {
      if (editor && !editor.isActive("table")) {
        const { from } = editor.state.selection;
        const coords = editor.view.coordsAtPos(from);
        showTableGridPicker(coords.left, coords.bottom + 4).then((result) => {
          if (!result) return;
          editor
            .chain()
            .focus()
            .insertTable({
              rows: result.rows,
              cols: result.cols,
              withHeaderRow: true,
            })
            .run();
        });
      }
    });
    registerAction("insert.inlineAI", () => inlineAI.activate());

    // AI
    registerAction("ai.chatPanel", () =>
      useUIStore.getState().toggleRightPanel(),
    );
    registerAction("ai.ghostText", () => {
      const ai = useAIStore.getState();
      ai.setGhostTextEnabled(!ai.ghostTextEnabled);
    });
    registerAction("ai.skillTest", () =>
      useUIStore.getState().toggleSkillTestDialog(),
    );

    // Workspace
    registerAction("workspace.writing", () =>
      useWorkspaceStore.getState().applyPreset("writing"),
    );
    registerAction("workspace.journal", () =>
      useWorkspaceStore.getState().applyPreset("journal"),
    );

    // Journal
    registerAction("journal.quickCapture", () =>
      useUIStore.getState().toggleQuickCapture(),
    );

    registerAction("journal.promoteCapture", () => {
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

          // Find the capture at cursor position (fall back to last capture)
          let capture = captures[captures.length - 1];
          if (editor) {
            const cursorPos = editor.state.selection.from;
            const md = prosemirrorToMarkdown(editor.state.doc);
            const lines = md.split("\n");
            // Map PM cursor to markdown line
            let charCount = 0;
            let cursorLine = 0;
            for (let li = 0; li < lines.length; li++) {
              charCount += lines[li].length + 1;
              if (charCount >= cursorPos) {
                cursorLine = li;
                break;
              }
            }
            const cursorLineText = lines[cursorLine] ?? "";
            // Match cursor line against capture icons
            const iconMap: Record<string, string> = {
              idea: "✦",
              link: "↗",
              quote: "❝",
              note: "☰",
            };
            for (const c of captures) {
              const icon = iconMap[c.type];
              if (
                cursorLineText.startsWith(`- ${icon}`) &&
                (c.title ? cursorLineText.includes(c.title) : true)
              ) {
                capture = c;
                break;
              }
            }
          }
          const { filename, content: noteContent } =
            buildNoteFromCapture(capture);

          // Determine notes directory
          const { rootPath } = useFileStore.getState();
          const { journalDirectory } = useSettingsStore.getState();
          if (!rootPath || !journalDirectory) return;
          const resolvedJournalDir = resolveJournalDir(
            rootPath,
            journalDirectory,
          );
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
            const icon =
              capture.type === "idea"
                ? "✦"
                : capture.type === "link"
                  ? "↗"
                  : capture.type === "quote"
                    ? "❝"
                    : "☰";
            return (
              line.startsWith(`- ${icon}`) &&
              (capture.title ? line.includes(capture.title) : true)
            );
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
    });

    registerAction("journal.openToday", () => {
      (async () => {
        try {
          const {
            journalEnabled,
            journalDirectory,
            journalFilenameFormat,
            journalTemplatePath,
            journalUseHierarchy,
          } = useSettingsStore.getState();
          if (!journalEnabled || !journalDirectory) return;
          const { rootPath } = useFileStore.getState();
          const resolved = resolveJournalDir(rootPath, journalDirectory);
          if (!resolved) return;
          const today = new Date();
          const journalPath = journalUseHierarchy
            ? getHierarchicalJournalPath(resolved, today, journalFilenameFormat)
            : getJournalFilePath(
                rootPath,
                journalDirectory,
                today,
                journalFilenameFormat,
              );
          if (!journalPath) return;

          // Ensure file exists
          let fileContent: string;
          try {
            fileContent = await readFile(journalPath);
          } catch {
            const parentDir = journalPath.substring(
              0,
              journalPath.lastIndexOf("/"),
            );
            await createDir(parentDir);
            if (journalTemplatePath) {
              try {
                const tpl = await readFile(journalTemplatePath);
                fileContent = applyJournalTemplate(tpl, today);
              } catch {
                fileContent = generateDefaultJournal(today);
              }
            } else {
              fileContent = generateDefaultJournal(today);
            }
            await writeFile(journalPath, fileContent);
          }

          // Open the file
          const edStore = useEditorStore.getState();
          const existing = edStore.tabs.find((t) => t.filePath === journalPath);
          if (existing) {
            edStore.setActiveTab(existing.id);
          } else {
            useFileStore.getState().setFileContent(journalPath, fileContent);
            edStore.openTab({
              id: crypto.randomUUID(),
              filePath: journalPath,
              title: journalPath.split("/").pop() ?? "Journal",
              isDirty: false,
              isPinned: false,
            });
          }
        } catch (err) {
          console.error("[JournalShortcut] Failed:", err);
        }
      })();
    });

    registerAction("journal.jumpToDiary", () => {
      if (editor) {
        const md = prosemirrorToMarkdown(editor.state.doc);
        const lines = md.split("\n");
        const diaryIdx = lines.findIndex((l) => /^## Diary/.test(l));
        if (diaryIdx >= 0) {
          const pos = mdLineToPmBlockStart(editor.state.doc, md, diaryIdx);
          if (pos >= 0) {
            editor.commands.focus();
            editor.commands.setTextSelection(pos + 1);
          }
        }
      }
    });

    registerAction("journal.jumpToCaptures", () => {
      if (editor) {
        const md = prosemirrorToMarkdown(editor.state.doc);
        const lines = md.split("\n");
        const capturesIdx = lines.findIndex((l) => /^## Captures/.test(l));
        if (capturesIdx >= 0) {
          const pos = mdLineToPmBlockStart(editor.state.doc, md, capturesIdx);
          if (pos >= 0) {
            editor.commands.focus();
            editor.commands.setTextSelection(pos + 1);
          }
        }
      }
    });

    registerAction("journal.memories", () => {
      const ui = useUIStore.getState();
      if (!ui.rightPanelOpen) {
        ui.setRightPanelMode("memories");
        ui.toggleRightPanel();
      } else if (ui.rightPanelMode === "memories") {
        ui.toggleRightPanel();
      } else {
        ui.setRightPanelMode("memories");
      }
    });

    registerAction("journal.photoGallery", () => {
      const ui = useUIStore.getState();
      if (ui.rightPanelMode === "photo-gallery" && ui.rightPanelOpen) {
        ui.toggleRightPanel();
      } else {
        ui.setRightPanelMode("photo-gallery");
        if (!ui.rightPanelOpen) ui.toggleRightPanel();
      }
    });
  }, [
    toggleSourceMode,
    toggleSidebar,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    setSidebarPanel,
    handleNewFile,
    handleOpenFile,
    handleOpenFolder,
    handleSave,
    handleSaveAs,
    handleCloseTab,
    handleCloseFolder,
    inlineAI,
    editor,
  ]);

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
        (e.ctrlKey &&
          !e.shiftKey &&
          !e.metaKey &&
          (e.key === "-" || e.code === "Minus")) ||
        (!e.metaKey && e.altKey && e.key === "ArrowLeft")
      ) {
        e.preventDefault();
        handleGoBack();
        return;
      }

      // §37 Ctrl+Shift+- — navigate forward (macOS: ⌃⇧-, Windows/Linux: Alt+→)
      // Note: Shift+- produces key="_" on most keyboards, so check both
      if (
        (e.ctrlKey &&
          e.shiftKey &&
          !e.metaKey &&
          (e.key === "_" || e.key === "-" || e.code === "Minus")) ||
        (!e.metaKey && e.altKey && e.key === "ArrowRight")
      ) {
        e.preventDefault();
        handleGoForward();
        return;
      }

      // §56b Alt+Left / Alt+Right — previous/next day journal
      if (
        e.altKey &&
        !mod &&
        !e.shiftKey &&
        (e.code === "ArrowLeft" || e.code === "ArrowRight")
      ) {
        const {
          journalEnabled,
          journalDirectory,
          journalFilenameFormat,
          journalTemplatePath,
          journalUseHierarchy,
        } = useSettingsStore.getState();
        const es = useEditorStore.getState();
        const activeTab = es.tabs.find((t) => t.id === es.activeTabId);
        const basename =
          activeTab?.filePath?.split("/").pop()?.replace(/\.md$/, "") ?? "";
        if (
          journalEnabled &&
          journalDirectory &&
          activeTab?.filePath &&
          isDateString(basename)
        ) {
          e.preventDefault();
          const [y, m, d] = basename.split("-").map(Number);
          const target = new Date(y, m - 1, d);
          const delta = e.code === "ArrowLeft" ? -1 : 1;
          target.setDate(target.getDate() + delta);

          (async () => {
            try {
              const { rootPath } = useFileStore.getState();
              const resolved = resolveJournalDir(rootPath, journalDirectory);
              if (!resolved) return;
              const journalPath = journalUseHierarchy
                ? getHierarchicalJournalPath(
                    resolved,
                    target,
                    journalFilenameFormat,
                  )
                : getJournalFilePath(
                    rootPath,
                    journalDirectory,
                    target,
                    journalFilenameFormat,
                  );
              if (!journalPath) return;

              let fileContent: string;
              try {
                fileContent = await readFile(journalPath);
              } catch {
                const parentDir = journalPath.substring(
                  0,
                  journalPath.lastIndexOf("/"),
                );
                await createDir(parentDir);
                if (journalTemplatePath) {
                  try {
                    const tpl = await readFile(journalTemplatePath);
                    fileContent = applyJournalTemplate(tpl, target);
                  } catch {
                    fileContent = generateDefaultJournal(target);
                  }
                } else {
                  fileContent = generateDefaultJournal(target);
                }
                await writeFile(journalPath, fileContent);
              }

              const edStore = useEditorStore.getState();
              const existing = edStore.tabs.find(
                (t) => t.filePath === journalPath,
              );
              if (existing) {
                edStore.setActiveTab(existing.id);
              } else {
                useFileStore
                  .getState()
                  .setFileContent(journalPath, fileContent);
                edStore.openTab({
                  id: crypto.randomUUID(),
                  filePath: journalPath,
                  title: journalPath.split("/").pop() ?? "Journal",
                  isDirty: false,
                  isPinned: false,
                });
              }
            } catch (err) {
              console.error("[JournalNav] Failed:", err);
            }
          })();
          return;
        }
      }

      // §5.5 Cmd+Enter — add row after in table (context-dependent)
      if (mod && e.key === "Enter" && editor && editor.isActive("table")) {
        e.preventDefault();
        editor.chain().focus().addRowAfter().run();
        return;
      }

      // --- Registry-based dispatch for all other shortcuts ---
      const isMac = navigator.platform.includes("Mac");
      const normalized = normalizeKeyEvent(e, isMac);
      if (!normalized) return;

      const overrides = useSettingsStore.getState().keybindingOverrides;
      const command = findCommandByKey(normalized, overrides);
      if (command) {
        const action = getAction(command.id);
        if (action) {
          e.preventDefault();
          action();
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleGoBack,
    handleGoForward,
    editor,
    tabSwitcherOpen,
    isSourceMode,
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

  const isGraphTabActive = isGraphTab(tabs.find((t) => t.id === activeTabId));

  return (
    <>
      <AppLayout
        editor={editor}
        statusBar={
          rootPath ? (
            <StatusBar
              editor={editor}
              isGraphMode={isGraphTabActive}
              isSourceMode={isSourceMode}
            />
          ) : undefined
        }
      >
        {!!rootPath && <TabBar />}
        <div className="editor-area">
          {!rootPath && !activeTabId ? (
            <div className="editor-area-scroll">
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
            <div className="editor-area-scroll">
              <div className="empty-workspace">
                <p>{t("home.emptyWorkspace")}</p>
              </div>
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
                  content={sourceContent}
                  key={`code-${activeTabId}`}
                  language={codeLanguage ?? undefined}
                  onChange={handleCodeFileChange}
                  ref={sourceEditorRef}
                />
              </Suspense>
            </div>
          ) : isSourceMode ? (
            <div className="editor-area-scroll">
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
              {activeTab?.filePath &&
                detectPeriodicType(activeTab.filePath) && (
                  <PeriodicInsightBanner
                    filePath={activeTab.filePath}
                    type={detectPeriodicType(activeTab.filePath)!}
                  />
                )}
              <div className="editor-area-scroll">
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
    <ErrorBoundary>
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

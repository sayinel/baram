// §39 Tab switching hook — swap editor content when activeTabId changes
import { useEffect, useRef } from "react";

import type { Editor } from "@tiptap/core";

import { EditorState, TextSelection } from "@tiptap/pm/state";

import { dispatchSetSearchTerm } from "../extensions/plugins/find-replace";
import {
  anchorsToPositions,
  dispatchRestoreFolds,
  foldPluginKey,
  positionsToAnchors,
} from "../extensions/plugins/fold";
import {
  markdownToProsemirror,
  mdastBlocksToPmNodes,
} from "../pipeline/md-to-pm";
import { parseMdastAsync } from "../pipeline/parse-async";
import { prosemirrorToMarkdown } from "../pipeline/pm-to-md";
import { isFileTab, isGraphTab } from "../stores/editor-store";
import { useEditorStore } from "../stores/editor-store";
import { useFileStore } from "../stores/file-store";
import { useFoldStore } from "../stores/fold-store";
import { useLinkStore } from "../stores/link-store";
import { useNavigationStore } from "../stores/navigation-store";
import { useUIStore } from "../stores/ui-store";
import { findBlockPosById } from "../utils/block-nav";
import { mdLineToPmBlockStart } from "../utils/cursor-mapper";
import { isMarkdownFile } from "../utils/file-type";

interface UseTabSwitchingParams {
  editor: Editor | null;
  /** Per-tab EditorState cache — owned by useSourceMode, shared here */
  editorStateCache: React.MutableRefObject<Map<string, EditorState>>;
  isNavBackForwardRef: React.RefObject<boolean>;
  isSourceMode: boolean;
  setFindReplaceMode: (mode: "find" | "replace") => void;
  setFindReplaceOpen: (open: boolean) => void;
  setIsParsing: (v: boolean) => void;
  setIsSourceMode: (v: boolean) => void;
  setSourceContent: (v: string) => void;
  sourceContentRef: React.MutableRefObject<string>;
}

export function useTabSwitching({
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
}: UseTabSwitchingParams) {
  const activeTabId = useEditorStore((s) => s.activeTabId);

  // Track previously active tab to save its content on switch
  const prevTabRef = useRef<null | string>(null);
  // Per-tab scroll position cache — preserves view position across tab switches
  const scrollTopCache = useRef(new Map<string, number>());
  // §perf-large-file B2/C2: Loading state for async parse + progressive loading
  const progressiveLoadRef = useRef<{ cancelled: boolean }>({
    cancelled: false,
  });

  // --- Tab switching: swap editor content when activeTabId changes ---
  useEffect(() => {
    if (!editor) return;

    const tabs = useEditorStore.getState().tabs;
    const { openFiles } = useFileStore.getState();

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
            useFileStore.getState().setFileContent(prevTab.filePath, md);
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
          if (loadToken.cancelled) {
            setIsParsing(false);
            return;
          }
          if (useEditorStore.getState().activeTabId !== activeTabId) {
            setIsParsing(false);
            return;
          }

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
    // Intentionally only re-run on activeTabId change; other values (editor,
    // tabs, openFiles, etc.) are read from store state or refs to avoid
    // re-registering the effect on every keystroke.
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps
}

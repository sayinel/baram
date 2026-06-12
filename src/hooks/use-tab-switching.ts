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
import { isFileTab, isGraphTab } from "../stores/editor/editor";
import { useEditorStore } from "../stores/editor/editor";
import { useFoldStore } from "../stores/editor/fold";
import { useLinkStore } from "../stores/editor/link";
import { useFileStore } from "../stores/file/file";
import { useNavigationStore } from "../stores/ui/navigation";
import { useUIStore } from "../stores/ui/ui";
import {
  findBlockPosById,
  findHeadingPosByText,
} from "../utils/editor/block-nav";
import { mdLineToPmBlockStart } from "../utils/editor/cursor-mapper";
import { logCacheEvent, timePhase } from "../utils/editor/perf-trace";
import {
  isTabLoading,
  markContentLoaded,
  setTabLoading,
} from "../utils/editor/programmatic-update";
import {
  appendChunksProgressively,
  chunkBlocks,
  FIRST_CHUNK_BLOCKS,
  type ProgressiveLoadHandle,
  REST_CHUNK_BLOCKS,
} from "../utils/editor/progressive-load";
import { isMarkdownFile } from "../utils/file-type";
import { logger } from "../utils/logger";
import {
  type KeepalivePool,
  LARGE_DOC_BLOCK_THRESHOLD,
  resolveTabEditor,
} from "./use-large-doc-keepalive";

interface UseTabSwitchingParams {
  /** §perf-large-file C3.5: factory to create a keep-alive editor for a tab */
  createKeepaliveEditor: () => Editor;
  editor: Editor | null;
  /** Per-tab EditorState cache — owned by useSourceMode, shared here */
  editorStateCache: React.MutableRefObject<Map<string, EditorState>>;
  isNavBackForwardRef: React.RefObject<boolean>;
  isSourceMode: boolean;
  /** §perf-large-file C3.5: keep-alive editor pool for large documents */
  keepalive: KeepalivePool;
  /** §perf-large-file C3.5: notify App of the active editor change */
  onActiveEditorChange: (editor: Editor | null) => void;
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
  keepalive,
  createKeepaliveEditor,
  onActiveEditorChange,
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
  const appendHandleRef = useRef<null | {
    handle: ProgressiveLoadHandle;
    tabId: string;
  }>(null);

  // Cancel any in-flight progressive append and clear the loading flag for its tab.
  const cancelInflightAppend = () => {
    if (appendHandleRef.current) {
      appendHandleRef.current.handle.cancel();
      setTabLoading(appendHandleRef.current.tabId, false);
      appendHandleRef.current = null;
    }
  };

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

      // §perf-large-file C3.5: determine which editor was active for the outgoing tab
      const prevKeepaliveEditor = keepalive.get(prevTabId);
      const prevEditor = prevKeepaliveEditor ?? editor;

      // Save scroll position of .editor-area-scroll for the outgoing tab
      // §perf-large-file C3.4: resolve via editor.view.dom.closest() so this
      // targets the ACTIVE editor's scroll container in a dual-editor layout.
      const scrollContainer = prevEditor?.view.dom.closest<HTMLElement>(
        ".editor-area-scroll",
      );
      if (scrollContainer) {
        scrollTopCache.current.set(prevTabId, scrollContainer.scrollTop);
      }

      // §perf-large-file C3.5: keep-alive tabs — hide their DOM, skip cache write
      // and skip outgoing serialize. The live editor IS the state; auto-save hooks
      // already run against it continuously.
      if (prevKeepaliveEditor) {
        // Visibility is controlled by React state (activeKeepaliveEditor) —
        // no manual DOM style toggle needed. onActiveEditorChange(null) in the
        // incoming-tab branches hides the keep-alive editor via React render.
        // Don't write editorStateCache or serialize — the editor stays live.
      } else if (isFileTab(prevTab) && prevEditor) {
        const prevIsCode = !isMarkdownFile(prevTab?.filePath);
        // §perf-large-file C2: Skip caching/saving a tab that is mid-load —
        // the doc is partial. Returning to it will re-run the uncached open path.
        const prevMidLoad = isTabLoading(prevTabId);
        // Cache EditorState before switching (keeps undo/redo stack intact)
        // Non-MD files don't use ProseMirror — skip caching
        if (!isSourceMode && !prevIsCode && !prevMidLoad) {
          editorStateCache.current.set(prevTabId, prevEditor.state);
          logCacheEvent("set", prevTabId, prevEditor.state.doc.childCount);
          // Save fold state as content-based anchors
          if (prevTab?.filePath) {
            const pluginState = foldPluginKey.getState(prevEditor.state);
            if (pluginState && pluginState.foldedPositions.size > 0) {
              const anchors = positionsToAnchors(
                prevEditor.state.doc,
                pluginState.foldedPositions,
              );
              useFoldStore.getState().saveFolds(prevTab.filePath, anchors);
            } else if (prevTab?.filePath) {
              useFoldStore.getState().clearFolds(prevTab.filePath);
            }
          }
        }
        if (prevTab?.filePath && !prevMidLoad) {
          try {
            const md =
              prevIsCode || isSourceMode
                ? sourceContentRef.current
                : timePhase("tabSwitch:serializeOutgoing", () =>
                    prosemirrorToMarkdown(prevEditor.state.doc),
                  );
            useFileStore.getState().setFileContent(prevTab.filePath, md);
          } catch (err) {
            // Serialization failed — mark tab dirty so unsaved edits are visible
            useEditorStore.getState().markDirty(prevTabId, true);
            logger.error(
              "tab-switching: serialization failed for outgoing tab",
              err,
            );
          }
        }
      }
      // Exit source mode when switching tabs (only applies to markdown)
      if (isSourceMode) {
        setIsSourceMode(false);
      }
    }

    // The outgoing-save block above has already read isTabLoading(prevTabId).
    // Now it is safe to cancel the in-flight appender and clear its flag/ref.
    cancelInflightAppend();

    // Load incoming tab content
    const incomingTab = tabs.find((t) => t.id === activeTabId);
    if (!incomingTab) {
      // No active tab — clear editor
      const emptyDoc = markdownToProsemirror("", editor.schema);
      const newState = EditorState.create({
        doc: emptyDoc,
        plugins: editor.state.plugins,
      });
      // Defer updateState outside React commit phase
      setTimeout(() => {
        editor.view.updateState(newState);
      });
      onActiveEditorChange(null);
      return;
    }

    // Graph tab — no ProseMirror content to load
    // [CRITICAL-1 fix] Reset activeEditor so hooks bind to shared editor
    if (isGraphTab(incomingTab)) {
      onActiveEditorChange(null);
      return;
    }

    // §perf-large-file C3.5: if this tab has a keep-alive editor, show it and skip load
    // [MINOR-10] Use resolveTabEditor (now live production code, not dead).
    const resolvedEditor = resolveTabEditor(activeTabId, keepalive, editor);
    const incomingKeepaliveEditor =
      resolvedEditor !== editor ? resolvedEditor : null;
    if (incomingKeepaliveEditor) {
      // Visibility is controlled by React state (activeKeepaliveEditor) via
      // onActiveEditorChange — no manual DOM style toggle needed.
      onActiveEditorChange(incomingKeepaliveEditor);
      // Restore scroll position
      const cachedScrollTop = scrollTopCache.current.get(activeTabId!);
      requestAnimationFrame(() => {
        const scrollContainer =
          incomingKeepaliveEditor.view.dom.closest<HTMLElement>(
            ".editor-area-scroll",
          );
        if (scrollContainer) {
          scrollContainer.scrollTop = cachedScrollTop ?? 0;
        }
      });
      // Still run afterDocLoad equivalent for search highlight etc.
      const pendingHighlight = useUIStore.getState().pendingSearchHighlight;
      if (pendingHighlight) {
        useUIStore.getState().setPendingSearchHighlight(null);
        setTimeout(() => {
          if (!incomingKeepaliveEditor?.view) return;
          dispatchSetSearchTerm(incomingKeepaliveEditor.view, pendingHighlight);
          setFindReplaceOpen(true);
          setFindReplaceMode("find");
        }, 50);
      }
      markContentLoaded(activeTabId!);
      return;
    }

    const content = incomingTab.filePath
      ? openFiles.get(incomingTab.filePath)
      : openFiles.get(incomingTab.id);

    if (content !== undefined) {
      // Non-markdown file — load into source editor, skip ProseMirror entirely
      if (!isMarkdownFile(incomingTab.filePath)) {
        // [CRITICAL-1 fix] Reset to shared editor
        onActiveEditorChange(null);
        sourceContentRef.current = content;
        setSourceContent(content);
        return;
      }

      // [CRITICAL-1 fix] All non-keepalive branches use the shared editor.
      // Set immediately so hooks/overlays rebind before content loads.
      onActiveEditorChange(null);

      // §perf-large-file B1: Post-load handler (scroll + search highlight)
      // [MAJOR-7] Parameterized by `loadEditor` so keep-alive loads target the
      // correct editor instance (not the shared one).
      const afterDocLoad = (loadEditor: Editor) => {
        // §29 Check if navigating from backlinks — compute scroll position
        const pendingLine = useLinkStore.getState().pendingScrollLine;
        const pendingBlockId = useLinkStore.getState().pendingScrollBlockId;
        const pendingHeading = useLinkStore.getState().pendingScrollHeading;
        let scrollPos: null | number = null;
        const doc = loadEditor.view.state.doc;
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
        } else if (pendingHeading) {
          useLinkStore.getState().setPendingScrollHeading(null);
          const headingPos = findHeadingPosByText(doc, pendingHeading);
          if (headingPos !== null) {
            scrollPos = Math.min(Math.max(headingPos + 1, 0), doc.content.size);
          }
        }

        // Dispatch a proper transaction for selection + scroll, then
        // use DOM scrollIntoView as fallback for the scroll container
        if (scrollPos !== null) {
          requestAnimationFrame(() => {
            try {
              const resolvedPos = loadEditor.view.state.doc.resolve(scrollPos);
              const tr = loadEditor.view.state.tr
                .setSelection(TextSelection.near(resolvedPos))
                .scrollIntoView();
              loadEditor.view.dispatch(tr);
              loadEditor.view.focus();

              // DOM-level scroll fallback — ensures .editor-area scrolls
              const domInfo = loadEditor.view.domAtPos(scrollPos);
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
            if (!loadEditor?.view) return;
            dispatchSetSearchTerm(loadEditor.view, pendingHighlight);
            setFindReplaceOpen(true);
            setFindReplaceMode("find");
          }, 50);
        }
      };

      // Try cached EditorState first (preserves undo/redo history)
      const cachedState = editorStateCache.current.get(activeTabId!);
      const cachedScrollTop = scrollTopCache.current.get(activeTabId!);
      if (cachedState) {
        logCacheEvent("hit", activeTabId!, cachedState.doc.childCount);
        // Defer updateState outside React commit phase
        setTimeout(() => {
          timePhase("tabSwitch:restore", () =>
            editor.view.updateState(cachedState),
          );
          markContentLoaded(activeTabId!);
        });
        // Restore exact scroll position (not just cursor visibility)
        // §perf-large-file C3.4: scope via editor.view.dom.closest() so this
        // targets the correct editor's scroll container in a dual-editor layout.
        if (cachedScrollTop !== undefined) {
          requestAnimationFrame(() => {
            const scrollContainer = editor.view.dom.closest<HTMLElement>(
              ".editor-area-scroll",
            );
            if (scrollContainer) {
              scrollContainer.scrollTop = cachedScrollTop;
            }
          });
        } else {
          // No cached scroll — reset to top (avoid stale scroll from previous tab)
          requestAnimationFrame(() => {
            const sc = editor.view.dom.closest<HTMLElement>(
              ".editor-area-scroll",
            );
            if (sc) sc.scrollTop = 0;
          });
        }
        afterDocLoad(editor);
      } else {
        logCacheEvent("miss", activeTabId!);
        // §perf-large-file B1/C2: Parse in Worker, progressively render chunks
        // Rendering perf is handled by content-visibility: auto (C1)
        progressiveLoadRef.current.cancelled = true;
        const loadToken = { cancelled: false };
        progressiveLoadRef.current = loadToken;
        setIsParsing(true);

        parseMdastAsync(content)
          .then((mdast) => {
            if (loadToken.cancelled) {
              setIsParsing(false);
              return;
            }
            if (useEditorStore.getState().activeTabId !== activeTabId) {
              setIsParsing(false);
              return;
            }

            const allNodes = timePhase("convert(mdast→PM)", () =>
              mdastBlocksToPmNodes(mdast, editor.schema),
            );
            const chunks = chunkBlocks(
              allNodes,
              FIRST_CHUNK_BLOCKS,
              REST_CHUNK_BLOCKS,
            );
            const firstChunk = chunks[0] ?? [];
            const restChunks = chunks.slice(1);

            // §perf-large-file C3.5: decide up-front whether to load into a
            // keep-alive editor (direct-load variant — simpler to verify).
            const isLargeDoc = allNodes.length >= LARGE_DOC_BLOCK_THRESHOLD;
            let targetEditor = editor;
            if (isLargeDoc && !keepalive.has(activeTabId!)) {
              targetEditor = createKeepaliveEditor();
              // [MAJOR-5] Acquire the pool slot immediately so a mid-load
              // switch-away destroys it via cancelInflightAppend + pool cleanup
              // instead of leaking a detached editor forever.
              keepalive.acquire(activeTabId!, targetEditor);
              onActiveEditorChange(targetEditor);
            }

            const doc = targetEditor.schema.nodes.doc.create(
              null,
              firstChunk.length ? firstChunk : undefined,
            );
            const newState = EditorState.create({
              doc,
              plugins: targetEditor.state.plugins,
              selection: TextSelection.atStart(doc),
            });

            // Suppress dirty/auto-save for the whole progressive load.
            setTabLoading(activeTabId!, true);

            // Run the deferred post-load work once the FULL doc is present.
            const finishLoad = () => {
              // Null the ref before clearing the flag so a concurrent cleanup
              // (effect re-run) can't see a stale tabId and clear a newer load's flag.
              // Only null if this load's tabId still matches (no newer load started).
              if (appendHandleRef.current?.tabId === activeTabId) {
                appendHandleRef.current = null;
              }
              setTabLoading(activeTabId!, false);
              markContentLoaded(activeTabId!);

              // [MAJOR-5] Pool slot already acquired at creation time;
              // acquire is idempotent, this is a safety no-op.
              if (isLargeDoc) {
                keepalive.acquire(activeTabId!, targetEditor);
              }

              afterDocLoad(targetEditor);
              const inTab = tabs.find((t) => t.id === activeTabId);
              if (inTab?.filePath) {
                const savedAnchors = useFoldStore
                  .getState()
                  .getFolds(inTab.filePath);
                if (savedAnchors.length > 0) {
                  const positions = anchorsToPositions(
                    targetEditor.view.state.doc,
                    savedAnchors,
                  );
                  if (positions.length > 0) {
                    dispatchRestoreFolds(targetEditor.view, positions);
                  }
                }
              }
            };

            // Defer updateState outside React commit phase.
            setTimeout(() => {
              if (loadToken.cancelled) {
                setTabLoading(activeTabId!, false);
                setIsParsing(false);
                return;
              }
              timePhase("updateState(first chunk)", () =>
                targetEditor.view.updateState(newState),
              );
              setIsParsing(false);

              // Reset scroll to top for freshly opened documents.
              // §perf-large-file C3.4: resolve via targetEditor.view.dom.closest().
              requestAnimationFrame(() => {
                const scrollContainer =
                  targetEditor.view.dom.closest<HTMLElement>(
                    ".editor-area-scroll",
                  );
                if (scrollContainer) scrollContainer.scrollTop = 0;
              });

              if (restChunks.length === 0) {
                finishLoad();
                return;
              }
              appendHandleRef.current = {
                handle: appendChunksProgressively(targetEditor, restChunks, {
                  onComplete: finishLoad,
                }),
                tabId: activeTabId!,
              };
            });
          })
          .catch((err: unknown) => {
            setIsParsing(false);
            logger.error("tab-switching: parse failed", err);
          });
      }

      // Clean up cache for closed tabs
      const openTabIds = new Set(tabs.map((t) => t.id));
      for (const cachedId of editorStateCache.current.keys()) {
        if (!openTabIds.has(cachedId)) {
          logCacheEvent("delete", cachedId);
          editorStateCache.current.delete(cachedId);
          scrollTopCache.current.delete(cachedId);
        }
      }
      // [MAJOR-4] Keep-alive tabs never enter editorStateCache, so check
      // the pool separately for closed tabs.
      for (const pooledTabId of keepalive.keys()) {
        if (!openTabIds.has(pooledTabId)) {
          keepalive.release(pooledTabId);
          scrollTopCache.current.delete(pooledTabId);
        }
      }
    }
    // Intentionally only re-run on activeTabId change; other values (editor,
    // tabs, openFiles, etc.) are read from store state or refs to avoid
    // re-registering the effect on every keystroke.
    return () => {
      // React runs this cleanup BEFORE the next effect body executes.
      // The next effect's outgoing-save block reads isTabLoading(prevTabId) at
      // line ~135 to decide whether to skip caching a partial doc — so we must
      // NOT clear the loading flag here. Only stop the appender from ticking.
      // cancelInflightAppend() is called unconditionally after the outgoing-save
      // block (line ~178) where the flag is no longer needed.
      appendHandleRef.current?.handle.cancel();
      progressiveLoadRef.current.cancelled = true;
    };
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps
}

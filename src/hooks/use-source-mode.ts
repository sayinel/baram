// §5.1 Source mode toggle — WYSIWYG ↔ raw markdown with cursor preservation
import { useCallback, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";

import type { SourceCodeEditorRef } from "../components/editor/SourceCodeEditor";
import type { EditorState as PmEditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

import { EditorState, TextSelection } from "@tiptap/pm/state";

import { forceCollapseSyntaxReveal } from "../extensions/plugins/syntax-reveal";
import {
  markdownToProsemirror,
  mdastBlocksToPmNodes,
} from "../pipeline/md-to-pm";
import { parseMdastAsync } from "../pipeline/parse-async";
import { prosemirrorToMarkdown } from "../pipeline/pm-to-md";
import { isFileTab, isGraphTab, useEditorStore } from "../stores/editor/editor";
import {
  mdOffsetToPmPos,
  pmPosToMdOffset,
} from "../utils/editor/cursor-mapper";
import {
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
import { LARGE_DOC_BLOCK_THRESHOLD } from "./use-large-doc-keepalive";

/** Shared ref type for registering progressive append handles so all cancel
 *  sites (tab switch, cleanup) can cancel source-mode fills too. */
export type AppendHandleRef = React.MutableRefObject<null | {
  handle: ProgressiveLoadHandle;
  tabId: string;
}>;

/** Narrow pool interface — only the completeness methods source-mode needs. */
export interface SourceModePoolAccess {
  markComplete: (tabId: string) => void;
  markIncomplete: (tabId: string) => void;
}

interface UseSourceModeParams {
  /** Shared ref from use-tab-switching — register progressive handle here
   *  so cancelInflightAppend covers source-mode fills. */
  appendHandleRef?: AppendHandleRef;
  editor: Editor | null;
  /** Pool access for marking completeness during source-mode progressive fills. */
  pool?: SourceModePoolAccess;
}

interface UseSourceModeReturn {
  /** Per-tab EditorState cache — owns the map, shared with useTabSwitching */
  editorStateCache: MutableRefObject<Map<string, PmEditorState>>;
  handleSourceChange: (content: string) => void;
  isSourceMode: boolean;
  setIsSourceMode: (v: boolean) => void;
  setSourceContent: (v: string) => void;
  sourceContent: string;
  sourceContentRef: MutableRefObject<string>;
  sourceCursorOffset: number;
  sourceEditorRef: RefObject<null | SourceCodeEditorRef>;
  toggleSourceMode: () => void;
}

export function useSourceMode({
  editor,
  appendHandleRef,
  pool,
}: UseSourceModeParams): UseSourceModeReturn {
  // Per-tab EditorState cache — owned here so toggleSourceMode can write to it
  // without a circular dependency with useTabSwitching
  const editorStateCache = useRef(new Map<string, PmEditorState>());
  const [isSourceMode, setIsSourceMode] = useState(false);
  const [sourceContent, setSourceContent] = useState("");
  const [sourceCursorOffset, setSourceCursorOffset] = useState(0);
  const sourceEditorRef = useRef<SourceCodeEditorRef>(null);
  // Ref mirrors sourceContent state — always has the latest value, immune to stale closures
  const sourceContentRef = useRef("");

  // Stable onChange for SourceCodeEditor — updates both ref and state
  const handleSourceChange = useCallback((content: string) => {
    sourceContentRef.current = content;
    setSourceContent(content);
  }, []);

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

      // [MAJOR-3] For large docs (≥ threshold), use the C2 progressive path
      // to avoid a multi-second whole-DOM rebuild on toggle-back. Cursor
      // restore is deferred to finishLoad (same as fold restore in tab switch).
      if (newDoc.childCount >= LARGE_DOC_BLOCK_THRESHOLD) {
        setIsSourceMode(false);

        // [MAJOR fix] Mark the pool entry incomplete so a mid-fill tab
        // switch + return takes the release-and-reload path instead of
        // blessing a truncated doc as the save baseline.
        if (currentTabId) pool?.markIncomplete(currentTabId);

        // Parse async and progressive-load into the keep-alive editor
        if (currentTabId) setTabLoading(currentTabId, true);

        parseMdastAsync(currentSource)
          .then((mdast) => {
            if (useEditorStore.getState().activeTabId !== currentTabId) return;

            const allNodes = mdastBlocksToPmNodes(mdast, editor.schema);
            const chunks = chunkBlocks(
              allNodes,
              FIRST_CHUNK_BLOCKS,
              REST_CHUNK_BLOCKS,
            );
            const firstChunk = chunks[0] ?? [];
            const restChunks = chunks.slice(1);

            const firstDoc = editor.schema.nodes.doc.create(
              null,
              firstChunk.length ? firstChunk : undefined,
            );
            const firstState = EditorState.create({
              doc: firstDoc,
              plugins: editor.state.plugins,
              selection: TextSelection.atStart(firstDoc),
            });

            const finishLoad = () => {
              if (currentTabId) {
                // [MAJOR fix] Mark complete so switch-back uses the pool entry.
                pool?.markComplete(currentTabId);
                setTabLoading(currentTabId, false);
                markContentLoaded(currentTabId);
              }
              // Deferred cursor restore (same as fold restore in tab switch)
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  try {
                    if (editor.view.isDestroyed) return;
                    if (useEditorStore.getState().activeTabId !== currentTabId)
                      return;
                    const doc = editor.view.state.doc;
                    const pos = Math.min(clampedPos, doc.content.size);
                    const sel = TextSelection.near(doc.resolve(pos));
                    editor.view.dispatch(
                      editor.view.state.tr.setSelection(sel).scrollIntoView(),
                    );
                    editor.view.focus();
                  } catch {
                    // ignore invalid position
                  }
                });
              });
            };

            setTimeout(() => {
              editor.view.updateState(firstState);
              if (restChunks.length === 0) {
                finishLoad();
                return;
              }
              // [NEW-MODERATE-C] Register the handle in the shared ref so
              // cancelInflightAppend (tab switch / cleanup) can cancel it.
              // Also cancel any prior fill (rapid re-toggle guard).
              if (appendHandleRef?.current) {
                appendHandleRef.current.handle.cancel();
              }
              const handle = appendChunksProgressively(editor, restChunks, {
                onComplete: () => {
                  if (appendHandleRef?.current?.tabId === currentTabId) {
                    appendHandleRef.current = null;
                  }
                  finishLoad();
                },
              });
              if (appendHandleRef && currentTabId) {
                appendHandleRef.current = {
                  handle,
                  tabId: currentTabId,
                };
              }
            });
          })
          .catch(() => {
            if (currentTabId) setTabLoading(currentTabId, false);
          });

        return;
      }

      // Small doc: synchronous path (existing behaviour)
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
            if (editor.view.isDestroyed) return;
            if (useEditorStore.getState().activeTabId !== currentTabId) return;
            const doc = editor.view.state.doc;
            const pos = Math.min(targetPos, doc.content.size);
            const resolvedSel = TextSelection.near(doc.resolve(pos));

            const domObserver = (
              editor.view as {
                domObserver?: { suppressSelectionUpdates?(): void };
              }
            ).domObserver;
            editor.view.dispatch(
              editor.view.state.tr.setSelection(resolvedSel).scrollIntoView(),
            );
            editor.view.focus();
            domObserver?.suppressSelectionUpdates?.();

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
    // editorStateCache, sourceContentRef, sourceEditorRef are stable refs (useRef) —
    // intentionally omitted from deps; they never change identity across renders.
    // appendHandleRef is a stable ref passed from App — included for exhaustive-deps.
    // pool is a stable ref-based object — included for exhaustive-deps.
  }, [editor, isSourceMode, appendHandleRef, pool]);

  return {
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
  };
}

// §5.1 Source mode toggle — WYSIWYG ↔ raw markdown with cursor preservation
import { useCallback, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";

import type { SourceCodeEditorRef } from "../components/editor/SourceCodeEditor";
import type { EditorState as PmEditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

import { EditorState, TextSelection } from "@tiptap/pm/state";

import { forceCollapseSyntaxReveal } from "../extensions/plugins/syntax-reveal";
import { markdownToProsemirror } from "../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../pipeline/pm-to-md";
import { isFileTab, isGraphTab, useEditorStore } from "../stores/editor/editor";
import {
  mdOffsetToPmPos,
  pmPosToMdOffset,
} from "../utils/editor/cursor-mapper";
import { isMarkdownFile } from "../utils/file-type";

interface UseSourceModeParams {
  editor: Editor | null;
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

            // Apply the target selection, then focus. The drift near #tag
            // inline atoms is NOT a mapping error (the cursor mapper round-trips
            // every reachable position, atom edges included). It happens at the
            // DOM layer: WebKit fires an ASYNCHRONOUS `selectionchange` after
            // focus that normalizes the native caret to the wrong side of a
            // contenteditable=false atom NodeView (#tag). The DOMObserver reads
            // that native selection and overwrites ours → cursor jumps to
            // before/after the tag.
            //
            // A synchronous stop()/start() guard can't catch an event that
            // fires AFTER start() re-attaches the listener (and stop() can
            // itself schedule a deferred flush). Use ProseMirror's own
            // suppressSelectionUpdates() (the #820 primitive): for ~50ms it
            // answers every selectionchange by RE-ASSERTING our PM selection to
            // the DOM (selectionToDOM) instead of reading the native one.
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
  }, [editor, isSourceMode]);

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

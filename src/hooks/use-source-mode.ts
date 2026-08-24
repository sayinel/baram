// §5.1 Source mode toggle — WYSIWYG ↔ raw markdown with cursor preservation
import { useCallback, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";

import type { SourceCodeEditorRef } from "../components/editor/SourceCodeEditor";
import type { EditorState as PmEditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

import { EditorState, TextSelection } from "@tiptap/pm/state";

import { forceCollapseSyntaxReveal } from "../extensions/plugins/syntax-reveal";
import { replaceEditorStateWithVim } from "../extensions/plugins/vim/replace-editor-state";
import {
  markdownToProsemirror,
  mdastBlocksToPmNodes,
} from "../pipeline/md-to-pm";
import { parseMdastAsync } from "../pipeline/parse-async";
import { prosemirrorToMarkdown } from "../pipeline/pm-to-md";
import { isFileTab, useEditorStore } from "../stores/editor/editor";
import {
  mdOffsetToPmPos,
  pmPosToMdOffset,
} from "../utils/editor/cursor-mapper";
import { focusEditorView } from "../utils/editor/focus-editor-view";
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
  /**
   * §287 자동 저장 effect의 deps용 카운터. 버퍼는 ref에 살아 리렌더를 유발하지 않으므로,
   * "버퍼가 바뀌었다"를 관찰 가능하게 만드는 값이 따로 필요하다(기존 `sourceContent`의 역할).
   */
  bufferVersion: number;
  /** Per-tab EditorState cache — owns the map, shared with useTabSwitching */
  editorStateCache: MutableRefObject<Map<string, PmEditorState>>;
  getSourceBuffer: (tabId: string) => string;
  handleSourceChange: (content: string) => void;
  /**
   * 이 탭의 문서를 이미 읽어 왔는가. 빈 파일도 정당한 문서이므로 내용 길이로는 알 수 없다 —
   * 맵에 키가 있는지가 유일한 판정이다.
   */
  hasSourceBuffer: (tabId: string) => boolean;
  /** 활성 탭이 소스 모드인가 — `sourceModeTabs.has(activeTabId)`의 파생값. */
  isSourceMode: boolean;
  setSourceBuffer: (tabId: string, content: string) => void;
  setSourceModeForTab: (tabId: string, on: boolean) => void;
  sourceCursorOffsetFor: (tabId: string) => number;
  sourceEditorRef: RefObject<null | SourceCodeEditorRef>;
  /** §287 소스 모드인 탭들. 전역 boolean이 아니다 — App의 htmlSourceTabs와 같은 모양. */
  sourceModeTabs: ReadonlySet<string>;
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
  const sourceEditorRef = useRef<SourceCodeEditorRef>(null);

  // §287 탭별 소스 버퍼.
  //
  // ‼️ 전역 버퍼 하나였을 때는 코드 표면이 항상 한 개뿐이라는 사실에 기대고 있었다. 유지
  // 집합(§286)이 표면을 여러 개 마운트하는 순간 그 가정이 깨지고, 마지막에 타이핑한 표면이
  // 버퍼를 쥔 채 자동 저장이 **활성 탭 경로에** 그것을 쓴다.
  //
  // 값을 state가 아니라 ref의 Map에 두는 이유: state로 두면 타이핑 한 글자마다 새 Map을
  // 만들게 된다. 리렌더가 필요한 소비자(자동 저장 deps)를 위해 카운터만 state로 둔다.
  const buffersRef = useRef(new Map<string, string>());
  const cursorOffsetsRef = useRef(new Map<string, number>());
  const [bufferVersion, setBufferVersion] = useState(0);
  const [sourceModeTabs, setSourceModeTabs] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const isSourceMode = !!activeTabId && sourceModeTabs.has(activeTabId);

  const getSourceBuffer = useCallback(
    (tabId: string): string => buffersRef.current.get(tabId) ?? "",
    [],
  );
  const hasSourceBuffer = useCallback(
    (tabId: string): boolean => buffersRef.current.has(tabId),
    // bufferVersion을 deps에 두어, 버퍼가 처음 채워진 렌더에서 이 콜백의 참조가 바뀌고
    // 소비자(TabSurface 렌더러)가 다시 판정하게 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bufferVersion],
  );
  const setSourceBuffer = useCallback((tabId: string, content: string) => {
    buffersRef.current.set(tabId, content);
    setBufferVersion((v) => v + 1);
  }, []);
  const sourceCursorOffsetFor = useCallback(
    (tabId: string): number => cursorOffsetsRef.current.get(tabId) ?? 0,
    [],
  );
  const setSourceModeForTab = useCallback((tabId: string, on: boolean) => {
    setSourceModeTabs((prev) => {
      if (prev.has(tabId) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(tabId);
      else next.delete(tabId);
      return next;
    });
  }, []);

  // Stable onChange for the ACTIVE surface's SourceCodeEditor. 탭 id를 클로저가 아니라
  // 호출 시점에 읽는다 — 이 콜백은 안정된 참조로 여러 렌더를 살아남기 때문이다.
  const handleSourceChange = useCallback(
    (content: string) => {
      const tabId = useEditorStore.getState().activeTabId;
      if (tabId) setSourceBuffer(tabId, content);
    },
    [setSourceBuffer],
  );

  // Cmd+/ toggle between WYSIWYG and Source Code mode (§5.1 cursor preservation)
  const toggleSourceMode = useCallback(() => {
    if (!editor) return;
    const { tabs: currentTabs, activeTabId: currentTabId } =
      useEditorStore.getState();
    const currentTab = currentTabs.find((t) => t.id === currentTabId);
    // Graph / plugin tab — no document to show as source. ‼️ Asked as "is this a file?":
    // the non-MD check below is itself gated on `isFileTab`, so an enumerated check here
    // left every non-file type falling through BOTH guards into the toggle.
    if (!isFileTab(currentTab)) return;
    if (!isMarkdownFile(currentTab.filePath)) return;

    if (!isSourceMode) {
      // WYSIWYG → Source: collapse any active syntax reveal expansion first
      // (SyntaxReveal replaces marks with literal delimiter text, which would
      // cause remark-stringify to escape angle brackets like \<u>)
      forceCollapseSyntaxReveal(editor.view);
      const md = prosemirrorToMarkdown(editor.state.doc);
      const pmPos = editor.state.selection.from;
      const mdOffset = pmPosToMdOffset(editor.state.doc, pmPos, md);

      setSourceBuffer(currentTab.id, md);
      cursorOffsetsRef.current.set(currentTab.id, mdOffset);
      setSourceModeForTab(currentTab.id, true);
    } else {
      // Source → WYSIWYG
      // Use original markdown unless the user actually edited in Source mode.
      // WebKit injects "<!--  -->" into CodeMirror on focus — getContent()
      // would return corrupted content if the user didn't edit.
      const userEdited = sourceEditorRef.current?.hasUserEdited() ?? false;
      const tabBuffer = getSourceBuffer(currentTab.id);
      const currentSource = userEdited
        ? (sourceEditorRef.current?.getContent() ?? tabBuffer)
        : tabBuffer;
      const mdOffset = sourceEditorRef.current?.getCursorOffset() ?? 0;

      const newDoc = markdownToProsemirror(currentSource, editor.schema);
      const pmPos = mdOffsetToPmPos(newDoc, mdOffset, currentSource);
      const clampedPos = Math.min(Math.max(pmPos, 0), newDoc.content.size);

      // [MAJOR-3] For large docs (≥ threshold), use the C2 progressive path
      // to avoid a multi-second whole-DOM rebuild on toggle-back. Cursor
      // restore is deferred to finishLoad (same as fold restore in tab switch).
      if (newDoc.childCount >= LARGE_DOC_BLOCK_THRESHOLD) {
        setSourceModeForTab(currentTab.id, false);

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
                    // Not PM's own focus: it is gated on `editable`, and vim
                    // normal runs the view non-editable — the caret would
                    // land but every key after Cmd+/ would go nowhere.
                    focusEditorView(editor.view);
                  } catch {
                    // ignore invalid position
                  }
                });
              });
            };

            setTimeout(() => {
              replaceEditorStateWithVim(
                editor.view,
                firstState,
                "source-return",
              );
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
      replaceEditorStateWithVim(editor.view, tempState, "source-return");

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

      setSourceModeForTab(currentTab.id, false);

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
            // See the progressive path above — the editable-gated focus is a
            // silent no-op while vim owns the surface.
            focusEditorView(editor.view);
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
  }, [
    editor,
    isSourceMode,
    appendHandleRef,
    pool,
    getSourceBuffer,
    setSourceBuffer,
    setSourceModeForTab,
  ]);

  return {
    bufferVersion,
    editorStateCache,
    getSourceBuffer,
    handleSourceChange,
    hasSourceBuffer,
    isSourceMode,
    setSourceBuffer,
    setSourceModeForTab,
    sourceCursorOffsetFor,
    sourceEditorRef,
    sourceModeTabs,
    toggleSourceMode,
  };
}

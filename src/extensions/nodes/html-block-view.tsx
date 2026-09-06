// §5.1 HTML Block NodeView — sanitized HTML preview, raw textarea on select
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { NodeSelection } from "@tiptap/pm/state";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";

import { activeFileDir } from "../../utils/active-file-dir";
import { focusEditorView } from "../../utils/editor/focus-editor-view";
import { sanitizeHtmlBlock } from "../../utils/markdown/html-sanitize";
import { isWysiwygVimModal, vimPluginKey } from "../plugins/vim/vim-keys";
import { resolveMediaSrcsIn } from "./views/resolve-html-media-srcs";
import { useAtomBlockBehavior } from "./views/use-atom-block-behavior";
import { useTextareaAutoResize } from "./views/use-textarea-auto-resize";

export function HtmlBlockView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: NodeViewProps): React.ReactElement {
  const content = (node.attrs.content as string) || "";
  const [localContent, setLocalContent] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Refs for stable access in effects
  const localContentRef = useRef(localContent);
  localContentRef.current = localContent;
  const contentRef = useRef(content);
  contentRef.current = content;
  const updateAttributesRef = useRef(updateAttributes);
  updateAttributesRef.current = updateAttributes;
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Sync local content and focus textarea when entering edit mode
  // §12-⑩ vim modal gate — event-time read via ref (not a reactive dep)
  const vimGateEditorRef = useRef(editor);
  vimGateEditorRef.current = editor;
  // A CLICK is an explicit request to edit and bypasses the modal gate;
  // keyboard traversal does not. Consumed on entry, cleared on deselect.
  const enterByClickRef = useRef(false);
  // §12-⑩ — the editing UI follows ENTRY, not selection (the math block's
  // model, f12e2af0). Traversal renders the PREVIEW plus a standby textarea;
  // the session opens when that textarea gains focus. Ref mirror so event
  // handlers see the current value.
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(false);
  // Save-on-deselect fires only after REAL typing in an edit session — a
  // bare attrs-vs-local comparison writes a stale baseline back over attrs
  // updated while unselected (S5/S6 review R2).
  const editDirtyRef = useRef(false);

  useEffect(() => {
    if (!selected) {
      // Save on deselect
      // CONSUME dirty at every deselect — a completed session's flag must
      // not survive into the next one (S5/S6 review R3).
      const wasDirty = editDirtyRef.current;
      editDirtyRef.current = false;
      if (wasDirty && localContentRef.current !== contentRef.current) {
        updateAttributesRef.current({ content: localContentRef.current });
      }
      enterByClickRef.current = false;
      isEditingRef.current = false;
      setIsEditing(false);
    } else if (
      enterByClickRef.current ||
      !isWysiwygVimModal(vimGateEditorRef.current.state)
    ) {
      // §298 §12-⑩ — selection ALONE must not open the block while vim is
      // modal (the math block's contract, pinned per block). A click sets the
      // latch below; vim's `i` preflight focuses the STANDBY textarea and its
      // focus event opens the session.
      enterByClickRef.current = false;
      editDirtyRef.current = false;
      isEditingRef.current = true;
      setIsEditing(true);
      setLocalContent(contentRef.current);
      setTimeout(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(0, 0);
      }, 0);
    }
  }, [selected]);

  // §12-⑩ — one render path, editing UI keyed on ENTRY, not selection.
  // Computed BEFORE the hooks that key on it.
  const editing =
    selected &&
    (isEditing ||
      enterByClickRef.current ||
      !isWysiwygVimModal(vimGateEditorRef.current.state));

  // Auto-resize textarea — keyed on `editing`, NOT `selected`: the standby
  // element is 1px wide, and a measurement there writes an inflated inline
  // height that survives into the editing render.
  useTextareaAutoResize(textareaRef, localContent, editing);

  // Common atom-block behavior: deleteBlock, exitBlock, handleKeyDown
  const onSaveBeforeExit = useCallback((): void => {
    if (localContent !== content) {
      updateAttributes({ content: localContent });
    }
  }, [localContent, content, updateAttributes]);

  const isEmpty = useCallback(() => !localContent, [localContent]);
  const { handleKeyDown } = useAtomBlockBehavior({
    editor,
    getPos,
    nodeSize: node.nodeSize,
    textareaRef,
    onSaveBeforeExit,
    keyboard: { backspaceOnEmpty: true, horizontalArrowExit: false },
    isEmpty,
  });

  // §12-⑩ entry signal — vim's `i` preflight focuses the standby textarea;
  // the click path's scheduled focus arrives here too. Opens the session once.
  const handleTextareaFocus = useCallback(() => {
    if (isEditingRef.current) return;
    isEditingRef.current = true;
    editDirtyRef.current = false;
    setLocalContent(contentRef.current);
    setIsEditing(true);
  }, []);

  // §298 Esc stair — while vim owns the surface, Esc lands normal mode and
  // the block's NodeSelection in ONE transaction, then hands focus back (see
  // math-block-view for the surface-insert entry that makes atomicity
  // necessary). Without vim, exitBlock("down") stays as it was.
  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (
        e.key === "Escape" &&
        vimPluginKey.getState(editorRef.current.state)?.enabled
      ) {
        e.preventDefault();
        e.stopPropagation();
        onSaveBeforeExit();
        enterByClickRef.current = false;
        editDirtyRef.current = false;
        isEditingRef.current = false;
        setIsEditing(false);
        const editorNow = editorRef.current;
        const pos = getPos();
        const tr = editorNow.state.tr;
        if (typeof pos === "number") {
          tr.setSelection(NodeSelection.create(tr.doc, pos));
        }
        tr.setMeta(vimPluginKey, { mode: "normal", type: "setMode" });
        editorNow.view.dispatch(tr);
        focusEditorView(editorNow.view);
        return;
      }
      handleKeyDown(e);
    },
    [getPos, handleKeyDown, onSaveBeforeExit],
  );

  const handlePreviewClick = useCallback((): void => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    // §12-⑩ modal click = NAVIGATION (issue 408, UX decision): land the
    // outline exactly like j/k and stop — `i` is the entry. Non-modal (insert
    // mode, vim off) keeps the click entry below.
    if (isWysiwygVimModal(editorRef.current.state)) {
      editorRef.current.commands.setNodeSelection(pos);
      return;
    }
    // Set BEFORE the selection change: the entry effect consumes the latch on
    // the render this dispatch causes.
    enterByClickRef.current = true;
    editor.commands.setNodeSelection(pos);
    // Already-selected standby block: the selection does not change, so no
    // effect will run — the standby textarea is the entry instead.
    textareaRef.current?.focus();
  }, [editor, getPos]);

  const sanitizedHtml = content ? sanitizeHtmlBlock(content) : "";

  // §12-⑩ — one render path, editing UI keyed on ENTRY, not selection: a
  // traversal NodeSelection keeps the preview (plus PM's selectednode
  // outline). Single path so the textarea element survives the flip — the
  // header/textarea slots are positionally stable ({editing && …} keeps its
  // index), which is what preserves the element identity for preflight focus.
  return (
    <NodeViewWrapper
      className={
        editing
          ? "html-block html-block-editing"
          : "html-block html-block-preview"
      }
      contentEditable={false}
      data-type="htmlBlock"
      onClick={editing ? undefined : handlePreviewClick}
      spellCheck={false}
    >
      {editing && (
        <div className="html-block-header">
          <span className="html-block-label">html</span>
        </div>
      )}
      {selected && (
        <textarea
          // Standby must not be a Tab stop nor AT-visible; programmatic
          // .focus() (vim's preflight) works regardless of tabIndex -1.
          aria-hidden={editing ? undefined : true}
          autoCapitalize="off"
          autoCorrect="off"
          className={
            editing
              ? "html-block-textarea"
              : "html-block-textarea html-block-textarea-standby"
          }
          data-gramm="false"
          data-vim-suspend=""
          onChange={(e) => {
            editDirtyRef.current = true;
            setLocalContent(e.target.value);
          }}
          onFocus={handleTextareaFocus}
          onKeyDown={handleTextareaKeyDown}
          placeholder="<div>...</div>"
          ref={textareaRef}
          rows={1}
          spellCheck={false}
          tabIndex={editing ? 0 : -1}
          value={localContent}
        />
      )}
      {editing ? (
        sanitizedHtml && (
          <HtmlBlockRender
            className="html-block-render html-block-render-faded"
            html={sanitizeHtmlBlock(localContent)}
          />
        )
      ) : sanitizedHtml ? (
        <HtmlBlockRender className="html-block-render" html={sanitizedHtml} />
      ) : (
        <div className="html-block-empty">Empty HTML block</div>
      )}
    </NodeViewWrapper>
  );
}

/**
 * 소독된 HTML을 주입하고, **주입된 DOM 위에서** 상대경로 미디어 src를 해석한다
 * (§294 최종 게이트 I3). 무엇을·왜 고치는지는 resolve-html-media-srcs.ts.
 *
 * ‼️ 의존성 배열이 **없다**. React 19는 `dangerouslySetInnerHTML` prop을 객체
 * 아이덴티티로 비교하고, 여기서는 렌더마다 `{ __html }` 리터럴이 새로 생기므로
 * **매 렌더 innerHTML을 다시 심는다** — 문자열이 그대로여도 그렇다. 측정으로
 * 확인했다: deps를 `[html, baseDir]`로 두면 관계없는 리렌더 한 번에 src가 원래
 * 상대경로로 되돌아가고 effect는 다시 돌지 않아서 이미지가 **다시 빈 화면이
 * 된다**. React가 다시 심는 주기와 고쳐 쓰는 주기가 같아야 한다.
 *
 * ‼️ `useLayoutEffect`인 이유: 페인트 전에 끝내야 상대경로 src로 요청이 한 번
 * 나가고 깨진 이미지가 한 프레임 보이는 일이 없다.
 *
 * ‼️ svg·mermaid view는 정반대로 간다 — `views/use-inner-html.ts`로 `{ __html }`
 * 객체를 memoize해 리렌더에도 svg DOM을 유지한다(issue 549). 여기를 그쪽에
 * 맞춰 "정리"하면 위의 src 재해석 주기가 끊긴다. 이 리터럴은 의도다.
 */
function HtmlBlockRender({
  className,
  html,
}: {
  className: string;
  html: string;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const baseDir = activeFileDir();

  useLayoutEffect(() => {
    if (ref.current) resolveMediaSrcsIn(ref.current, baseDir);
  });

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
      ref={ref}
    />
  );
}

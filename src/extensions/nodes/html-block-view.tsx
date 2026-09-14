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

import { useTranslation } from "../../i18n/useTranslation";
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
  const { t } = useTranslation();
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
        <div className="html-block-empty">{t("htmlBlock.empty")}</div>
      )}
    </NodeViewWrapper>
  );
}

/**
 * 소독된 HTML을 주입하고, **주입된 DOM 위에서** 상대경로 미디어 src를 해석한다
 * (§294 최종 게이트 I3). 무엇을·왜 고치는지는 resolve-html-media-srcs.ts.
 *
 * ‼️ `key={baseDir}`가 재해석의 **유일한 보증**이다. 해석은 멱등 가드
 * (`value.startsWith("asset:")`)를 들고 있어 이미 `asset:`이 된 src를 두 번
 * 고치지 않는다 — 그러니 baseDir이 바뀌었을 때 다시 해석하려면 주입된 DOM이
 * 원래의 상대경로로 돌아와 있어야 하고, 그 리셋을 일으키는 것이 이 key다.
 *
 * ‼️ 예전에는 key 없이도 됐는데, 그건 React가 **매 렌더 innerHTML을 다시
 * 심었기** 때문이다. **React 19.3에서 그 동작이 바뀌었다** — 두 버전에서 같은
 * 프로브로 측정했다(`{ __html }` 리터럴은 매 렌더 새 객체인데도):
 *   - 19.2.8: 주입된 DOM에 준 변형이 리렌더 한 번에 **지워진다**(재주입)
 *   - 19.3.0: `__html` **문자열**이 같으면 재주입하지 않아 변형이 **살아남는다**
 * 그래서 19.3에서는 deps 없는 effect가 돌아도 src가 이미 `asset:`이라 멱등
 * 가드에 걸려 아무것도 안 했다 — 탭을 옮겨도 옛 디렉터리 기준으로 남았다.
 * React의 재주입 주기에 기대지 말고 우리가 리셋 시점을 정한다.
 *
 * ‼️ deps 없는 effect는 그대로 둔다. html이 바뀌면 React가 새 markup을 심고,
 * baseDir이 바뀌면 key가 심으므로 effect는 그 두 경우를 모두 뒤따르기만 하면
 * 된다. 멱등이라 그 밖의 렌더에서는 아무 일도 하지 않는다.
 *
 * ‼️ `useLayoutEffect`인 이유: 페인트 전에 끝내야 상대경로 src로 요청이 한 번
 * 나가고 깨진 이미지가 한 프레임 보이는 일이 없다.
 *
 * ‼️ svg·mermaid view는 `views/use-inner-html.ts`로 `{ __html }` 객체를
 * memoize해 리렌더에도 svg DOM을 유지한다(issue 549). 19.3부터는 React가 알아서
 * 유지하므로 그 memo는 더 이상 결정적이지 않지만, 여기의 key는 반대로 **필요할
 * 때 일부러 버리는** 장치라 성격이 다르다. 둘을 같은 모양으로 "정리"하지 말 것.
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
      key={baseDir ?? ""}
      ref={ref}
    />
  );
}

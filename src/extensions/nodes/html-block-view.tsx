// §5.1 HTML Block NodeView — sanitized HTML preview, raw textarea on select
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import DOMPurify from "dompurify";

import { activeFileDir } from "../../utils/active-file-dir";
import { isSvgContent, sanitizeSvg } from "../../utils/markdown/svg-utils";
import { resolveMediaSrcsIn } from "./views/resolve-html-media-srcs";
import { useAtomBlockBehavior } from "./views/use-atom-block-behavior";
import { useTextareaAutoResize } from "./views/use-textarea-auto-resize";

const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_TAGS: [
    "img",
    "br",
    "hr",
    "a",
    "table",
    "tr",
    "td",
    "th",
    "thead",
    "tbody",
    "div",
    "span",
    "p",
    "strong",
    "em",
  ],
  ADD_ATTR: [
    "align",
    "src",
    "alt",
    "width",
    "height",
    "href",
    "class",
    "colspan",
    "rowspan",
  ],
  FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
};

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

  // Sync local content and focus textarea when entering edit mode
  useEffect(() => {
    if (selected) {
      setLocalContent(contentRef.current);
      setTimeout(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(0, 0);
      }, 0);
    } else {
      // Save on deselect
      if (localContentRef.current !== contentRef.current) {
        updateAttributesRef.current({ content: localContentRef.current });
      }
    }
  }, [selected]);

  // Auto-resize textarea
  useTextareaAutoResize(textareaRef, localContent, selected);

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

  const handlePreviewClick = useCallback((): void => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    editor.commands.setNodeSelection(pos);
  }, [editor, getPos]);

  const sanitizedHtml = content ? sanitizeHtmlBlock(content) : "";

  // Non-editing: sanitized HTML render
  if (!selected) {
    return (
      <NodeViewWrapper
        className="html-block html-block-preview"
        contentEditable={false}
        data-type="htmlBlock"
        onClick={handlePreviewClick}
        spellCheck={false}
      >
        {sanitizedHtml ? (
          <HtmlBlockRender className="html-block-render" html={sanitizedHtml} />
        ) : (
          <div className="html-block-empty">Empty HTML block</div>
        )}
      </NodeViewWrapper>
    );
  }

  // Editing: raw HTML textarea
  return (
    <NodeViewWrapper
      className="html-block html-block-editing"
      contentEditable={false}
      data-type="htmlBlock"
      spellCheck={false}
    >
      <div className="html-block-header">
        <span className="html-block-label">html</span>
      </div>
      <textarea
        autoCapitalize="off"
        autoCorrect="off"
        className="html-block-textarea"
        data-gramm="false"
        onChange={(e) => setLocalContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="<div>...</div>"
        ref={textareaRef}
        rows={1}
        spellCheck={false}
        value={localContent}
      />
      {sanitizedHtml && (
        <HtmlBlockRender
          className="html-block-render html-block-render-faded"
          html={sanitizeHtmlBlock(localContent)}
        />
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

/**
 * Raw `<svg>` markup goes through the shared {@link sanitizeSvg} (svg profile +
 * inline `style`/presentation attrs/filters) so it renders with full fidelity;
 * everything else keeps the stricter HTML config. `<script>`, event handlers and
 * `javascript:` URLs stay forbidden on both paths.
 */
function sanitizeHtmlBlock(html: string): string {
  return isSvgContent(html)
    ? sanitizeSvg(html)
    : DOMPurify.sanitize(html, SANITIZE_CONFIG);
}

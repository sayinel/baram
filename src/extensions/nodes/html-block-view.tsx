// §5.1 HTML Block NodeView — sanitized HTML preview, raw textarea on select
import React, { useCallback, useEffect, useRef, useState } from "react";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import DOMPurify from "dompurify";

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

  const sanitizedHtml = content
    ? DOMPurify.sanitize(content, SANITIZE_CONFIG)
    : "";

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
          <div
            className="html-block-render"
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
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
        <div
          className="html-block-render html-block-render-faded"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(localContent, SANITIZE_CONFIG),
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

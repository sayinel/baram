// §30d Block Embed NodeView — editable transclusion with bidirectional sync
import { useCallback, useEffect, useRef, useState } from "react";

import type { BlockEmbedOptions } from "./block-embed";
import type { NodeViewProps } from "@tiptap/react";

import { NodeViewWrapper } from "@tiptap/react";

import { useEmbedSync } from "../../hooks/use-embed-sync";
import { useAtomBlockBehavior } from "./views/use-atom-block-behavior";
import { useTextareaAutoResize } from "./views/use-textarea-auto-resize";

export function BlockEmbedView({
  node,
  selected,
  extension,
  editor,
  getPos,
}: NodeViewProps) {
  const { target, blockId } = node.attrs as {
    blockId: string;
    target: string;
  };

  const {
    content,
    status,
    isEditing,
    startEditing,
    updateContent,
    commitEdit,
  } = useEmbedSync({ target, blockId, editor });

  const [localText, setLocalText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Enter editing when selected + content ready; exit when deselected
  useEffect(() => {
    if (selected && status === "ready" && content !== null && !isEditing) {
      startEditing();
      setLocalText(content);
      setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(0, 0);
        }
      }, 0);
    } else if (!selected && isEditing) {
      commitEdit();
    }
  }, [selected, status, content, isEditing, startEditing, commitEdit]);

  // Auto-resize textarea
  useTextareaAutoResize(textareaRef, localText, isEditing);

  // Common atom-block behavior: exitBlock, handleKeyDown
  const { handleKeyDown } = useAtomBlockBehavior({
    editor,
    getPos,
    nodeSize: node.nodeSize,
    textareaRef,
    onSaveBeforeExit: commitEdit,
    keyboard: { backspaceOnEmpty: false, horizontalArrowExit: true },
  });

  // Navigate to source on header click
  const handleHeaderClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const onNavigate = (extension.options as BlockEmbedOptions).onNavigate;
      onNavigate(target, blockId);
    },
    [extension, target, blockId],
  );

  // Click on content area → select this node to enter edit mode
  const handleContentClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent ProseMirror from overriding our selection
      const pos = getPos();
      if (typeof pos !== "number") return;
      editor.commands.setNodeSelection(pos);
    },
    [editor, getPos],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setLocalText(val);
      updateContent(val);
    },
    [updateContent],
  );

  const headerText = target ? `${target} > ^${blockId}` : `^${blockId}`;

  // Editing mode
  if (isEditing && selected) {
    return (
      <NodeViewWrapper
        className="block-embed block-embed-editing"
        contentEditable={false}
        spellCheck={false}
      >
        <div className="block-embed-header" onClick={handleHeaderClick}>
          {headerText}
        </div>
        <textarea
          className="block-embed-textarea"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          ref={textareaRef}
          rows={1}
          spellCheck={false}
          value={localText}
        />
      </NodeViewWrapper>
    );
  }

  // Read-only preview mode
  return (
    <NodeViewWrapper
      className={`block-embed ${selected ? "block-embed-selected" : ""}`}
      spellCheck={false}
    >
      <div className="block-embed-header" onClick={handleHeaderClick}>
        {headerText}
      </div>
      <div className="block-embed-content" onClick={handleContentClick}>
        {status === "loading" && (
          <span style={{ color: "var(--color-text-muted)" }}>Loading…</span>
        )}
        {status === "ready" && content}
        {status === "file-not-found" && (
          <span
            style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}
          >
            File &ldquo;{target}&rdquo; not found — open a folder first
          </span>
        )}
        {status === "block-not-found" && (
          <span
            style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}
          >
            Block ^{blockId} not found{target ? ` in ${target}` : ""}
          </span>
        )}
        {status === "error" && (
          <span style={{ color: "#dc2626", fontStyle: "italic" }}>
            Failed to load embed
          </span>
        )}
      </div>
    </NodeViewWrapper>
  );
}

// §30d Block Embed NodeView — editable transclusion with bidirectional sync
import { useState, useEffect, useRef, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { BlockEmbedOptions } from "./block-embed";
import { useEmbedSync } from "../../hooks/use-embed-sync";

export function BlockEmbedView({
  node,
  selected,
  extension,
  editor,
  getPos,
}: NodeViewProps) {
  const { target, blockId } = node.attrs as {
    target: string;
    blockId: string;
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
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + "px";
    }
  }, [localText, isEditing]);

  // Exit block: commit and move cursor
  const exitBlock = useCallback(
    (direction: "up" | "down") => {
      const pos = getPos();
      if (typeof pos !== "number") return;

      commitEdit();

      if (direction === "up") {
        editor.chain().setTextSelection(pos).focus().run();
      } else {
        const afterPos = pos + node.nodeSize;
        const { doc } = editor.state;
        const $after = doc.resolve(afterPos);
        if ($after.parentOffset >= $after.parent.content.size) {
          editor
            .chain()
            .insertContentAt(afterPos, { type: "paragraph" })
            .setTextSelection(afterPos + 1)
            .focus()
            .run();
        } else {
          editor.chain().setTextSelection(afterPos).focus().run();
        }
      }
    },
    [editor, getPos, commitEdit, node.nodeSize],
  );

  // Keyboard navigation (MathBlockView pattern)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = textareaRef.current;
      if (!ta) return;

      if (e.key === "Escape") {
        e.preventDefault();
        exitBlock("down");
        return;
      }

      if (
        e.key === "ArrowLeft" &&
        ta.selectionStart === 0 &&
        ta.selectionEnd === 0
      ) {
        e.preventDefault();
        exitBlock("up");
        return;
      }

      if (
        e.key === "ArrowRight" &&
        ta.selectionStart === ta.value.length
      ) {
        e.preventDefault();
        exitBlock("down");
        return;
      }

      if (e.key === "ArrowUp") {
        const before = ta.value.substring(0, ta.selectionStart);
        if (!before.includes("\n")) {
          e.preventDefault();
          exitBlock("up");
          return;
        }
      }

      if (e.key === "ArrowDown") {
        const after = ta.value.substring(ta.selectionStart);
        if (!after.includes("\n")) {
          e.preventDefault();
          exitBlock("down");
          return;
        }
      }
    },
    [exitBlock],
  );

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
          ref={textareaRef}
          className="block-embed-textarea"
          value={localText}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={1}
          spellCheck={false}
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

// Common keyboard navigation and block lifecycle for atom-block NodeViews.
// Shared by math-block, mermaid-block, html-block, and block-embed views.
//
// Extracts three duplicated functions: deleteBlock, exitBlock, handleKeyDown.

import type React from "react";
import { type RefObject, useCallback } from "react";

import type { Editor } from "@tiptap/react";

import { TextSelection } from "@tiptap/pm/state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for configuring which keyboard handlers are active. */
interface KeyboardOptions {
  /**
   * Enable Backspace-on-empty to delete the block.
   * Requires `isEmpty` to determine whether content is empty.
   * Default: false
   */
  backspaceOnEmpty?: boolean;

  /**
   * Enable ArrowLeft (at position 0) → exit up, ArrowRight (at end) → exit down.
   * Default: false
   */
  horizontalArrowExit?: boolean;
}

/** Parameters for the hook. */
interface UseAtomBlockBehaviorParams {
  editor: Editor;
  getPos: () => number | undefined;
  /**
   * Returns true when the block content is empty.
   * Required when `keyboard.backspaceOnEmpty` is true.
   */
  isEmpty?: () => boolean;
  /** Keyboard handler configuration. */
  keyboard?: KeyboardOptions;

  nodeSize: number;

  /**
   * Called before exiting the block, so the view can persist unsaved changes.
   * For most views this calls `updateAttributes({ key: localValue })`.
   * For block-embed this calls `commitEdit()`.
   */
  onSaveBeforeExit: () => void;

  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

/** Values returned by the hook. */
interface UseAtomBlockBehaviorReturn {
  deleteBlock: () => void;
  exitBlock: (direction: "down" | "up") => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAtomBlockBehavior({
  editor,
  getPos,
  nodeSize,
  textareaRef,
  onSaveBeforeExit,
  keyboard = {},
  isEmpty,
}: UseAtomBlockBehaviorParams): UseAtomBlockBehaviorReturn {
  const { backspaceOnEmpty = false, horizontalArrowExit = false } = keyboard;

  // Delete this block and move cursor to nearest valid position
  const deleteBlock = useCallback((): void => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const { tr } = editor.state;
    tr.delete(pos, pos + nodeSize);
    const $pos = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
    tr.setSelection(TextSelection.near($pos, -1));
    editor.view.dispatch(tr);
    editor.view.focus();
  }, [editor, getPos, nodeSize]);

  // Exit block: save content and move focus to target position.
  // If exiting downward and no next node exists, insert a new paragraph.
  const exitBlock = useCallback(
    (direction: "down" | "up"): void => {
      const pos = getPos();
      if (typeof pos !== "number") return;

      onSaveBeforeExit();

      if (direction === "up") {
        editor.chain().setTextSelection(pos).focus().run();
      } else {
        const afterPos = pos + nodeSize;
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
    [editor, getPos, nodeSize, onSaveBeforeExit],
  );

  // Keyboard navigation within the textarea
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      const ta = textareaRef.current;
      if (!ta) return;

      if (e.key === "Escape") {
        e.preventDefault();
        exitBlock("down");
        return;
      }

      // Backspace on empty content at cursor position 0 → delete block
      if (
        backspaceOnEmpty &&
        e.key === "Backspace" &&
        ta.selectionStart === 0 &&
        ta.selectionEnd === 0 &&
        isEmpty?.()
      ) {
        e.preventDefault();
        deleteBlock();
        return;
      }

      // ArrowLeft at start → exit up
      if (
        horizontalArrowExit &&
        e.key === "ArrowLeft" &&
        ta.selectionStart === 0 &&
        ta.selectionEnd === 0
      ) {
        e.preventDefault();
        exitBlock("up");
        return;
      }

      // ArrowRight at end → exit down
      if (
        horizontalArrowExit &&
        e.key === "ArrowRight" &&
        ta.selectionStart === ta.value.length
      ) {
        e.preventDefault();
        exitBlock("down");
        return;
      }

      // ArrowUp on first line → exit up
      if (e.key === "ArrowUp") {
        const before = ta.value.substring(0, ta.selectionStart);
        if (!before.includes("\n")) {
          e.preventDefault();
          exitBlock("up");
          return;
        }
      }

      // ArrowDown on last line → exit down
      if (e.key === "ArrowDown") {
        const after = ta.value.substring(ta.selectionStart);
        if (!after.includes("\n")) {
          e.preventDefault();
          exitBlock("down");
          return;
        }
      }
    },
    [
      textareaRef,
      exitBlock,
      deleteBlock,
      backspaceOnEmpty,
      horizontalArrowExit,
      isEmpty,
    ],
  );

  return { deleteBlock, exitBlock, handleKeyDown };
}

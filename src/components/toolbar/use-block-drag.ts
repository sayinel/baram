// §4.8 Block drag-to-reorder hook — mouse-event only (WKWebView HTML5 DnD broken)
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import {
  hideDropIndicator,
  insertNodeAtPos,
  resolveInsertTarget,
  showDropIndicator,
} from "../../utils/editor/drop-indicator";
import { moveBlock } from "../../utils/editor/move-block";

const BLOCK_DRAG_THRESHOLD_PX = 5;

interface DragState {
  active: boolean;
  blockPos: number;
  startX: number;
  startY: number;
}

export function useBlockDrag(editor: Editor): {
  isDragging: boolean;
  startDrag: (e: React.MouseEvent, blockPos: number) => void;
} {
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragRef.current;
      if (!s) return;
      if (!s.active) {
        if (
          Math.abs(e.clientX - s.startX) + Math.abs(e.clientY - s.startY) <=
          BLOCK_DRAG_THRESHOLD_PX
        )
          return;
        s.active = true;
        setIsDragging(true);
        document.body.classList.add("block-dragging");
        window.getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      const target = resolveInsertTarget(editor, e.clientX, e.clientY);
      if (target) showDropIndicator(target);
      else hideDropIndicator();
    };

    const onUp = (e: MouseEvent) => {
      const s = dragRef.current;
      dragRef.current = null;
      hideDropIndicator();
      document.body.classList.remove("block-dragging");
      if (!s || !s.active) {
        setIsDragging(false);
        return; // a click, not a drag — menu toggle handles it
      }
      setIsDragging(false);

      const target = resolveInsertTarget(editor, e.clientX, e.clientY);
      if (!target) return;

      const node = editor.state.doc.nodeAt(s.blockPos);
      if (!node) return;
      const sourceEnd = s.blockPos + node.nodeSize;
      // No-op if dropping into the source's own span.
      if (target.pos >= s.blockPos && target.pos <= sourceEnd) return;

      // List target → delete first, then re-resolve & split-insert.
      const $t = editor.state.doc.resolve(
        Math.min(target.pos, editor.state.doc.content.size),
      );
      const intoList = /^(bulletList|orderedList|taskList)$/.test(
        $t.parent.type.name,
      );
      if (intoList) {
        editor.chain().deleteRange({ from: s.blockPos, to: sourceEnd }).run();
        const after = resolveInsertTarget(editor, e.clientX, e.clientY);
        if (after) insertNodeAtPos(editor, after.pos, node);
      } else {
        moveBlock(editor, s.blockPos, target.pos);
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      hideDropIndicator();
      document.body.classList.remove("block-dragging");
    };
  }, [editor]);

  const startDrag = useCallback((e: React.MouseEvent, blockPos: number) => {
    if (e.button !== 0) return;
    dragRef.current = {
      blockPos,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
  }, []);

  return { isDragging, startDrag };
}

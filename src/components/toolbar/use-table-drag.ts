// §5.5 — drag a column/row grip to reorder (Notion-style). Mouse-event only
// (WKWebView HTML5 DnD is broken), modeled on use-block-drag.ts: a 5px threshold
// distinguishes click (select+popup) from drag (reorder); isDragging clears on a
// setTimeout so the trailing click is suppressed.
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import {
  computeDropIndicatorStyle,
  moveColumn,
  moveRow,
  nearestBoundaryIndex,
} from "./table-selection";

const DRAG_THRESHOLD_PX = 5;

export interface DropIndicatorState {
  axis: "col" | "row";
  boundaryCoord: number;
  tableRect: DOMRect;
}

export interface TableDragSpec {
  axis: "col" | "row";
  /** sorted gridline coords (visual px): x for columns, y for rows. */
  edges: number[];
  from: number;
  tablePos: number;
  tableRect: DOMRect;
}

interface DragRef extends TableDragSpec {
  active: boolean;
  startX: number;
  startY: number;
}

export function useTableDrag(editor: Editor): {
  indicator: DropIndicatorState | null;
  isDragging: boolean;
  startDrag: (e: React.MouseEvent, spec: TableDragSpec) => void;
} {
  const [isDragging, setIsDragging] = useState(false);
  const [indicator, setIndicator] = useState<DropIndicatorState | null>(null);
  const dragRef = useRef<DragRef | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragRef.current;
      if (!s) return;
      if (!s.active) {
        if (
          Math.abs(e.clientX - s.startX) + Math.abs(e.clientY - s.startY) <=
          DRAG_THRESHOLD_PX
        )
          return;
        s.active = true;
        setIsDragging(true);
        document.body.classList.add("table-dragging");
        window.getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      const coord = s.axis === "col" ? e.clientX : e.clientY;
      const bi = nearestBoundaryIndex(s.edges, coord);
      setIndicator({
        axis: s.axis,
        boundaryCoord: s.edges[bi],
        tableRect: s.tableRect,
      });
    };

    const onUp = (e: MouseEvent) => {
      const s = dragRef.current;
      dragRef.current = null;
      setIndicator(null);
      document.body.classList.remove("table-dragging");
      if (!s || !s.active) {
        setIsDragging(false);
        return; // a click — select+popup handles it
      }
      setTimeout(() => setIsDragging(false), 0);
      const coord = s.axis === "col" ? e.clientX : e.clientY;
      const bi = nearestBoundaryIndex(s.edges, coord);
      if (s.axis === "col") moveColumn(editor, s.tablePos, s.from, bi);
      else moveRow(editor, s.tablePos, s.from, bi);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("table-dragging");
    };
  }, [editor]);

  const startDrag = useCallback((e: React.MouseEvent, spec: TableDragSpec) => {
    if (e.button !== 0) return;
    dragRef.current = {
      ...spec,
      active: false,
      startX: e.clientX,
      startY: e.clientY,
    };
  }, []);

  return { indicator, isDragging, startDrag };
}

/** Re-export so consumers get the indicator style from one import site. */
export { computeDropIndicatorStyle };

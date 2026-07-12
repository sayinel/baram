// §5.5 — Notion-style row/column grip handles. Hovering the table's top edge
// shows a grip centered over the hovered column; the left edge shows a grip
// centered on the hovered row. Clicking selects the whole column/row
// (CellSelection), which raises the floating TableToolbar's Selection variant.
// Drag-to-reorder is added by use-table-drag. Uses the position:fixed +
// getEditorZoom() divide pattern. The column grip suppresses itself where it
// would render under the floating table toolbar (table-toolbar-rect.ts).
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import { getEditorZoom } from "../../utils/zoom-coords";
import { findTableNearPoint } from "./table-insert-coords";
import {
  axisHasSpan,
  columnAnchorPos,
  computeHandleStyle,
  type HandleAnchor,
  rowAnchorPos,
  selectColumn,
  selectRow,
} from "./table-selection";
import { getTableToolbarRect, isUnderToolbar } from "./table-toolbar-rect";
import { computeDropIndicatorStyle, useTableDrag } from "./use-table-drag";

// Detection bands around the table's top/left edges (content-space px × zoom).
const BAND_OUTER = 28;
const BAND_INNER = 18;
// Suppress the grip within this distance of a gridline so TableInsertButtons' ⊕ wins.
const BOUNDARY_DEADZONE = 8;

interface HandleState extends HandleAnchor {
  /** cell-before pos of the anchor cell (row 0 for col, col 0 for row). */
  cellPos: number;
  /** logical column/row index the grip labels. */
  index: number;
  /** PM position of the table node. */
  tablePos: number;
}

export function TableSelectionHandles({ editor }: { editor: Editor }) {
  const [handle, setHandle] = useState<HandleState | null>(null);
  const rafRef = useRef(0);
  const latestEventRef = useRef<MouseEvent | null>(null);
  const hoveringRef = useRef(false);
  const hideTimerRef = useRef(0);
  const { indicator, isDragging, startDrag } = useTableDrag(editor);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) return;
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = 0;
      if (!hoveringRef.current) setHandle(null);
    }, 100);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = 0;
    }
  }, []);

  const computeHandle = useCallback(
    (e: MouseEvent) => {
      const zoom = getEditorZoom();
      const mouse = { x: e.clientX, y: e.clientY };
      const tableEl = findTableNearPoint(mouse.x, mouse.y, {
        left: BAND_OUTER * zoom,
        right: 0,
        top: BAND_OUTER * zoom,
        bottom: 0,
      });
      if (!tableEl) {
        if (!hoveringRef.current) setHandle(null);
        return;
      }
      const tablePos = findTablePos(editor, tableEl);
      if (tablePos === null) {
        if (!hoveringRef.current) setHandle(null);
        return;
      }
      const rect = tableEl.getBoundingClientRect();

      const inTop =
        mouse.y >= rect.top - BAND_OUTER * zoom &&
        mouse.y <= rect.top + BAND_INNER * zoom;
      const inLeft =
        mouse.x >= rect.left - BAND_OUTER * zoom &&
        mouse.x <= rect.left + BAND_INNER * zoom;

      if (inTop && mouse.x >= rect.left) {
        // Column grip: which column does x fall into?
        const firstRow = tableEl.querySelector("tr");
        if (!firstRow) return;
        const cells = Array.from(firstRow.children) as HTMLElement[];
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i].getBoundingClientRect();
          if (mouse.x >= c.left && mouse.x <= c.right) {
            // Deadzone near either vertical gridline → let ⊕ handle inserts.
            if (
              mouse.x - c.left < BOUNDARY_DEADZONE * zoom ||
              c.right - mouse.x < BOUNDARY_DEADZONE * zoom
            ) {
              if (!hoveringRef.current) setHandle(null);
              return;
            }
            const cellPos = columnAnchorPos(editor, tablePos, i);
            if (cellPos === null) return;
            // §5.5 — don't place a column grip under the floating toolbar; that
            // real estate belongs to the toolbar (footprint-only suppression).
            const colCenterX = (c.left + c.right) / 2;
            if (isUnderToolbar(colCenterX, rect.top, getTableToolbarRect())) {
              if (!hoveringRef.current) setHandle(null);
              return;
            }
            setHandle({
              axis: "col",
              x: (c.left + c.right) / 2,
              y: rect.top,
              cellPos,
              index: i,
              tablePos,
            });
            return;
          }
        }
      } else if (inLeft && mouse.y >= rect.top) {
        // Row grip: which row does y fall into?
        const rows = Array.from(
          tableEl.querySelectorAll(
            ":scope > thead > tr, :scope > tbody > tr, :scope > tr",
          ),
        ) as HTMLElement[];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].getBoundingClientRect();
          if (mouse.y >= r.top && mouse.y <= r.bottom) {
            if (
              mouse.y - r.top < BOUNDARY_DEADZONE * zoom ||
              r.bottom - mouse.y < BOUNDARY_DEADZONE * zoom
            ) {
              if (!hoveringRef.current) setHandle(null);
              return;
            }
            const cellPos = rowAnchorPos(editor, tablePos, i);
            if (cellPos === null) return;
            setHandle({
              axis: "row",
              x: rect.left,
              y: (r.top + r.bottom) / 2,
              cellPos,
              index: i,
              tablePos,
            });
            return;
          }
        }
      } else if (!hoveringRef.current) {
        setHandle(null);
      }
    },
    [editor],
  );

  useEffect(() => {
    const scroll =
      editor.view.dom.closest(".editor-area-scroll") ??
      document.querySelector(".editor-area-scroll");
    if (!scroll) return;

    const onMove = (e: MouseEvent) => {
      latestEventRef.current = e;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const ev = latestEventRef.current;
        if (ev) computeHandle(ev);
      });
    };
    const onLeave = () => {
      if (!hoveringRef.current) scheduleHide();
    };
    const onScroll = () => {
      setHandle(null);
    };
    scroll.addEventListener("mousemove", onMove as EventListener);
    scroll.addEventListener("mouseleave", onLeave);
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroll.removeEventListener("mousemove", onMove as EventListener);
      scroll.removeEventListener("mouseleave", onLeave);
      scroll.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [editor, computeHandle, scheduleHide]);

  // Clear on doc change / zoom / resize (stale positions).
  useEffect(() => {
    const clear = () => {
      // Also reset the hover ref — onMouseLeave won't fire if the grip is
      // removed/moved by the update (e.g. drag-reorder), so we must reset manually.
      hoveringRef.current = false;
      cancelHide();
      setHandle(null);
    };
    editor.on("update", clear);
    window.addEventListener("resize", clear);
    return () => {
      editor.off("update", clear);
      window.removeEventListener("resize", clear);
    };
  }, [editor, cancelHide]);

  const collectEdges = useCallback(
    (h: HandleState): null | { edges: number[]; tableRect: DOMRect } => {
      const dom = editor.view.nodeDOM(h.tablePos);
      const tableEl =
        dom instanceof HTMLTableElement
          ? dom
          : dom instanceof HTMLElement
            ? dom.querySelector("table")
            : null;
      if (!tableEl) return null;
      const tableRect = tableEl.getBoundingClientRect();
      if (h.axis === "col") {
        const firstRow = tableEl.querySelector("tr");
        if (!firstRow) return null;
        const cells = Array.from(firstRow.children) as HTMLElement[];
        const edges = [cells[0].getBoundingClientRect().left];
        cells.forEach((c) => edges.push(c.getBoundingClientRect().right));
        return { edges, tableRect };
      }
      const rows = Array.from(
        tableEl.querySelectorAll(
          ":scope > thead > tr, :scope > tbody > tr, :scope > tr",
        ),
      ) as HTMLElement[];
      const edges = [rows[0].getBoundingClientRect().top];
      rows.forEach((r) => edges.push(r.getBoundingClientRect().bottom));
      return { edges, tableRect };
    },
    [editor],
  );

  return (
    <>
      {handle && (
        <button
          className={`table-select-handle table-select-handle-${handle.axis}`}
          onClick={() => {
            if (isDragging) return; // a drag just ended
            if (handle.axis === "col") selectColumn(editor, handle.cellPos);
            else selectRow(editor, handle.cellPos);
          }}
          onMouseDown={(e) => {
            if (axisHasSpan(editor, handle.tablePos, handle.axis)) return; // merged → click-only
            const info = collectEdges(handle);
            if (!info) return;
            startDrag(e, {
              axis: handle.axis,
              from: handle.index,
              tablePos: handle.tablePos,
              edges: info.edges,
              tableRect: info.tableRect,
            });
          }}
          onMouseEnter={() => {
            hoveringRef.current = true;
            cancelHide();
          }}
          onMouseLeave={() => {
            hoveringRef.current = false;
            scheduleHide();
          }}
          style={computeHandleStyle(handle, getEditorZoom())}
          title={
            handle.axis === "col"
              ? "Select or drag column"
              : "Select or drag row"
          }
          type="button"
        >
          <svg fill="currentColor" height="10" viewBox="0 0 10 10" width="10">
            <circle cx="2.5" cy="2.5" r="1" />
            <circle cx="5" cy="2.5" r="1" />
            <circle cx="7.5" cy="2.5" r="1" />
            <circle cx="2.5" cy="7.5" r="1" />
            <circle cx="5" cy="7.5" r="1" />
            <circle cx="7.5" cy="7.5" r="1" />
          </svg>
        </button>
      )}
      {indicator && (
        <div
          className="table-drop-indicator"
          style={computeDropIndicatorStyle(
            indicator.axis,
            indicator.boundaryCoord,
            indicator.tableRect,
            getEditorZoom(),
          )}
        />
      )}
    </>
  );
}

/** Resolve the PM position of a table DOM element. */
function findTablePos(
  editor: Editor,
  tableEl: HTMLTableElement,
): null | number {
  let found: null | number = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === "table") {
      const dom = editor.view.nodeDOM(pos);
      if (
        dom === tableEl ||
        (dom instanceof HTMLElement && dom.contains(tableEl))
      ) {
        found = pos;
        return false;
      }
    }
    return true;
  });
  return found;
}

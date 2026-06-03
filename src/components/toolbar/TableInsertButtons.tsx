// §5.5 Table Insert Buttons — hover ⊕ buttons for row/column insertion
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import { TextSelection } from "@tiptap/pm/state";

import { getEditorZoom } from "../../utils/zoom-coords";
import { computeInsertButtonStyle } from "./table-insert-coords";

interface ButtonState {
  /** Whether to insert before (true) or after (false) */
  before: boolean;
  /** PM position of the cell to use for insertion reference */
  cellPos: number;
  type: "col" | "row";
  x: number;
  y: number;
}

interface TableInsertButtonsProps {
  editor: Editor;
}

/** Find the PM position of a cell at given row/col indices within a table */
function findCellPos(
  editor: Editor,
  tablePos: number,
  targetRow: number,
  targetCol: number,
): null | number {
  const tableNode = editor.state.doc.nodeAt(tablePos);
  if (!tableNode) return null;

  let rowIdx = 0;
  let result: null | number = null;

  tableNode.forEach((row, rowOffset) => {
    if (result !== null) return;
    if (rowIdx === targetRow) {
      let colIdx = 0;
      row.forEach((_cell, cellOffset) => {
        if (result !== null) return;
        if (colIdx === targetCol) {
          result = tablePos + 1 + rowOffset + 1 + cellOffset;
        }
        colIdx++;
      });
    }
    rowIdx++;
  });

  return result;
}

/** Find the ProseMirror position for a table DOM element */
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

// Detection zone size around table edges
const DETECT_OUTER = 32; // px outside the table edge (wider for zoom tolerance)
const DETECT_INNER = 16; // px inside the table edge

export function TableInsertButtons({ editor }: TableInsertButtonsProps) {
  const [button, setButton] = useState<ButtonState | null>(null);
  const rafRef = useRef(0);
  const hoveringBtnRef = useRef(false);
  const hideTimerRef = useRef(0);
  // Lock: when a button is visible, keep it stable until mouse leaves the zone.
  const lockedButtonRef = useRef<ButtonState | null>(null);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) return;
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = 0;
      if (!hoveringBtnRef.current) {
        setButton(null);
        lockedButtonRef.current = null;
      }
    }, 100);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = 0;
    }
  }, []);

  const computeButton = useCallback(
    (tableEl: HTMLTableElement, e: MouseEvent) => {
      cancelHide();

      const tablePos = findTablePos(editor, tableEl);
      if (tablePos === null) {
        setButton(null);
        return;
      }

      // §4.2 Zoom: mouse clientX/Y and getBoundingClientRect() are BOTH in
      // visual viewport space inside the CSS-zoom container, so they compare
      // directly with no conversion. Only the detection bands are content-space
      // sizes that scale with zoom — multiply by the zoom factor. No-op at zoom 1.
      const zoom = getEditorZoom();
      const mouse = { x: e.clientX, y: e.clientY };

      const tableRect = tableEl.getBoundingClientRect();
      const nearTop =
        mouse.y >= tableRect.top - DETECT_OUTER * zoom &&
        mouse.y <= tableRect.top + DETECT_INNER * zoom;

      if (nearTop) {
        // Column insert mode: find nearest column boundary
        const firstRow = tableEl.querySelector("tr");
        if (!firstRow) return;
        const cells = Array.from(firstRow.children) as HTMLElement[];

        let bestColIdx = 0;
        let bestX = tableRect.left;
        let bestDist = Infinity;

        if (cells.length > 0) {
          const cellRect = cells[0].getBoundingClientRect();
          const dist = Math.abs(mouse.x - cellRect.left);
          if (dist < bestDist) {
            bestDist = dist;
            bestX = cellRect.left;
            bestColIdx = 0;
          }
        }

        for (let i = 0; i < cells.length; i++) {
          const cellRect = cells[i].getBoundingClientRect();
          const dist = Math.abs(mouse.x - cellRect.right);
          if (dist < bestDist) {
            bestDist = dist;
            bestX = cellRect.right;
            bestColIdx = i + 1;
          }
        }

        const isBeforeFirst = bestColIdx === 0;
        const refCol = isBeforeFirst ? 0 : bestColIdx - 1;
        const cellPos = findCellPos(editor, tablePos, 0, refCol);
        if (cellPos === null) return;

        const colBtn: ButtonState = {
          type: "col",
          x: bestX,
          y: tableRect.top,
          cellPos,
          before: isBeforeFirst,
        };
        setButton(colBtn);
        lockedButtonRef.current = colBtn;
      } else {
        // Row insert mode: find nearest row boundary
        const rows = Array.from(
          tableEl.querySelectorAll(
            ":scope > thead > tr, :scope > tbody > tr, :scope > tr",
          ),
        ) as HTMLElement[];

        let bestRowIdx = 0;
        let bestY = tableRect.top;
        let bestDist = Infinity;

        if (rows.length > 0) {
          const rowRect = rows[0].getBoundingClientRect();
          const dist = Math.abs(mouse.y - rowRect.top);
          if (dist < bestDist) {
            bestDist = dist;
            bestY = rowRect.top;
            bestRowIdx = 0;
          }
        }

        for (let i = 0; i < rows.length; i++) {
          const rowRect = rows[i].getBoundingClientRect();
          const dist = Math.abs(mouse.y - rowRect.bottom);
          if (dist < bestDist) {
            bestDist = dist;
            bestY = rowRect.bottom;
            bestRowIdx = i + 1;
          }
        }

        const isBeforeFirst = bestRowIdx === 0;
        const refRow = isBeforeFirst ? 0 : bestRowIdx - 1;
        const cellPos = findCellPos(editor, tablePos, refRow, 0);
        if (cellPos === null) return;

        const rowBtn: ButtonState = {
          type: "row",
          x: tableRect.left,
          y: bestY,
          cellPos,
          before: isBeforeFirst,
        };
        setButton(rowBtn);
        lockedButtonRef.current = rowBtn;
      }
    },
    [editor, cancelHide],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      // Don't dismiss when hovering the button itself
      if (hoveringBtnRef.current) return;
      if (rafRef.current) return;

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        if (hoveringBtnRef.current) return;

        // §4.2 Zoom: mouse and rects share visual viewport space (no
        // conversion); detection bands and elementFromPoint probe offsets are
        // content-space sizes that scale with zoom — × zoom. No-op at zoom 1.
        const zoom = getEditorZoom();
        const mouse = { x: e.clientX, y: e.clientY };

        const target = e.target as HTMLElement;
        const tableEl = target.closest("table") as HTMLTableElement | null;

        // If a button is already showing and mouse is OUTSIDE the table
        // (in the outer zone, e.g. moving toward the button), keep it locked.
        // But if mouse is INSIDE the table, allow free recomputation so the
        // button follows the mouse to different column/row boundaries.
        if (lockedButtonRef.current && !tableEl) {
          const nearTable =
            (document
              .elementFromPoint(e.clientX + 20 * zoom, e.clientY)
              ?.closest("table") as HTMLTableElement | null) ??
            (document
              .elementFromPoint(e.clientX, e.clientY + 20 * zoom)
              ?.closest("table") as HTMLTableElement | null);

          if (nearTable) {
            const rect = nearTable.getBoundingClientRect();
            const inZone =
              mouse.x >= rect.left - DETECT_OUTER * 2 * zoom &&
              mouse.x <= rect.right + DETECT_OUTER * zoom &&
              mouse.y >= rect.top - DETECT_OUTER * 2 * zoom &&
              mouse.y <= rect.bottom + DETECT_OUTER * zoom;
            if (inZone) {
              cancelHide();
              return; // outside table, near it — keep button locked
            }
          }
          // Too far from any table — clear and hide
          lockedButtonRef.current = null;
          scheduleHide();
          return;
        }

        if (!tableEl) {
          // Mouse left the table — check if we're in the outer detection zone
          const elBelow = document.elementFromPoint(
            e.clientX + 20 * zoom,
            e.clientY,
          );
          const elAbove = document.elementFromPoint(
            e.clientX,
            e.clientY + 20 * zoom,
          );
          const elLeft = document.elementFromPoint(
            e.clientX + 20 * zoom,
            e.clientY + 20 * zoom,
          );
          const nearTable =
            (elBelow?.closest("table") as HTMLTableElement | null) ??
            (elAbove?.closest("table") as HTMLTableElement | null) ??
            (elLeft?.closest("table") as HTMLTableElement | null);

          if (!nearTable) {
            scheduleHide();
            return;
          }

          const rect = nearTable.getBoundingClientRect();
          const inTopZone =
            mouse.y >= rect.top - DETECT_OUTER * zoom &&
            mouse.y <= rect.top + DETECT_INNER * zoom;
          const inLeftZone =
            mouse.x >= rect.left - DETECT_OUTER * zoom &&
            mouse.x <= rect.left + DETECT_INNER * zoom;

          if (!inTopZone && !inLeftZone) {
            scheduleHide();
            return;
          }

          computeButton(nearTable, e);
          return;
        }

        const tableRect = tableEl.getBoundingClientRect();
        const nearTop =
          mouse.y >= tableRect.top - DETECT_OUTER * zoom &&
          mouse.y <= tableRect.top + DETECT_INNER * zoom;
        const nearLeft =
          mouse.x >= tableRect.left - DETECT_OUTER * zoom &&
          mouse.x <= tableRect.left + DETECT_INNER * zoom;

        if (!nearTop && !nearLeft) {
          scheduleHide();
          return;
        }

        computeButton(tableEl, e);
      });
    },
    [cancelHide, scheduleHide, computeButton],
  );

  useEffect(() => {
    const scrollContainer = document.querySelector(".editor-area-scroll");
    if (!scrollContainer) return;

    scrollContainer.addEventListener(
      "mousemove",
      handleMouseMove as EventListener,
    );

    const handleLeave = () => {
      if (!hoveringBtnRef.current) scheduleHide();
    };
    scrollContainer.addEventListener("mouseleave", handleLeave);

    return () => {
      scrollContainer.removeEventListener(
        "mousemove",
        handleMouseMove as EventListener,
      );
      scrollContainer.removeEventListener("mouseleave", handleLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [handleMouseMove, scheduleHide]);

  // Hide on document changes — also reset hover ref since DOM element will be removed
  useEffect(() => {
    const handler = () => {
      hoveringBtnRef.current = false;
      setButton(null);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor]);

  const handleClick = useCallback(() => {
    if (!button) return;

    // Reset hover ref BEFORE removing button from DOM —
    // onMouseLeave won't fire if the element is removed, so we must reset manually
    hoveringBtnRef.current = false;

    // Move selection into the reference cell so table commands work
    const cellNode = editor.state.doc.nodeAt(button.cellPos);
    if (!cellNode) return;
    const insidePos = button.cellPos + 1;
    const tr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, insidePos),
    );
    editor.view.dispatch(tr);

    if (button.type === "col") {
      if (button.before) {
        editor.chain().focus().addColumnBefore().run();
      } else {
        editor.chain().focus().addColumnAfter().run();
      }
    } else {
      if (button.before) {
        editor.chain().focus().addRowBefore().run();
      } else {
        editor.chain().focus().addRowAfter().run();
      }
    }

    setButton(null);
  }, [button, editor]);

  if (!button) return null;

  // §4.2 Zoom-aware positioning — see computeInsertButtonStyle. button.x/y are
  // visual-viewport edge coords; dividing by the zoom factor cancels the
  // render-time zoom× scaling of this position:fixed element. No-op at zoom 1.
  const isCol = button.type === "col";
  const style: React.CSSProperties = computeInsertButtonStyle(
    button,
    getEditorZoom(),
  );

  return (
    <button
      className="table-insert-btn"
      onClick={handleClick}
      onMouseEnter={() => {
        hoveringBtnRef.current = true;
        cancelHide();
      }}
      onMouseLeave={() => {
        hoveringBtnRef.current = false;
        scheduleHide();
      }}
      style={style}
      title={isCol ? "Insert column" : "Insert row"}
    >
      <svg
        fill="none"
        height="12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
        viewBox="0 0 12 12"
        width="12"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line x1="6" x2="6" y1="2" y2="10" />
        <line x1="2" x2="10" y1="6" y2="6" />
      </svg>
    </button>
  );
}

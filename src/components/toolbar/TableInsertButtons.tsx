// §5.5 Table Insert Buttons — hover ⊕ buttons for row/column insertion
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import { TextSelection } from "@tiptap/pm/state";

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
const DETECT_OUTER = 24; // px outside the table edge
const DETECT_INNER = 12; // px inside the table edge

export function TableInsertButtons({ editor }: TableInsertButtonsProps) {
  const [button, setButton] = useState<ButtonState | null>(null);
  const rafRef = useRef(0);
  const hoveringBtnRef = useRef(false);
  const hideTimerRef = useRef(0);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) return;
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = 0;
      if (!hoveringBtnRef.current) {
        setButton(null);
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

      const tableRect = tableEl.getBoundingClientRect();
      const nearTop =
        e.clientY >= tableRect.top - DETECT_OUTER &&
        e.clientY <= tableRect.top + DETECT_INNER;

      if (nearTop) {
        // Column insert mode: find nearest column boundary
        const firstRow = tableEl.querySelector("tr");
        if (!firstRow) return;
        const cells = Array.from(firstRow.children) as HTMLElement[];

        let bestColIdx = 0;
        let bestX = tableRect.left;
        let bestDist = Infinity;

        if (cells.length > 0) {
          const dist = Math.abs(
            e.clientX - cells[0].getBoundingClientRect().left,
          );
          if (dist < bestDist) {
            bestDist = dist;
            bestX = cells[0].getBoundingClientRect().left;
            bestColIdx = 0;
          }
        }

        for (let i = 0; i < cells.length; i++) {
          const dist = Math.abs(
            e.clientX - cells[i].getBoundingClientRect().right,
          );
          if (dist < bestDist) {
            bestDist = dist;
            bestX = cells[i].getBoundingClientRect().right;
            bestColIdx = i + 1;
          }
        }

        const isBeforeFirst = bestColIdx === 0;
        const refCol = isBeforeFirst ? 0 : bestColIdx - 1;
        const cellPos = findCellPos(editor, tablePos, 0, refCol);
        if (cellPos === null) return;

        setButton({
          type: "col",
          x: bestX,
          y: tableRect.top,
          cellPos,
          before: isBeforeFirst,
        });
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
          const dist = Math.abs(
            e.clientY - rows[0].getBoundingClientRect().top,
          );
          if (dist < bestDist) {
            bestDist = dist;
            bestY = rows[0].getBoundingClientRect().top;
            bestRowIdx = 0;
          }
        }

        for (let i = 0; i < rows.length; i++) {
          const dist = Math.abs(
            e.clientY - rows[i].getBoundingClientRect().bottom,
          );
          if (dist < bestDist) {
            bestDist = dist;
            bestY = rows[i].getBoundingClientRect().bottom;
            bestRowIdx = i + 1;
          }
        }

        const isBeforeFirst = bestRowIdx === 0;
        const refRow = isBeforeFirst ? 0 : bestRowIdx - 1;
        const cellPos = findCellPos(editor, tablePos, refRow, 0);
        if (cellPos === null) return;

        setButton({
          type: "row",
          x: tableRect.left,
          y: bestY,
          cellPos,
          before: isBeforeFirst,
        });
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

        const target = e.target as HTMLElement;
        const tableEl = target.closest("table") as HTMLTableElement | null;

        if (!tableEl) {
          // Mouse left the table — check if we're in the outer detection zone
          // by looking for tables near the cursor
          const elBelow = document.elementFromPoint(e.clientX + 20, e.clientY);
          const elRight = document.elementFromPoint(e.clientX, e.clientY + 20);
          const nearTable =
            (elBelow?.closest("table") as HTMLTableElement | null) ??
            (elRight?.closest("table") as HTMLTableElement | null);

          if (!nearTable) {
            scheduleHide();
            return;
          }

          // Check if we're in the outer zone of this nearby table
          const rect = nearTable.getBoundingClientRect();
          const inTopZone =
            e.clientY >= rect.top - DETECT_OUTER &&
            e.clientY <= rect.top + DETECT_INNER;
          const inLeftZone =
            e.clientX >= rect.left - DETECT_OUTER &&
            e.clientX <= rect.left + DETECT_INNER;

          if (!inTopZone && !inLeftZone) {
            scheduleHide();
            return;
          }

          computeButton(nearTable, e);
          return;
        }

        const tableRect = tableEl.getBoundingClientRect();
        const nearTop =
          e.clientY >= tableRect.top - DETECT_OUTER &&
          e.clientY <= tableRect.top + DETECT_INNER;
        const nearLeft =
          e.clientX >= tableRect.left - DETECT_OUTER &&
          e.clientX <= tableRect.left + DETECT_INNER;

        if (!nearTop && !nearLeft) {
          scheduleHide();
          return;
        }

        computeButton(tableEl, e);
      });
    },
    [scheduleHide, computeButton],
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

  // Position: centered on the edge point
  const isCol = button.type === "col";
  const style: React.CSSProperties = {
    left: isCol ? button.x - 10 : button.x - 22,
    top: isCol ? button.y - 22 : button.y - 10,
  };

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

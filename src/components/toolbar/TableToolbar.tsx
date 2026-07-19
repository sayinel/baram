// §5.5 Table Toolbar — floating toolbar shown when cursor is in a table cell
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { Editor } from "@tiptap/react";

import { CellSelection } from "@tiptap/pm/tables";
import { AlignCenter, AlignLeft, AlignRight, Sparkles } from "lucide-react";

import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { showNodeViewAIMenu } from "../../utils/nodeview-ai-menu";
import { buildTableOverflowItems } from "./context-menu-table";
import { MenuList } from "./MenuList";
import { computeToolbarTop } from "./table-toolbar-position";
import { setTableToolbarRect } from "./table-toolbar-rect";

// Mono-style inline SVG icons (16×16, stroke-based)
const ICON_SIZE = 16;
const S = {
  xmlns: "http://www.w3.org/2000/svg",
  width: ICON_SIZE,
  height: ICON_SIZE,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
};

const TABLE_ICON = { size: 16, strokeWidth: 1.5 } as const;
// Merge cells icon: 3×2 grid, middle row merged into one cell
const MergeCellsIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.3}>
    {/* Outer border */}
    <rect height="12" rx="1" width="12" x="2" y="2" />
    {/* Horizontal row dividers (3 rows) */}
    <line x1="2" x2="14" y1="6" y2="6" />
    <line x1="2" x2="14" y1="10" y2="10" />
    {/* Vertical column divider — top and bottom rows only (middle row merged) */}
    <line x1="8" x2="8" y1="2" y2="6" />
    <line x1="8" x2="8" y1="10" y2="14" />
    {/* Highlight merged middle row */}
    <rect
      fill="currentColor"
      height="3.5"
      opacity="0.25"
      rx="0.3"
      stroke="none"
      width="11"
      x="2.5"
      y="6.3"
    />
  </svg>
);
// Split cell icon: 3×2 grid, middle row has dashed vertical divider
const SplitCellsIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.3}>
    {/* Outer border */}
    <rect height="12" rx="1" width="12" x="2" y="2" />
    {/* Horizontal row dividers (3 rows) */}
    <line x1="2" x2="14" y1="6" y2="6" />
    <line x1="2" x2="14" y1="10" y2="10" />
    {/* Vertical column divider — top and bottom rows solid */}
    <line x1="8" x2="8" y1="2" y2="6" />
    <line x1="8" x2="8" y1="10" y2="14" />
    {/* Middle row: dashed divider (about to split) */}
    <line strokeDasharray="1.5 1.5" x1="8" x2="8" y1="6" y2="10" />
  </svg>
);
// Delete row icon: table row with X
const DeleteRowIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.4}>
    <rect height="12" rx="1" width="12" x="2" y="2" />
    <line x1="2" x2="14" y1="6" y2="6" />
    <line x1="2" x2="14" y1="10" y2="10" />
    {/* X mark on middle row */}
    <line
      stroke="currentColor"
      strokeWidth={1.8}
      x1="5"
      x2="11"
      y1="6.5"
      y2="9.5"
    />
    <line
      stroke="currentColor"
      strokeWidth={1.8}
      x1="11"
      x2="5"
      y1="6.5"
      y2="9.5"
    />
  </svg>
);
// Delete column icon: table column with X
const DeleteColIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.4}>
    <rect height="12" rx="1" width="12" x="2" y="2" />
    <line x1="6" x2="6" y1="2" y2="14" />
    <line x1="10" x2="10" y1="2" y2="14" />
    {/* X mark on middle column */}
    <line
      stroke="currentColor"
      strokeWidth={1.8}
      x1="6.5"
      x2="9.5"
      y1="5"
      y2="11"
    />
    <line
      stroke="currentColor"
      strokeWidth={1.8}
      x1="9.5"
      x2="6.5"
      y1="5"
      y2="11"
    />
  </svg>
);
// Overflow icon: horizontal three-dot "more" glyph
const MoreIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.6}>
    <circle cx="3.5" cy="8" fill="currentColor" r="1.1" stroke="none" />
    <circle cx="8" cy="8" fill="currentColor" r="1.1" stroke="none" />
    <circle cx="12.5" cy="8" fill="currentColor" r="1.1" stroke="none" />
  </svg>
);

interface TableToolbarProps {
  editor: Editor;
}

export function TableToolbar({ editor }: TableToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>({
    top: 0,
    left: 0,
  });
  const [currentAlign, setCurrentAlign] = useState<null | string>(null);
  const [isSelection, setIsSelection] = useState(false);
  const [overflow, setOverflow] = useState<null | { x: number; y: number }>(
    null,
  );
  // Mirrors the grip popup's toggle guard: MenuList closes on the ⋯ mousedown
  // (document listener) before onClick fires, so onClick must not re-open when it
  // was already open. Captured in the ⋯ button's onMouseDown.
  const overflowWasOpenRef = useRef(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const { selection } = editor.state;
    const isCellSel = selection instanceof CellSelection;
    setIsSelection(isCellSel);
    const isTable =
      editor.isActive("tableCell") || editor.isActive("tableHeader");

    // Show for: cursor in table (empty selection) OR CellSelection (multi-cell)
    if (!isTable && !isCellSel) {
      setVisible(false);
      return;
    }

    // Hide for regular text selections inside a table cell (FloatingToolbar handles those)
    if (!isCellSel && !selection.empty) {
      setVisible(false);
      return;
    }

    // Find the table DOM node
    const $pos = selection.$from;
    let depth = $pos.depth;
    while (depth > 0 && $pos.node(depth).type.name !== "table") {
      depth--;
    }
    if (depth === 0) {
      setVisible(false);
      return;
    }

    const tablePos = $pos.before(depth);
    const tableDOM = editor.view.nodeDOM(tablePos) as HTMLElement | null;
    if (!tableDOM) {
      setVisible(false);
      return;
    }

    // Get the current cell alignment
    for (let d = $pos.depth; d >= 0; d--) {
      const n = $pos.node(d);
      if (n.type.name === "tableCell" || n.type.name === "tableHeader") {
        setCurrentAlign((n.attrs.alignment as null | string) ?? null);
        break;
      }
    }

    // Position toolbar above the table, clamped to the top of the visible editor
    // area so it stays reachable while scrolling a tall table (§5.5).
    const tableRect = tableDOM.getBoundingClientRect();
    const scrollEl = editor.view.dom.closest(".editor-area-scroll");
    const scrollRect = scrollEl?.getBoundingClientRect();
    if (!scrollRect) {
      setVisible(false);
      return;
    }

    const toolbarHeight = toolbarRef.current?.offsetHeight ?? 32;
    const placement = computeToolbarTop({
      tableTop: tableRect.top,
      tableBottom: tableRect.bottom,
      scrollTop: scrollRect.top,
      scrollHeight: scrollRect.height,
      toolbarHeight,
    });
    if (!placement.visible) {
      setVisible(false);
      return;
    }

    const left = tableRect.left - scrollRect.left + tableRect.width / 2;
    setPosition({ top: placement.top, left });
    setVisible(true);
  }, [editor]);

  useEffect(() => {
    editor.on("selectionUpdate", updatePosition);
    editor.on("transaction", updatePosition);
    const scrollEl = editor.view.dom.closest(".editor-area-scroll");
    scrollEl?.addEventListener("scroll", updatePosition, { passive: true });
    return () => {
      editor.off("selectionUpdate", updatePosition);
      editor.off("transaction", updatePosition);
      scrollEl?.removeEventListener("scroll", updatePosition);
    };
  }, [editor, updatePosition]);

  // §5.5 — publish our rect so TableInsertButtons/TableSelectionHandles can
  // suppress the top-edge ⊕/grip that would render under this toolbar.
  useLayoutEffect(() => {
    setTableToolbarRect(
      visible && toolbarRef.current
        ? toolbarRef.current.getBoundingClientRect()
        : null,
    );
  }, [visible, position]);

  useEffect(() => () => setTableToolbarRect(null), []);

  // Close the ⋯ overflow when the toolbar hides so it can't reopen stale on the
  // next show (the toolbar unmounts its whole tree while hidden).
  useEffect(() => {
    if (!visible) setOverflow(null);
  }, [visible]);

  const setAlign = useCallback(
    (align: null | string) => {
      editor.chain().focus().setCellAttribute("alignment", align).run();
    },
    [editor],
  );

  if (!visible) return null;

  return (
    <>
      <div
        className="table-toolbar"
        onMouseDown={(e) => e.preventDefault()}
        ref={toolbarRef}
        style={{ top: position.top, left: position.left }}
      >
        <button
          className={`table-toolbar-btn icon-btn ${currentAlign === "left" ? "table-toolbar-btn-active" : ""}`}
          onClick={() => setAlign(currentAlign === "left" ? null : "left")}
          title="Align Left"
        >
          <AlignLeft {...TABLE_ICON} />
        </button>
        <button
          className={`table-toolbar-btn ${currentAlign === "center" ? "table-toolbar-btn-active" : ""}`}
          onClick={() => setAlign(currentAlign === "center" ? null : "center")}
          title="Align Center"
        >
          <AlignCenter {...TABLE_ICON} />
        </button>
        <button
          className={`table-toolbar-btn ${currentAlign === "right" ? "table-toolbar-btn-active" : ""}`}
          onClick={() => setAlign(currentAlign === "right" ? null : "right")}
          title="Align Right"
        >
          <AlignRight {...TABLE_ICON} />
        </button>
        {isSelection && (
          <>
            <div className="table-toolbar-separator" />
            <button
              className="table-toolbar-btn"
              disabled={!editor.can().mergeCells()}
              onClick={() => editor.chain().focus().mergeCells().run()}
              title="Merge Cells (⌘M)"
            >
              <MergeCellsIcon />
            </button>
            <button
              className="table-toolbar-btn"
              disabled={!editor.can().splitCell()}
              onClick={() => editor.chain().focus().splitCell().run()}
              title="Split Cell"
            >
              <SplitCellsIcon />
            </button>
          </>
        )}
        <div className="table-toolbar-separator" />
        <button
          className="table-toolbar-btn table-toolbar-btn-danger"
          onClick={() => editor.chain().focus().deleteRow().run()}
          title="Delete Row"
        >
          <DeleteRowIcon />
        </button>
        <button
          className="table-toolbar-btn table-toolbar-btn-danger"
          onClick={() => editor.chain().focus().deleteColumn().run()}
          title="Delete Column"
        >
          <DeleteColIcon />
        </button>
        <div className="table-toolbar-separator" />
        <button
          className="table-toolbar-btn table-toolbar-btn-ai"
          onClick={(e) => {
            const table = findTable(editor);
            if (!table || !table.node) return;
            const tempDoc = editor.schema.nodes.doc.create(null, [table.node]);
            const md = prosemirrorToMarkdown(tempDoc).trim();
            if (!md) return;
            showNodeViewAIMenu(e.currentTarget, "table", md, editor, table.pos);
          }}
          title="AI Commands"
        >
          <Sparkles size={14} />
        </button>
        <div className="table-toolbar-separator" />
        <button
          aria-label="More table options"
          className="table-toolbar-btn"
          onClick={(e) => {
            if (overflowWasOpenRef.current) {
              setOverflow(null);
              return;
            }
            const r = e.currentTarget.getBoundingClientRect();
            setOverflow({ x: r.left, y: r.bottom + 4 });
          }}
          onMouseDown={() => {
            overflowWasOpenRef.current = overflow !== null;
          }}
          title="More"
        >
          <MoreIcon />
        </button>
      </div>
      {overflow && (
        <MenuList
          items={buildTableOverflowItems(editor)}
          onClose={() => setOverflow(null)}
          x={overflow.x}
          y={overflow.y}
        />
      )}
    </>
  );
}

/** Walk up from $from to find the enclosing table node */
function findTable(
  editor: Editor,
): null | { node: ReturnType<typeof editor.state.doc.nodeAt>; pos: number } {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "table") {
      return { node, pos: $from.before(d) };
    }
  }
  return null;
}

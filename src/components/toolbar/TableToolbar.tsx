// §5.5 Table Toolbar — floating toolbar shown when cursor is in a table cell
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { Editor } from "@tiptap/react";

import { CellSelection } from "@tiptap/pm/tables";

import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { showNodeViewAIMenu } from "../../utils/nodeview-ai-menu";

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

const AlignLeftIcon = (): ReactNode => (
  <svg {...S}>
    <line x1="2" x2="14" y1="4" y2="4" />
    <line x1="2" x2="10" y1="8" y2="8" />
    <line x1="2" x2="12" y1="12" y2="12" />
  </svg>
);
const AlignCenterIcon = (): ReactNode => (
  <svg {...S}>
    <line x1="2" x2="14" y1="4" y2="4" />
    <line x1="4" x2="12" y1="8" y2="8" />
    <line x1="3" x2="13" y1="12" y2="12" />
  </svg>
);
const AlignRightIcon = (): ReactNode => (
  <svg {...S}>
    <line x1="2" x2="14" y1="4" y2="4" />
    <line x1="6" x2="14" y1="8" y2="8" />
    <line x1="4" x2="14" y1="12" y2="12" />
  </svg>
);
const TrashIcon = (): ReactNode => (
  <svg {...S}>
    <polyline points="3,5 4,14 12,14 13,5" />
    <line x1="2" x2="14" y1="5" y2="5" />
    <line x1="6" x2="10" y1="3" y2="3" />
  </svg>
);
// Header Row icon: table grid with bold top row
const HeaderRowIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.4}>
    <rect height="12" rx="1" width="12" x="2" y="2" />
    <line x1="2" x2="14" y1="6" y2="6" />
    <line x1="2" x2="14" y1="10" y2="10" />
    <rect
      fill="currentColor"
      height="4"
      opacity="0.25"
      rx="1"
      stroke="none"
      width="12"
      x="2"
      y="2"
    />
  </svg>
);
// Header Column icon: table grid with bold left column
const HeaderColIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.4}>
    <rect height="12" rx="1" width="12" x="2" y="2" />
    <line x1="6" x2="6" y1="2" y2="14" />
    <line x1="10" x2="10" y1="2" y2="14" />
    <rect
      fill="currentColor"
      height="12"
      opacity="0.25"
      rx="1"
      stroke="none"
      width="4"
      x="2"
      y="2"
    />
  </svg>
);
// Merge cells icon: two cells becoming one
const MergeCellsIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.4}>
    <rect height="10" rx="0.5" width="5" x="2" y="3" />
    <rect height="10" rx="0.5" width="5" x="9" y="3" />
    <line x1="7" x2="9" y1="6" y2="8" />
    <line x1="7" x2="9" y1="10" y2="8" />
  </svg>
);
// Split cell icon: one cell becoming two
const SplitCellsIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.4}>
    <rect height="10" rx="0.5" width="10" x="3" y="3" />
    <line strokeDasharray="2 1.5" x1="8" x2="8" y1="3" y2="13" />
  </svg>
);
// Copy as Markdown icon: two overlapping rectangles with "MD" label
const CopyMdIcon = (): ReactNode => (
  <svg
    fill="none"
    height="16"
    viewBox="0 0 22 16"
    width="22"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      height="10"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.3"
      width="13"
      x="1"
      y="1"
    />
    <rect
      fill="var(--color-bg-primary)"
      height="10"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.3"
      width="13"
      x="8"
      y="5"
    />
    <text
      fill="currentColor"
      fontFamily="system-ui, sans-serif"
      fontSize="7"
      fontWeight="700"
      stroke="none"
      textAnchor="middle"
      x="14.5"
      y="12.5"
    >
      MD
    </text>
  </svg>
);
// Copy as HTML icon: two overlapping rectangles with "</>" label
const CopyHtmlIcon = (): ReactNode => (
  <svg
    fill="none"
    height="16"
    viewBox="0 0 22 16"
    width="22"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      height="10"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.3"
      width="13"
      x="1"
      y="1"
    />
    <rect
      fill="var(--color-bg-primary)"
      height="10"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.3"
      width="13"
      x="8"
      y="5"
    />
    <text
      fill="currentColor"
      fontFamily="system-ui, sans-serif"
      fontSize="6.5"
      fontWeight="700"
      stroke="none"
      textAnchor="middle"
      x="14.5"
      y="12.5"
    >
      &lt;/&gt;
    </text>
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
  const toolbarRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const { selection } = editor.state;
    const isCellSel = selection instanceof CellSelection;
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

    // Position toolbar above the table
    const tableRect = tableDOM.getBoundingClientRect();
    const editorRect = editor.view.dom
      .closest(".editor-area-scroll")
      ?.getBoundingClientRect();
    if (!editorRect) {
      setVisible(false);
      return;
    }

    const toolbarHeight = toolbarRef.current?.offsetHeight ?? 32;
    const top = tableRect.top - editorRect.top - toolbarHeight - 6;
    const left = tableRect.left - editorRect.left + tableRect.width / 2;

    setPosition({ top, left });
    setVisible(true);
  }, [editor]);

  useEffect(() => {
    editor.on("selectionUpdate", updatePosition);
    editor.on("transaction", updatePosition);
    return () => {
      editor.off("selectionUpdate", updatePosition);
      editor.off("transaction", updatePosition);
    };
  }, [editor, updatePosition]);

  const setAlign = useCallback(
    (align: null | string) => {
      editor.chain().focus().setCellAttribute("alignment", align).run();
    },
    [editor],
  );

  const handleCopyAsMarkdown = useCallback(() => {
    const table = findTable(editor);
    if (!table || !table.node) return;
    const tempDoc = editor.schema.nodes.doc.create(null, [table.node]);
    const md = prosemirrorToMarkdown(tempDoc);
    navigator.clipboard.writeText(md.trim());
  }, [editor]);

  const handleCopyAsHTML = useCallback(() => {
    const table = findTable(editor);
    if (!table) return;
    const dom = editor.view.nodeDOM(table.pos);
    if (dom && dom instanceof HTMLElement) {
      navigator.clipboard.writeText(dom.outerHTML);
    }
  }, [editor]);

  if (!visible) return null;

  return (
    <div
      className="table-toolbar"
      onMouseDown={(e) => e.preventDefault()}
      ref={toolbarRef}
      style={{ top: position.top, left: position.left }}
    >
      <button
        className={`table-toolbar-btn${currentAlign === "left" ? "table-toolbar-btn-active" : ""}`}
        onClick={() => setAlign(currentAlign === "left" ? null : "left")}
        title="Align Left"
      >
        <AlignLeftIcon />
      </button>
      <button
        className={`table-toolbar-btn${currentAlign === "center" ? "table-toolbar-btn-active" : ""}`}
        onClick={() => setAlign(currentAlign === "center" ? null : "center")}
        title="Align Center"
      >
        <AlignCenterIcon />
      </button>
      <button
        className={`table-toolbar-btn${currentAlign === "right" ? "table-toolbar-btn-active" : ""}`}
        onClick={() => setAlign(currentAlign === "right" ? null : "right")}
        title="Align Right"
      >
        <AlignRightIcon />
      </button>
      <div className="table-toolbar-separator" />
      <button
        className="table-toolbar-btn"
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
        title="Toggle Header Row"
      >
        <HeaderRowIcon />
      </button>
      <button
        className="table-toolbar-btn"
        onClick={() => editor.chain().focus().toggleHeaderColumn().run()}
        title="Toggle Header Column"
      >
        <HeaderColIcon />
      </button>
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
      <div className="table-toolbar-separator" />
      <button
        className="table-toolbar-btn table-toolbar-btn-wide"
        onClick={handleCopyAsMarkdown}
        title="Copy as Markdown"
      >
        <CopyMdIcon />
      </button>
      <button
        className="table-toolbar-btn table-toolbar-btn-wide"
        onClick={handleCopyAsHTML}
        title="Copy as HTML"
      >
        <CopyHtmlIcon />
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
        AI
      </button>
      <div className="table-toolbar-separator" />
      <button
        className="table-toolbar-btn table-toolbar-btn-danger"
        onClick={() => editor.chain().focus().deleteTable().run()}
        title="Delete Table"
      >
        <TrashIcon />
      </button>
    </div>
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

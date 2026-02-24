// §5.5 Table Toolbar — floating toolbar shown when cursor is in a table cell
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";

// Mono-style inline SVG icons (16×16, stroke-based)
const ICON_SIZE = 16;
const S = { xmlns: "http://www.w3.org/2000/svg", width: ICON_SIZE, height: ICON_SIZE, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const };

const AlignLeftIcon = (): ReactNode => (
  <svg {...S}><line x1="2" y1="4" x2="14" y2="4" /><line x1="2" y1="8" x2="10" y2="8" /><line x1="2" y1="12" x2="12" y2="12" /></svg>
);
const AlignCenterIcon = (): ReactNode => (
  <svg {...S}><line x1="2" y1="4" x2="14" y2="4" /><line x1="4" y1="8" x2="12" y2="8" /><line x1="3" y1="12" x2="13" y2="12" /></svg>
);
const AlignRightIcon = (): ReactNode => (
  <svg {...S}><line x1="2" y1="4" x2="14" y2="4" /><line x1="6" y1="8" x2="14" y2="8" /><line x1="4" y1="12" x2="14" y2="12" /></svg>
);
const TrashIcon = (): ReactNode => (
  <svg {...S}><polyline points="3,5 4,14 12,14 13,5" /><line x1="2" y1="5" x2="14" y2="5" /><line x1="6" y1="3" x2="10" y2="3" /></svg>
);

interface TableToolbarProps {
  editor: Editor;
}

export function TableToolbar({ editor }: TableToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [currentAlign, setCurrentAlign] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const { selection } = editor.state;
    const isTable = editor.isActive("tableCell") || editor.isActive("tableHeader");

    // Hide if not in table or if there is a non-cursor text selection (avoid FloatingToolbar clash)
    if (!isTable || !selection.empty) {
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
    const cellNode = $pos.parent;
    if (cellNode.type.name === "tableCell" || cellNode.type.name === "tableHeader") {
      setCurrentAlign((cellNode.attrs.alignment as string | null) ?? null);
    }

    // Position toolbar above the table
    const tableRect = tableDOM.getBoundingClientRect();
    const editorRect = editor.view.dom.closest(".editor-area-scroll")?.getBoundingClientRect();
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
    (align: string | null) => {
      editor.chain().focus().setCellAttribute("alignment", align).run();
    },
    [editor],
  );

  if (!visible) return null;

  return (
    <div
      ref={toolbarRef}
      className="table-toolbar"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        className={`table-toolbar-btn${currentAlign === "left" ? " table-toolbar-btn-active" : ""}`}
        onClick={() => setAlign(currentAlign === "left" ? null : "left")}
        title="Align Left"
      >
        <AlignLeftIcon />
      </button>
      <button
        className={`table-toolbar-btn${currentAlign === "center" ? " table-toolbar-btn-active" : ""}`}
        onClick={() => setAlign(currentAlign === "center" ? null : "center")}
        title="Align Center"
      >
        <AlignCenterIcon />
      </button>
      <button
        className={`table-toolbar-btn${currentAlign === "right" ? " table-toolbar-btn-active" : ""}`}
        onClick={() => setAlign(currentAlign === "right" ? null : "right")}
        title="Align Right"
      >
        <AlignRightIcon />
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

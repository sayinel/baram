import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { Editor } from "@tiptap/react";

import { CellSelection } from "@tiptap/pm/tables";
import { AlignCenter, AlignLeft, AlignRight, Sparkles } from "lucide-react";

// §5.5 Table Toolbar — floating toolbar shown when cursor is in a table cell
import { chainWithVimExternalEdit } from "../../extensions/plugins/vim/vim-keys";
import { useTranslation } from "../../i18n/useTranslation";
import { useCommandLabel } from "../../keybindings/use-command-label";
import { useFeatureFlags } from "../../stores/settings/features";
import {
  canonicalNodeAt,
  serializeDetachedDoc,
} from "../../utils/editor/serialize-live-doc";
import { showNodeViewAIMenu } from "../../utils/nodeview-ai-menu";
import { getEditorZoom } from "../../utils/zoom-coords";
import { Tooltip } from "../Tooltip";
import { buildTableOverflowItems } from "./context-menu-table";
import { MenuList } from "./MenuList";
import {
  DeleteColIcon,
  DeleteRowIcon,
  MergeCellsIcon,
  MoreIcon,
  SplitCellsIcon,
} from "./table-toolbar-icons";
import {
  clampToolbarLeft,
  computeToolbarTop,
  shownTableCenter,
} from "./table-toolbar-position";
import { setTableToolbarRect } from "./table-toolbar-rect";
import { useTableToolbarRelayout } from "./use-table-toolbar-relayout";

const TABLE_ICON = { size: 16, strokeWidth: 1.5 } as const;

/**
 * What one placement decides: whether and where the toolbar shows, over which
 * table, and the cell state its buttons draw. One object so that placement can
 * tell "nothing changed" in one comparison and leave React alone.
 */
interface Placed {
  align: null | string;
  isSelection: boolean;
  left: number;
  /**
   * The `<table>` the toolbar belongs over, for the relayout watch: set while
   * the caret is in a table with an empty or a cell selection — also when the
   * toolbar hides because that table is out of view or no editor area holds
   * it — and null otherwise (outside a table, a text selection inside a cell,
   * a table with no DOM).
   */
  table: HTMLTableElement | null;
  top: number;
  visible: boolean;
}

interface TableToolbarProps {
  editor: Editor;
}

const HIDDEN: Placed = {
  align: null,
  isSelection: false,
  left: 0,
  table: null,
  top: 0,
  visible: false,
};

export function TableToolbar({ editor }: TableToolbarProps) {
  const { t } = useTranslation();
  const commandLabel = useCommandLabel();
  const { ai: aiEnabled } = useFeatureFlags();
  const [placed, setPlaced] = useState<Placed>(HIDDEN);
  const { align: currentAlign, isSelection, visible } = placed;
  const [overflow, setOverflow] = useState<null | { x: number; y: number }>(
    null,
  );
  // The ⋯ button is the popup's toggle: MenuList leaves a mousedown inside it
  // alone (issue 542, `toggleRef`), so onClick sees the real open state and
  // simply flips it — no "was it open at mousedown" bookkeeping.
  const overflowToggleRef = useRef<HTMLButtonElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // The toolbar's size in CSS px (offsetWidth/offsetHeight) as last drawn,
  // which placing it needs: the left clamp its width, `top` its height. Zero
  // until the toolbar has been drawn once; placement and the layout effect
  // below keep it.
  const toolbarSizeRef = useRef({ height: 0, width: 0 });
  // `placed` as last set, for placement to compare against.
  const placedRef = useRef(placed);

  // `relayout`: a change of layout — one the relayout watch reported, or a
  // scroll — with the editor state as it was. A placement equal to the last
  // one sets no state, so React does not render; a drawn toolbar's rect is
  // published again, since the area itself may have moved on screen (a side
  // panel opening) and the ⊕/grip suppression reads it. Every other call (a
  // selection or transaction event, the layout effect) renders a shown
  // toolbar regardless — its buttons read the editor state (`editor.can()`)
  // as they render.
  const place = useCallback(
    (relayout: boolean) => {
      const drawn = toolbarRef.current;
      const commit = (next: Placed) => {
        if (
          samePlaced(placedRef.current, next) &&
          (relayout || !next.visible)
        ) {
          if (drawn && next.visible) {
            setTableToolbarRect(drawn.getBoundingClientRect());
          }
          return;
        }
        placedRef.current = next;
        setPlaced(next);
      };

      const { selection } = editor.state;
      const isCellSel = selection instanceof CellSelection;
      const isTable =
        editor.isActive("tableCell") || editor.isActive("tableHeader");

      // Show for: cursor in table (empty selection) OR CellSelection (multi-cell)
      if (!isTable && !isCellSel) {
        commit(HIDDEN);
        return;
      }

      // Hide for regular text selections inside a table cell (FloatingToolbar handles those)
      if (!isCellSel && !selection.empty) {
        commit(HIDDEN);
        return;
      }

      // Find the table DOM node
      const $pos = selection.$from;
      let depth = $pos.depth;
      while (depth > 0 && $pos.node(depth).type.name !== "table") {
        depth--;
      }
      if (depth === 0) {
        commit(HIDDEN);
        return;
      }

      // The table's NodeView (BaramTableView, a Tiptap TableView) draws
      // `div.tableWrapper > table`. The wrapper is a block as wide as its
      // container — the whole text column for a table at the top level — so only
      // the `<table>` says where the table is across.
      const tablePos = $pos.before(depth);
      const tableDOM = editor.view.nodeDOM(tablePos);
      const tableEl =
        tableDOM instanceof HTMLElement
          ? tableDOM.querySelector<HTMLTableElement>(":scope > table")
          : null;
      if (!(tableDOM instanceof HTMLElement) || !tableEl) {
        commit(HIDDEN);
        return;
      }

      // Get the current cell alignment
      let align: null | string = null;
      for (let d = $pos.depth; d >= 0; d--) {
        const n = $pos.node(d);
        if (n.type.name === "tableCell" || n.type.name === "tableHeader") {
          align = (n.attrs.alignment as null | string) ?? null;
          break;
        }
      }

      // Position toolbar above the table, clamped to the top of the visible editor
      // area so it stays reachable while scrolling a tall table (§5.5), and across
      // over the middle of the part of the table that shows.
      const tableRect = tableEl.getBoundingClientRect();
      const wrapperRect = tableDOM.getBoundingClientRect();
      const scrollEl = editor.view.dom.closest(".editor-area-scroll");
      if (!scrollEl) {
        commit({ ...HIDDEN, table: tableEl });
        return;
      }
      const scrollRect = scrollEl.getBoundingClientRect();
      // The rects are visual px; the toolbar's `top`/`left` are its CSS px, which
      // the editor zoom scales (table-toolbar-position.ts).
      const zoom = getEditorZoom();

      // A drawn toolbar's size is read now: a dial can change it with no render.
      // Before the first draw there is none; 32 is a guess the layout effect
      // corrects before paint.
      if (drawn) {
        toolbarSizeRef.current = {
          height: drawn.offsetHeight,
          width: drawn.offsetWidth,
        };
      }
      const size = toolbarSizeRef.current;
      const toolbarHeight = size.height || 32;
      const placement = computeToolbarTop({
        tableTop: tableRect.top,
        tableBottom: tableRect.bottom,
        scrollTop: scrollRect.top,
        scrollHeight: scrollRect.height,
        toolbarHeight,
        zoom,
      });
      if (!placement.visible) {
        commit({ ...HIDDEN, table: tableEl });
        return;
      }

      const left = clampToolbarLeft({
        areaWidth: scrollEl.clientWidth,
        center: shownTableCenter({
          scrollLeft: scrollRect.left,
          tableLeft: tableRect.left,
          tableRight: tableRect.right,
          wrapperLeft: wrapperRect.left,
          wrapperRight: wrapperRect.right,
          zoom,
        }),
        toolbarWidth: size.width,
      });
      commit({
        align,
        isSelection: isCellSel,
        left,
        table: tableEl,
        top: placement.top,
        visible: true,
      });
    },
    [editor],
  );
  const updatePosition = useCallback(() => place(false), [place]);
  const relayout = useCallback(() => place(true), [place]);

  useEffect(() => {
    editor.on("selectionUpdate", updatePosition);
    editor.on("transaction", updatePosition);
    const scrollEl = editor.view.dom.closest(".editor-area-scroll");
    scrollEl?.addEventListener("scroll", relayout, { passive: true });
    return () => {
      editor.off("selectionUpdate", updatePosition);
      editor.off("transaction", updatePosition);
      scrollEl?.removeEventListener("scroll", relayout);
    };
  }, [editor, updatePosition, relayout]);

  // §5.5 — placing the toolbar needs its size, which only a drawn toolbar has.
  // Measure it here, before paint, and when it differs from the size this
  // placement used (the first show has none; the Selection variant and the AI
  // button change the width), place it again — the setState that follows is
  // drawn before paint too. `.table-toolbar` is `width: max-content`, so its
  // size does not move with `left` and one more pass settles it. Sizes are CSS
  // px, which a zoom change leaves alone. Then publish our rect so
  // TableInsertButtons/TableSelectionHandles can suppress the top-edge ⊕/grip
  // that would render under this toolbar.
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!placed.visible || !el) {
      setTableToolbarRect(null);
      return;
    }
    const size = toolbarSizeRef.current;
    if (el.offsetWidth !== size.width || el.offsetHeight !== size.height) {
      toolbarSizeRef.current = {
        height: el.offsetHeight,
        width: el.offsetWidth,
      };
      updatePosition();
      return;
    }
    setTableToolbarRect(el.getBoundingClientRect());
  }, [placed, aiEnabled, updatePosition]);

  useEffect(() => () => setTableToolbarRect(null), []);

  useTableToolbarRelayout(editor, placed.table, toolbarRef, visible, relayout);

  // Close the ⋯ overflow when the toolbar hides so it can't reopen stale on the
  // next show (the toolbar unmounts its whole tree while hidden).
  useEffect(() => {
    if (!visible) setOverflow(null);
  }, [visible]);

  const setAlign = useCallback(
    (align: null | string) => {
      chainWithVimExternalEdit(editor)
        .focus()
        .setCellAttribute("alignment", align)
        .run();
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
        style={{ top: placed.top, left: placed.left }}
      >
        <Tooltip label={t("tableToolbar.alignLeft")} placement="top">
          <button
            className={`table-toolbar-btn icon-btn ${currentAlign === "left" ? "table-toolbar-btn-active" : ""}`}
            onClick={() => setAlign(currentAlign === "left" ? null : "left")}
          >
            <AlignLeft {...TABLE_ICON} />
          </button>
        </Tooltip>
        <Tooltip label={t("tableToolbar.alignCenter")} placement="top">
          <button
            className={`table-toolbar-btn ${currentAlign === "center" ? "table-toolbar-btn-active" : ""}`}
            onClick={() =>
              setAlign(currentAlign === "center" ? null : "center")
            }
          >
            <AlignCenter {...TABLE_ICON} />
          </button>
        </Tooltip>
        <Tooltip label={t("tableToolbar.alignRight")} placement="top">
          <button
            className={`table-toolbar-btn ${currentAlign === "right" ? "table-toolbar-btn-active" : ""}`}
            onClick={() => setAlign(currentAlign === "right" ? null : "right")}
          >
            <AlignRight {...TABLE_ICON} />
          </button>
        </Tooltip>
        {isSelection && (
          <>
            <div className="table-toolbar-separator" />
            <Tooltip
              label={commandLabel("formatting.tableMerge")}
              placement="top"
            >
              <button
                className="table-toolbar-btn"
                disabled={!editor.can().mergeCells()}
                onClick={() =>
                  chainWithVimExternalEdit(editor).focus().mergeCells().run()
                }
              >
                <MergeCellsIcon />
              </button>
            </Tooltip>
            <Tooltip label={t("tableToolbar.splitCell")} placement="top">
              <button
                className="table-toolbar-btn"
                disabled={!editor.can().splitCell()}
                onClick={() =>
                  chainWithVimExternalEdit(editor).focus().splitCell().run()
                }
              >
                <SplitCellsIcon />
              </button>
            </Tooltip>
          </>
        )}
        <div className="table-toolbar-separator" />
        <Tooltip label={t("tableToolbar.deleteRow")} placement="top">
          <button
            className="table-toolbar-btn table-toolbar-btn-danger"
            onClick={() =>
              chainWithVimExternalEdit(editor).focus().deleteRow().run()
            }
          >
            <DeleteRowIcon />
          </button>
        </Tooltip>
        <Tooltip label={t("tableToolbar.deleteColumn")} placement="top">
          <button
            className="table-toolbar-btn table-toolbar-btn-danger"
            onClick={() =>
              chainWithVimExternalEdit(editor).focus().deleteColumn().run()
            }
          >
            <DeleteColIcon />
          </button>
        </Tooltip>
        <div className="table-toolbar-separator" />
        {aiEnabled && (
          <>
            {/* §338 버튼 + 뒤따르는 구분자를 같은 조건 안에 둔다 — 버튼만
                숨기면 구분자가 허공에 남는다. */}
            <Tooltip label={t("toolbar.ai.commands")} placement="top">
              <button
                className="table-toolbar-btn table-toolbar-btn-ai"
                onClick={(e) => {
                  const table = findTable(editor);
                  if (!table || !table.node) return;
                  // §384: read the CANONICAL table node — if a mark/link/wikilink is
                  // mid-expansion inside a cell, the raw `table.node` still holds the
                  // literal delimiter text and would corrupt this copy.
                  const canonicalTable = canonicalNodeAt(
                    editor.state,
                    table.pos,
                    "table",
                  );
                  if (!canonicalTable) return;
                  const tempDoc = editor.schema.nodes.doc.create(null, [
                    canonicalTable,
                  ]);
                  const md = serializeDetachedDoc(tempDoc).trim();
                  if (!md) return;
                  showNodeViewAIMenu(
                    e.currentTarget,
                    "table",
                    md,
                    editor,
                    table.pos,
                  );
                }}
              >
                <Sparkles size={14} />
              </button>
            </Tooltip>
            <div className="table-toolbar-separator" />
          </>
        )}
        <Tooltip label={t("tableToolbar.more")} placement="top">
          <button
            aria-label={t("tableToolbar.moreOptions")}
            className="table-toolbar-btn"
            onClick={(e) => {
              if (overflow) {
                setOverflow(null);
                return;
              }
              const r = e.currentTarget.getBoundingClientRect();
              setOverflow({ x: r.left, y: r.bottom + 4 });
            }}
            ref={overflowToggleRef}
          >
            <MoreIcon />
          </button>
        </Tooltip>
      </div>
      {overflow && (
        <MenuList
          items={buildTableOverflowItems(editor, t)}
          onClose={() => setOverflow(null)}
          toggleRef={overflowToggleRef}
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

/** Whether two placements decide the same thing. */
function samePlaced(a: Placed, b: Placed): boolean {
  return (
    a.align === b.align &&
    a.isSelection === b.isSelection &&
    a.left === b.left &&
    a.table === b.table &&
    a.top === b.top &&
    a.visible === b.visible
  );
}

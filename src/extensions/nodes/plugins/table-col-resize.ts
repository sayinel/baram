import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * §5.5 Table colwidth initialization plugin.
 *
 * Tables loaded from markdown have no explicit colwidth attributes.
 * This plugin detects such tables after rendering, measures each column's
 * actual width, and writes colwidth attributes so that prosemirror-tables'
 * built-in columnResizing can manage them properly.
 */
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { columnResizingPluginKey } from "@tiptap/pm/tables";

import { COLWIDTH_AUTO_INIT_META } from "../../../utils/editor/programmatic-update";

const pluginKey = new PluginKey("baramTableColwidthInit");

const MIN_COL_WIDTH = 40;

export function createColResizePlugin(): Plugin {
  let initScheduled = false;

  return new Plugin({
    key: pluginKey,
    view() {
      return {
        update(view: EditorView) {
          if (initScheduled) return;
          initScheduled = true;
          requestAnimationFrame(() => {
            initScheduled = false;
            if (view.isDestroyed) return;

            view.state.doc.descendants((node, pos) => {
              if (node.type.name !== "table") return true;
              if (tableHasColwidths(node)) return false;

              const domNode = view.nodeDOM(pos);
              if (!domNode) return false;
              const tableDOM = findTableElement(domNode);
              if (!tableDOM) return false;

              const widths = measureColumnWidths(tableDOM);
              if (widths.length === 0) return false;

              let { tr } = view.state;
              let changed = false;

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              node.forEach((row: any, rowOffset: number) => {
                let colIdx = 0;
                let cellInRowOffset = 0;
                for (let i = 0; i < row.childCount; i++) {
                  const cell = row.child(i);
                  const colspan = (cell.attrs.colspan as number) || 1;
                  const colwidthArr = widths.slice(colIdx, colIdx + colspan);
                  colIdx += colspan;

                  const cellPos = pos + 1 + rowOffset + 1 + cellInRowOffset;
                  tr = tr.setNodeMarkup(cellPos, undefined, {
                    ...cell.attrs,
                    colwidth: colwidthArr,
                    userResized: false,
                  });
                  changed = true;
                  cellInRowOffset += cell.nodeSize;
                }
              });

              if (changed) {
                tr.setMeta("addToHistory", false);
                // Mark as auto-measured colwidth init so the dirty/auto-save
                // handler never treats it as a user edit (these widths are
                // userResized:false and are not serialized to markdown).
                tr.setMeta(COLWIDTH_AUTO_INIT_META, true);
                view.dispatch(tr);
              }
              return false;
            });
          });
        },
      };
    },
  });
}

function findTableElement(domNode: Node): HTMLTableElement | null {
  if ((domNode as HTMLElement).nodeName === "TABLE")
    return domNode as HTMLTableElement;
  return (domNode as HTMLElement).querySelector?.("table") ?? null;
}

function measureColumnWidths(tableDOM: HTMLTableElement): number[] {
  const firstRow = tableDOM.querySelector("tr");
  if (!firstRow) return [];
  const widths: number[] = [];
  for (const cell of Array.from(firstRow.cells)) {
    const colspan = cell.colSpan || 1;
    // offsetWidth is content-space pixels, unaffected by CSS zoom
    const cellWidth = cell.offsetWidth;
    const perCol = Math.round(cellWidth / colspan);
    for (let i = 0; i < colspan; i++) {
      widths.push(Math.max(perCol, MIN_COL_WIDTH));
    }
  }
  return widths;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tableHasColwidths(tableNode: any): boolean {
  const firstRow = tableNode.firstChild;
  if (!firstRow) return true;
  for (let i = 0; i < firstRow.childCount; i++) {
    const cell = firstRow.child(i);
    const cw = cell.attrs.colwidth as null | number[];
    if (!cw || cw.some((w: number) => !w)) return false;
  }
  return true;
}

/**
 * Tracks user-initiated column resizes from prosemirror-tables' columnResizing
 * plugin and marks affected cells with `userResized: true`.
 *
 * This distinguishes user-resized columns (which should be persisted to markdown
 * as `<!-- colwidths:... -->`) from auto-measured columns (which should not).
 *
 * prosemirror-tables' columnResizing plugin dispatches `{setHandle: n}` on
 * every plain mousemove/mouseleave over a table (just to position the resize
 * handle) and `{setDragging: {...} | null}` around an actual drag. Only the
 * latter — specifically the transition to `setDragging: null` (drag end) —
 * means the user actually resized a column; reacting to `setHandle` alone
 * marked every table in the document as user-resized on mere hover.
 */
const userResizeTrackerKey = new PluginKey("baramUserResizeTracker");

export function createUserResizeTracker(): Plugin {
  return new Plugin({
    key: userResizeTrackerKey,
    appendTransaction(
      transactions: readonly Transaction[],
      oldState: EditorState,
      newState: EditorState,
    ) {
      // Only react when a drag just ended (`{setDragging: null}`) — ignore
      // hover-only `{setHandle: n}` meta.
      const dragJustEnded = transactions.some((tr) =>
        isDragEndMeta(tr.getMeta(columnResizingPluginKey)),
      );
      if (!dragJustEnded) return null;

      // Guard against a stray setDragging:null with nothing preceding it:
      // the previous plugin state must actually have been mid-drag. (At
      // mouseup, prosemirror-tables dispatches the colwidth change first and
      // `{setDragging: null}` second, so oldState here still carries the
      // dragging Dragging value from before that second dispatch.)
      const prevResizeState = columnResizingPluginKey.getState(oldState);
      if (!prevResizeState?.dragging) return null;

      const handlePos = prevResizeState.activeHandle;
      if (handlePos == null || handlePos < 0) return null;

      // Resolve the cell that was actually dragged and find its enclosing
      // table — mark ONLY that table's cells, not every table in the doc.
      let $handle;
      try {
        $handle = newState.doc.resolve(handlePos);
      } catch {
        return null;
      }

      let tableDepth = -1;
      for (let d = $handle.depth; d >= 0; d--) {
        if ($handle.node(d).type.name === "table") {
          tableDepth = d;
          break;
        }
      }
      if (tableDepth < 0) return null;

      const tableNode = $handle.node(tableDepth);
      const tablePos = $handle.before(tableDepth);

      let tr = newState.tr;
      let changed = false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tableNode.forEach((row: any, rowOffset: number) => {
        let cellInRowOffset = 0;
        for (let i = 0; i < row.childCount; i++) {
          const cell = row.child(i);
          const cw = cell.attrs.colwidth as null | number[];
          if (cw && !cell.attrs.userResized) {
            const cellPos = tablePos + 1 + rowOffset + 1 + cellInRowOffset;
            tr = tr.setNodeMarkup(cellPos, undefined, {
              ...cell.attrs,
              userResized: true,
            });
            changed = true;
          }
          cellInRowOffset += cell.nodeSize;
        }
      });

      if (changed) {
        tr.setMeta("addToHistory", false);
        return tr;
      }
      return null;
    },
  });
}

/** True when `meta` is the columnResizing plugin's "drag just ended" action. */
function isDragEndMeta(meta: unknown): boolean {
  if (meta == null || typeof meta !== "object") return false;
  if (!("setDragging" in meta)) return false;
  return (meta as { setDragging: unknown }).setDragging == null;
}

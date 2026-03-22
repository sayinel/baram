import type { EditorView } from "@tiptap/pm/view";

/**
 * §5.5 Table colwidth initialization plugin.
 *
 * Tables loaded from markdown have no explicit colwidth attributes.
 * This plugin detects such tables after rendering, measures each column's
 * actual width, and writes colwidth attributes so that prosemirror-tables'
 * built-in columnResizing can manage them properly.
 */
import { Plugin, PluginKey } from "@tiptap/pm/state";

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
                  });
                  changed = true;
                  cellInRowOffset += cell.nodeSize;
                }
              });

              if (changed) {
                tr.setMeta("addToHistory", false);
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

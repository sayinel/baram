import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { TableView } from "@tiptap/extension-table";

/**
 * §5.5 Tiptap's table NodeView, with a column update that also takes away
 * the style a column no longer has.
 *
 * Tiptap's `updateColumns` (3.32.1; 3.33.0 is the same) writes one property
 * on an existing `<col>`: `width` when the column has a colwidth, `min-width`
 * when it has none. It never removes the other. So when a table's colwidths go
 * away and the view updates the table in place, each `<col>` keeps its old
 * `width` and the table goes on drawing it. prosemirror-tables' own version of
 * the function assigns `style.width`, which clears it; Tiptap's rewrite lost
 * that.
 *
 * Two paths reach a table in place with fewer widths than it is drawn with:
 * - turning off column resizing clears the widths of the tables in the
 *   active tab (`buildClearTableWidthsTransaction`), and
 * - a tab switch installs another document with `view.updateState`, and
 *   ProseMirror hands this view the other document's table when the two
 *   tables have the same markup.
 * In both, `createColResizePlugin` then measures the cells, which are still
 * laid out at the old widths, and writes those back as the table's auto
 * widths, so the old widths stay until the view is built again.
 *
 * `update` therefore lets Tiptap do everything it does, and then gives each
 * `<col>` the style the constructor would give a new one for this node: only
 * `width` for a column with a colwidth, only `min-width` for one without.
 *
 * A drag reaches `update` too, though not through its moves: prosemirror-tables
 * draws each move on the `<col>`s itself, without a transaction. But while its
 * resize handle is shown, every transaction updates this view — the handle is a
 * widget decoration built anew for each state, so the table's decorations never
 * compare equal — and the drag starts with one (`setDragging`). Such an update
 * puts a column with a colwidth back at the document's width, as Tiptap's own
 * does, and takes the drawn width off a column without one, where Tiptap left it;
 * the next move draws it again. The width the drag ends on comes back as the
 * column's new colwidth.
 */
export class BaramTableView extends TableView {
  override update(node: ProseMirrorNode): boolean {
    if (!super.update(node)) return false;
    settleColumnStyles(node, this.colgroup, this.cellMinWidth);
    return true;
  }
}

/**
 * Gives every `<col>` under `colgroup` exactly one width property, the one
 * Tiptap's constructor writes for a new column (`getColStyleDeclaration`):
 * `width` (at least `cellMinWidth`) for a column with a colwidth, and
 * `min-width: cellMinWidth` for one without. Columns are walked as
 * `updateColumns` walks them — the first row's cells, one `<col>` per spanned
 * column — after it has already made their number match.
 */
function settleColumnStyles(
  node: ProseMirrorNode,
  colgroup: HTMLTableColElement,
  cellMinWidth: number,
): void {
  const row = node.firstChild;
  if (!row) return;
  let col = colgroup.firstElementChild as HTMLTableColElement | null;
  for (let i = 0; i < row.childCount; i++) {
    const { colspan, colwidth } = row.child(i).attrs as {
      colspan: number;
      colwidth: null | number[];
    };
    for (let j = 0; j < colspan && col; j++) {
      const width = colwidth?.[j];
      const cssWidth = width ? `${Math.max(width, cellMinWidth)}px` : "";
      const cssMinWidth = width ? "" : `${cellMinWidth}px`;
      if (col.style.width !== cssWidth) col.style.width = cssWidth;
      if (col.style.minWidth !== cssMinWidth) col.style.minWidth = cssMinWidth;
      col = col.nextElementSibling as HTMLTableColElement | null;
    }
  }
}

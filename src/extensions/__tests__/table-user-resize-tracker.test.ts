import { Editor } from "@tiptap/core";
import { columnResizingPluginKey } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../index";

// §5.5 table-col-resize — createUserResizeTracker must react ONLY to a real
// drag ending (`{setDragging: null}`), never to hover (`{setHandle: n}`,
// dispatched by prosemirror-tables on every mousemove/mouseleave over a
// table just to position the resize handle), and must mark userResized
// ONLY on the table that was actually dragged.
//
// Regression: reacting to any `tableColumnResizing$` meta (hover included)
// marked EVERY table in the document as user-resized on mere mouse hover,
// writing `<!-- colwidths:... -->` into the saved markdown the user never
// asked for (a 25,095-byte file became 43,158 bytes).
describe("Table column resize tracker: userResized marking", () => {
  let editor: Editor | undefined;
  let host: HTMLElement | undefined;

  afterEach(() => {
    editor?.destroy();
    host?.remove();
    editor = undefined;
    host = undefined;
  });

  function buildTable(width: number) {
    const schema = editor!.schema;
    const cell = (text: string) =>
      schema.nodes.tableCell.create(
        { colwidth: [width], userResized: false },
        schema.nodes.paragraph.create(null, [schema.text(text)]),
      );
    const row = schema.nodes.tableRow.create(null, [cell("a"), cell("b")]);
    return schema.nodes.table.create(null, [row]);
  }

  /** Mounts a doc with two independent one-row tables. */
  function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: createBaramExtensions(),
    });

    const doc = editor.schema.nodes.doc.create(null, [
      buildTable(100),
      buildTable(150),
    ]);
    editor.view.dispatch(
      editor.state.tr.replaceWith(
        0,
        editor.state.doc.content.size,
        doc.content,
      ),
    );
  }

  /** Position right before the first cell of the Nth table (0-indexed). */
  function firstCellPos(tableIndex: number): number {
    let seen = -1;
    let found = -1;
    editor!.state.doc.descendants((node, pos) => {
      if (found !== -1) return false;
      if (node.type.name === "table") {
        seen++;
        return true;
      }
      if (node.type.name === "tableCell" && seen === tableIndex) {
        found = pos;
        return false;
      }
      return true;
    });
    return found;
  }

  /** userResized flags grouped by table, in document order. */
  function userResizedByTable(): boolean[][] {
    const perTable: boolean[][] = [];
    let cur: boolean[] | null = null;
    editor!.state.doc.descendants((node) => {
      if (node.type.name === "table") {
        cur = [];
        perTable.push(cur);
      } else if (node.type.name === "tableCell") {
        cur?.push(node.attrs.userResized as boolean);
      }
    });
    return perTable;
  }

  /** Simulates a real drag-resize on the given cell: hover, mousedown-drag,
   *  the colwidth change prosemirror-tables applies, then mouseup. */
  function dragResize(cellPos: number, newWidth: number) {
    editor!.view.dispatch(
      editor!.state.tr.setMeta(columnResizingPluginKey, {
        setHandle: cellPos,
      }),
    );
    editor!.view.dispatch(
      editor!.state.tr.setMeta(columnResizingPluginKey, {
        setDragging: { startX: 0, startWidth: 100 },
      }),
    );
    const cell = editor!.state.doc.nodeAt(cellPos)!;
    editor!.view.dispatch(
      editor!.state.tr.setNodeMarkup(cellPos, undefined, {
        ...cell.attrs,
        colwidth: [newWidth],
      }),
    );
    editor!.view.dispatch(
      editor!.state.tr.setMeta(columnResizingPluginKey, { setDragging: null }),
    );
  }

  it("hover (`setHandle`) alone leaves every cell's userResized false", () => {
    mount();
    const cellPos = firstCellPos(0);

    editor!.view.dispatch(
      editor!.state.tr.setMeta(columnResizingPluginKey, {
        setHandle: cellPos,
      }),
    );

    for (const flags of userResizedByTable()) {
      expect(flags.every((f) => f === false)).toBe(true);
    }
  });

  it("a full drag sequence sets userResized on the dragged table", () => {
    mount();
    const cellPos = firstCellPos(0);

    dragResize(cellPos, 200);

    const [table1Flags] = userResizedByTable();
    expect(table1Flags.every(Boolean)).toBe(true);
  });

  it("with two tables, a drag in one leaves the other table's cells untouched", () => {
    mount();
    const cellPos = firstCellPos(0);

    dragResize(cellPos, 200);

    const [, table2Flags] = userResizedByTable();
    expect(table2Flags.every((f) => f === false)).toBe(true);
  });
});

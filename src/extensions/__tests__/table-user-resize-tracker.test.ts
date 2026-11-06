import { Editor } from "@tiptap/core";
import { Fragment, type Node as PmNode } from "@tiptap/pm/model";
import { columnResizingPluginKey } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
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

// A press on a column border that ends where it started must not mark the
// table. prosemirror-tables sends `{setDragging: null}` at mouseup even when
// the width is unchanged, so the tracker has to compare the widths itself.
describe("a border press that changes nothing", () => {
  let editor: Editor | undefined;
  let host: HTMLElement | undefined;

  afterEach(() => {
    editor?.destroy();
    host?.remove();
    editor = undefined;
    host = undefined;
  });

  function mountDoc(build: (schema: Editor["schema"]) => PmNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor({ element: host, extensions: createBaramExtensions() });
    const doc = build(editor.schema);
    editor.view.dispatch(
      editor.state.tr.replaceWith(
        0,
        editor.state.doc.content.size,
        doc.content,
      ),
    );
  }

  /** A measured 2x2 table: every cell carries colwidth [100], not marked. */
  function mountMeasuredTable() {
    mountDoc((schema) => {
      const parsed = markdownToProsemirror(
        "| A | B |\n| --- | --- |\n| 1 | 2 |\n",
        schema,
      );
      return withCellAttrs(parsed, () => ({
        colwidth: [100],
        userResized: false,
      }));
    });
  }

  /** Rebuilds `doc` with `attrs(cell)` merged into every table cell. */
  function withCellAttrs(
    doc: PmNode,
    attrs: (cell: PmNode) => Record<string, unknown>,
  ): PmNode {
    const rebuild = (node: PmNode): PmNode => {
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
        return node.type.create(
          { ...node.attrs, ...attrs(node) },
          node.content,
          node.marks,
        );
      }
      if (node.isLeaf) return node;
      const children: PmNode[] = [];
      node.forEach((child) => children.push(rebuild(child)));
      return node.copy(Fragment.from(children));
    };
    return rebuild(doc);
  }

  function firstCellPos(): number {
    let found = -1;
    editor!.state.doc.descendants((node, pos) => {
      if (found !== -1) return false;
      if (node.type.name === "tableHeader" || node.type.name === "tableCell") {
        found = pos;
        return false;
      }
      return true;
    });
    return found;
  }

  function armHandle() {
    editor!.view.dispatch(
      editor!.state.tr.setMeta(columnResizingPluginKey, {
        setHandle: firstCellPos(),
      }),
    );
  }

  function press(clientX: number) {
    editor!.view.dom.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0, clientX }),
    );
  }

  function move(clientX: number) {
    const event = new MouseEvent("mousemove", { bubbles: true, clientX });
    // prosemirror-tables ends the drag on a mousemove whose `which` is 0.
    Object.defineProperty(event, "which", { value: 1 });
    window.dispatchEvent(event);
  }

  function release(clientX: number) {
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX }));
  }

  it("a press and release without moving leaves the document and the markdown alone", () => {
    mountMeasuredTable();
    armHandle();
    const before = editor!.state.doc;

    press(200);
    release(200);

    expect(editor!.state.doc.eq(before)).toBe(true);
    expect(prosemirrorToMarkdown(editor!.state.doc)).not.toContain("colwidths");
  });

  it("a drag that returns to where it started records nothing", () => {
    mountMeasuredTable();
    armHandle();
    const before = editor!.state.doc;

    press(200);
    move(230);
    release(200);

    expect(editor!.state.doc.eq(before)).toBe(true);
  });

  it("a 30px drag is still recorded", () => {
    mountMeasuredTable();
    armHandle();

    press(200);
    release(230);

    expect(prosemirrorToMarkdown(editor!.state.doc).split("\n")[0]).toBe(
      "<!-- colwidths:130,100 -->",
    );
  });

  it("a press on a merged header's border records nothing, and a drag changes its last column", () => {
    mountDoc((schema) => {
      const { nodes } = schema;
      const para = (t: string) =>
        nodes.paragraph.create(null, [schema.text(t)]);
      const attrs = (extra: Record<string, unknown>) => ({
        colspan: 1,
        rowspan: 1,
        colwidth: [100],
        userResized: false,
        ...extra,
      });
      const header = nodes.tableHeader.create(
        attrs({ colspan: 2, colwidth: [100, 100] }),
        para("H"),
      );
      const row = (cells: PmNode[]) => nodes.tableRow.create(null, cells);
      const table = nodes.table.create(null, [
        row([header]),
        row([
          nodes.tableCell.create(attrs({}), para("1")),
          nodes.tableCell.create(attrs({}), para("2")),
        ]),
      ]);
      return nodes.doc.create(null, [table]);
    });
    armHandle();
    const before = editor!.state.doc;

    press(200);
    release(200);
    expect(editor!.state.doc.eq(before)).toBe(true);

    armHandle();
    press(200);
    release(230);
    expect(prosemirrorToMarkdown(editor!.state.doc).split("\n")[0]).toBe(
      "<!-- colwidths:100,130 -->",
    );
  });
});

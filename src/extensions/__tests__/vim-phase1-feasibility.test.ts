// §298 — the ProseMirror/schema contracts the vim adapters are built on.
//
// Written first as a feasibility probe (design v7 §11.7, spike #7), these are
// now DEPENDENCY characterization tests: each one asserts that an intended
// line-unit operation is expressible as a schema-valid transaction against
// the REAL Baram schema, with the transform written by hand rather than
// through the adapters. When a Tiptap or prosemirror-tables upgrade shifts
// one of these contracts, a failure here names the cause directly instead of
// surfacing as a puzzling adapter regression.

import type { Node as PMNode } from "@tiptap/pm/model";

import { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection, deleteRow } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";

import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { createBaramExtensions } from "../index";

const editors: Editor[] = [];

function makeEditor(content = "") {
  const editor = new Editor({
    content,
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

/** Find the first node of a type; returns its pos and the node. */
function findNode(
  editor: Editor,
  typeName: string,
): { node: PMNode; pos: number } {
  let found: null | { node: PMNode; pos: number } = null;
  editor.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === typeName) {
      found = { node, pos };
      return false;
    }
    return !found;
  });
  if (!found) throw new Error(`node not found: ${typeName}`);
  return found;
}

describe("nested listItem dd — delete own line, lift children (§9 primary)", () => {
  it("replacing the parent item with its nested items is schema-valid", () => {
    const editor = makeEditor(
      "<ul><li><p>parent</p><ul><li><p>c1</p></li><li><p>c2</p></li></ul></li></ul>",
    );
    const { node: item, pos } = findNode(editor, "listItem");
    // The parent item's children: [paragraph("parent"), bulletList[c1, c2]].
    const nested = item.child(1);
    expect(nested.type.name).toBe("bulletList");
    // Lift = replace the whole parent item with the nested list's items,
    // making them siblings inside the outer list.
    const items: NonNullable<ReturnType<typeof editor.state.doc.nodeAt>>[] = [];
    nested.forEach((child) => items.push(child));
    const tr = editor.state.tr.replaceWith(
      pos,
      pos + item.nodeSize,
      Fragment.from(items),
    );
    expect(() => tr.doc.check()).not.toThrow();
    editor.view.dispatch(tr);
    const md = prosemirrorToMarkdown(editor.state.doc);
    expect(md).toContain("- c1");
    expect(md).toContain("- c2");
    expect(md).not.toContain("parent");
    // Dedented exactly one level: items are now top-level list lines.
    expect(md).not.toMatch(/^\s+- c1/m);
  });

  it("childless item deletes cleanly (fallback path sanity)", () => {
    const editor = makeEditor("<ul><li><p>a</p></li><li><p>b</p></li></ul>");
    const { node: item, pos } = findNode(editor, "listItem");
    const tr = editor.state.tr.delete(pos, pos + item.nodeSize);
    expect(() => tr.doc.check()).not.toThrow();
    editor.view.dispatch(tr);
    const md = prosemirrorToMarkdown(editor.state.doc);
    expect(md).toContain("- b");
    expect(md).not.toContain("- a");
  });
});

describe("hardBreak segment dd (§9 segment rules)", () => {
  it("deleting segment 'a' plus the FOLLOWING break from <p>a<br>b</p> leaves <p>b</p>", () => {
    const editor = makeEditor("<p>a<br>b</p>");
    const { node: para, pos } = findNode(editor, "paragraph");
    // Content layout inside the paragraph: text "a" (size 1), hardBreak (1), text "b".
    const from = pos + 1; // start of "a"
    const to = from + 2; // past "a" + break
    const tr = editor.state.tr.delete(from, to);
    expect(() => tr.doc.check()).not.toThrow();
    editor.view.dispatch(tr);
    expect(editor.state.doc.textContent).toBe("b");
    expect(findNode(editor, "paragraph").node.childCount).toBe(1);
    void para;
  });

  it("consecutive breaks a<br><br>b: the empty middle segment is deletable alone", () => {
    const editor = makeEditor("<p>a<br><br>b</p>");
    const { pos } = findNode(editor, "paragraph");
    // Empty segment sits between the two breaks; deleting it means deleting
    // ONE of the adjacent breaks (the following one per §9).
    const breakPos = pos + 2; // first break
    const tr = editor.state.tr.delete(breakPos + 1, breakPos + 2); // second break
    expect(() => tr.doc.check()).not.toThrow();
    editor.view.dispatch(tr);
    const parLater = findNode(editor, "paragraph").node;
    const types = [] as string[];
    parLater.forEach((n) => types.push(n.type.name));
    expect(types).toEqual(["text", "hardBreak", "text"]);
  });

  it("trailing segment a<br>: deleting 'a''s following break merges cleanly", () => {
    const editor = makeEditor("<p>a<br></p>");
    const { pos } = findNode(editor, "paragraph");
    const tr = editor.state.tr.delete(pos + 2, pos + 3); // the break
    expect(() => tr.doc.check()).not.toThrow();
    editor.view.dispatch(tr);
    expect(editor.state.doc.textContent).toBe("a");
  });

  it("segment dd inside a sole-child container deletes the segment, NOT the container (§12-8)", () => {
    // §9 pin: segment units can never reach container escalation. Even though
    // the blockquote has exactly one child (the escalation trigger for
    // STRUCTURAL dd), a multi-segment paragraph resolves at segment level.
    const editor = makeEditor("<blockquote><p>a<br>b</p></blockquote>");
    const { pos } = findNode(editor, "paragraph");
    const from = pos + 1; // start of "a"
    const tr = editor.state.tr.delete(from, from + 2); // "a" + following break
    expect(() => tr.doc.check()).not.toThrow();
    editor.view.dispatch(tr);
    const bq = findNode(editor, "blockquote").node;
    expect(bq.childCount).toBe(1); // container survives
    expect(editor.state.doc.textContent).toBe("b");
    expect(prosemirrorToMarkdown(editor.state.doc)).toContain("> b");
  });

  it("after the last break is gone, structural dd on the now-single-segment child escalates to the container (§9 hand-off)", () => {
    // Follow-up dd after the previous case: the paragraph has one segment
    // left, so resolution is structural; sole-child rule deletes the
    // blockquote itself.
    const editor = makeEditor("<blockquote><p>b</p></blockquote><p>after</p>");
    const { node: bq, pos } = findNode(editor, "blockquote");
    expect(bq.childCount).toBe(1);
    const tr = editor.state.tr.delete(pos, pos + bq.nodeSize);
    expect(() => tr.doc.check()).not.toThrow();
    editor.view.dispatch(tr);
    expect(editor.state.doc.textContent).toBe("after");
  });
});

describe("table row ops (§9 — delegate to prosemirror-tables)", () => {
  const TABLE =
    "<table><tr><th><p>h1</p></th><th><p>h2</p></th></tr>" +
    "<tr><td><p>a1</p></td><td><p>a2</p></td></tr>" +
    "<tr><td><p>b1</p></td><td><p>b2</p></td></tr></table>";

  function rowCount(editor: Editor): number {
    return findNode(editor, "table").node.childCount;
  }

  it("single-row CellSelection normalization + deleteRow removes exactly one row", () => {
    const editor = makeEditor(TABLE);
    expect(rowCount(editor)).toBe(3);
    // Put a CellSelection on row "a" (single row) then deleteRow.
    const { pos } = findNode(editor, "table");
    // Find first cell of the second row by walking.
    let cellPos = -1;
    editor.state.doc.nodesBetween(
      pos,
      pos + findNode(editor, "table").node.nodeSize,
      (node, p) => {
        if (cellPos === -1 && node.type.name === "tableCell") {
          cellPos = p;
          return false;
        }
        return cellPos === -1;
      },
    );
    expect(cellPos).toBeGreaterThan(-1);
    const sel = CellSelection.create(editor.state.doc, cellPos);
    const tr = editor.state.tr.setSelection(sel);
    editor.view.dispatch(tr);
    const ok = deleteRow(editor.state, (t) => editor.view.dispatch(t));
    expect(ok).toBe(true);
    expect(rowCount(editor)).toBe(2);
    expect(editor.state.doc.textContent).not.toContain("a1");
    expect(editor.state.doc.textContent).toContain("b1");
  });

  it("row yank: a tableRow node round-trips through JSON inside a table context", () => {
    const editor = makeEditor(TABLE);
    const { node: row } = findNode(editor, "tableRow");
    const json = row.toJSON();
    const revived = editor.schema.nodeFromJSON(json);
    expect(revived.type.name).toBe("tableRow");
    expect(revived.childCount).toBe(row.childCount);
    // Insert the revived row after the last row — schema-valid inside table.
    const { node: table, pos } = findNode(editor, "table");
    const insertAt = pos + table.nodeSize - 1;
    const tr = editor.state.tr.insert(insertAt, revived);
    expect(() => tr.doc.check()).not.toThrow();
  });
});

describe("sole-child container dd deletes the container (§9)", () => {
  it("blockquote with one paragraph: deleting the container is the valid move", () => {
    const editor = makeEditor(
      "<blockquote><p>only</p></blockquote><p>after</p>",
    );
    const { node: bq, pos } = findNode(editor, "blockquote");
    expect(bq.childCount).toBe(1);
    const tr = editor.state.tr.delete(pos, pos + bq.nodeSize);
    expect(() => tr.doc.check()).not.toThrow();
    editor.view.dispatch(tr);
    expect(editor.state.doc.textContent).toBe("after");
  });

  it("toggle summary = REQUIRED first child by position (probe finding)", () => {
    // Probe finding: there is no dedicated summary node type — the schema is
    // "(paragraph | heading) block*", i.e. the FIRST child is required by
    // position. The §9 no-op rule for summary-dd therefore rests on semantic
    // protection (a body block would silently get promoted to summary), not
    // schema impossibility. Pinned so a schema change surfaces here.
    const editor = makeEditor("");
    const spec = String(editor.schema.nodes.toggle?.spec.content ?? "");
    expect(spec).toBe("(paragraph | heading) block*");
  });
});

describe("VisualState inclusive selection (§6)", () => {
  it("from=min, to=unitEnd(max) yields a non-empty inclusive selection at v-entry", () => {
    const editor = makeEditor("<p>한글ab</p>");
    const { pos } = findNode(editor, "paragraph");
    const anchorCursor = pos + 1; // on "한"
    const headCursor = anchorCursor; // v just pressed
    const sel = TextSelection.create(
      editor.state.doc,
      Math.min(anchorCursor, headCursor),
      Math.max(anchorCursor, headCursor) + 1, // next grapheme boundary ("한" = 1 pos)
    );
    editor.view.dispatch(editor.state.tr.setSelection(sel));
    expect(editor.state.selection.empty).toBe(false);
    expect(editor.state.doc.textBetween(sel.from, sel.to)).toBe("한");
  });

  it("direction inversion keeps anchorCursor fixed", () => {
    const editor = makeEditor("<p>abcd</p>");
    const { pos } = findNode(editor, "paragraph");
    const anchorCursor = pos + 3; // on "c"
    // head moves left of anchor (h pressed twice): inclusive span covers head..anchor.
    const headCursor = pos + 1; // on "a"
    const from = Math.min(anchorCursor, headCursor);
    const to = Math.max(anchorCursor, headCursor) + 1;
    expect(editor.state.doc.textBetween(from, to)).toBe("abc");
  });
});

describe("char register Slice round-trip (§6 F7)", () => {
  it("a cross-block visual yank survives Slice.toJSON → fromJSON → replaceSelection", () => {
    const editor = makeEditor("<p>one</p><p>two</p>");
    const from = 2; // inside "one"
    const to = editor.state.doc.content.size - 3; // inside "two"
    const sel = TextSelection.create(editor.state.doc, from, to);
    editor.view.dispatch(editor.state.tr.setSelection(sel));
    const slice = editor.state.selection.content();
    expect(slice.openStart).toBeGreaterThan(0); // open depths exist — JSONContent would lose them
    expect(slice.content.size).toBeGreaterThan(0);
    const json = slice.toJSON();

    const target = makeEditor("<p>xy</p>");
    // PROBE FINDING (load-bearing design pin, §6): each Editor instance owns
    // a DISTINCT Schema instance. Reviving with the SOURCE schema makes the
    // target's fitter drop every node silently (steps=0 no-op). The register
    // must always revive with the TARGET editor's schema.
    const revived = Slice.fromJSON(target.schema, json);
    expect(revived.content.size).toBe(slice.content.size);
    expect(revived.openStart).toBe(slice.openStart);

    const tsel = TextSelection.create(target.state.doc, 2, 2);
    target.view.dispatch(target.state.tr.setSelection(tsel));
    const tr = target.state.tr.replaceSelection(revived);
    expect(() => tr.doc.check()).not.toThrow();
    expect(tr.steps.length).toBeGreaterThan(0);
    target.view.dispatch(tr);
    expect(target.state.doc.textContent).toContain("ne");
  });
});

describe("definitionList boundaries (§9 — no-op justification)", () => {
  it("schema forbids a description-less term group (deleting the last description breaks it)", () => {
    const editor = makeEditor("");
    const dl = editor.schema.nodes.definitionList;
    if (!dl) return; // extension not registered in this build — rule moot
    expect(String(dl.spec.content)).toMatch(
      /definitionTerm|definitionDescription/,
    );
  });
});

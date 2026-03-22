import { Schema } from "@tiptap/pm/model";
// Table colwidth HTML comment persistence tests
// Verifies <!-- colwidths:... --> roundtrip between markdown and ProseMirror
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

// Schema with table nodes including colwidth + userResized attributes
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    table: { content: "tableRow+", group: "block" },
    tableRow: { content: "(tableCell | tableHeader)+" },
    tableCell: {
      content: "paragraph+",
      attrs: {
        alignment: { default: null },
        colspan: { default: 1 },
        colwidth: { default: null },
        rowspan: { default: 1 },
        userResized: { default: false },
      },
    },
    tableHeader: {
      content: "paragraph+",
      attrs: {
        alignment: { default: null },
        colspan: { default: 1 },
        colwidth: { default: null },
        rowspan: { default: 1 },
        userResized: { default: false },
      },
    },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    code: { excludes: "_" },
    strike: {},
    link: {
      attrs: {
        href: { default: null },
        title: { default: null },
      },
      inclusive: false,
    },
  },
});

/** Helper: roundtrip a markdown string and compare */
function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

describe("Table colwidth HTML comment persistence", () => {
  it("roundtrip: table without colwidths has no comment", () => {
    const input = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    const output = roundtrip(input);
    expect(output).not.toContain("<!-- colwidths:");
    // Content preserved
    expect(output).toContain("| A");
    expect(output).toContain("| B");
  });

  it("parse: colwidths comment before table sets colwidth attrs", () => {
    const md =
      "<!-- colwidths:200,300 -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    const doc = markdownToProsemirror(md, schema);

    // Find table node
    let tableNode = null as null | ReturnType<typeof doc.nodeAt>;
    doc.descendants((node) => {
      if (node.type.name === "table") {
        tableNode = node;
        return false;
      }
      return true;
    });
    expect(tableNode).not.toBeNull();

    // Check first row header cells have colwidth and userResized
    const firstRow = tableNode!.firstChild!;
    const cell0 = firstRow.child(0);
    const cell1 = firstRow.child(1);

    expect(cell0.attrs.colwidth).toEqual([200]);
    expect(cell0.attrs.userResized).toBe(true);
    expect(cell1.attrs.colwidth).toEqual([300]);
    expect(cell1.attrs.userResized).toBe(true);

    // Body cells should also have colwidth applied
    const bodyRow = tableNode!.child(1);
    expect(bodyRow.child(0).attrs.colwidth).toEqual([200]);
    expect(bodyRow.child(0).attrs.userResized).toBe(true);
    expect(bodyRow.child(1).attrs.colwidth).toEqual([300]);
    expect(bodyRow.child(1).attrs.userResized).toBe(true);
  });

  it("serialize: table with userResized colwidth emits comment", () => {
    // Build a PM table with colwidth + userResized: true
    const headerCells = [
      schema.nodes.tableHeader.create(
        { colwidth: [200], userResized: true },
        schema.nodes.paragraph.create(null, [schema.text("A")]),
      ),
      schema.nodes.tableHeader.create(
        { colwidth: [300], userResized: true },
        schema.nodes.paragraph.create(null, [schema.text("B")]),
      ),
    ];
    const bodyCells = [
      schema.nodes.tableCell.create(
        { colwidth: [200], userResized: true },
        schema.nodes.paragraph.create(null, [schema.text("1")]),
      ),
      schema.nodes.tableCell.create(
        { colwidth: [300], userResized: true },
        schema.nodes.paragraph.create(null, [schema.text("2")]),
      ),
    ];
    const tableNode = schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, headerCells),
      schema.nodes.tableRow.create(null, bodyCells),
    ]);
    const doc = schema.nodes.doc.create(null, [tableNode]);

    const output = prosemirrorToMarkdown(doc);
    expect(output).toContain("<!-- colwidths:200,300 -->");
    expect(output).toContain("| A | B |");
  });

  it("serialize: table with auto colwidth (userResized: false) emits no comment", () => {
    // Build a PM table with colwidth but userResized: false (auto-measured)
    const headerCells = [
      schema.nodes.tableHeader.create(
        { colwidth: [200], userResized: false },
        schema.nodes.paragraph.create(null, [schema.text("A")]),
      ),
      schema.nodes.tableHeader.create(
        { colwidth: [300], userResized: false },
        schema.nodes.paragraph.create(null, [schema.text("B")]),
      ),
    ];
    const bodyCells = [
      schema.nodes.tableCell.create(
        { colwidth: [200], userResized: false },
        schema.nodes.paragraph.create(null, [schema.text("1")]),
      ),
      schema.nodes.tableCell.create(
        { colwidth: [300], userResized: false },
        schema.nodes.paragraph.create(null, [schema.text("2")]),
      ),
    ];
    const tableNode = schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, headerCells),
      schema.nodes.tableRow.create(null, bodyCells),
    ]);
    const doc = schema.nodes.doc.create(null, [tableNode]);

    const output = prosemirrorToMarkdown(doc);
    expect(output).not.toContain("<!-- colwidths:");
  });

  it("roundtrip: colwidths comment survives roundtrip", () => {
    const md =
      "<!-- colwidths:200,300 -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    const firstPass = roundtrip(md);
    expect(firstPass).toContain("<!-- colwidths:200,300 -->");
    // Second roundtrip should be stable
    const secondPass = roundtrip(firstPass);
    expect(secondPass).toBe(firstPass);
  });

  it("roundtrip: colwidths with 3 columns", () => {
    const md =
      "<!-- colwidths:100,200,150 -->\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n";
    const firstPass = roundtrip(md);
    expect(firstPass).toContain("<!-- colwidths:100,200,150 -->");
    expect(roundtrip(firstPass)).toBe(firstPass);
  });

  it("parse: mismatched colwidths count is ignored", () => {
    // 3 colwidths but 2 columns → should ignore the comment
    const md =
      "<!-- colwidths:100,200,150 -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    const doc = markdownToProsemirror(md, schema);

    let tableNode = null as null | ReturnType<typeof doc.nodeAt>;
    doc.descendants((node) => {
      if (node.type.name === "table") {
        tableNode = node;
        return false;
      }
      return true;
    });
    expect(tableNode).not.toBeNull();

    // Cells should NOT have colwidth set (mismatched count)
    const firstRow = tableNode!.firstChild!;
    expect(firstRow.child(0).attrs.colwidth).toBeNull();
    expect(firstRow.child(0).attrs.userResized).toBe(false);
  });

  it("parse: colwidths comment not immediately before table is ignored", () => {
    // Comment then paragraph then table → colwidths should not apply
    const md =
      "<!-- colwidths:200,300 -->\n\nSome paragraph\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    const doc = markdownToProsemirror(md, schema);

    let tableNode = null as null | ReturnType<typeof doc.nodeAt>;
    doc.descendants((node) => {
      if (node.type.name === "table") {
        tableNode = node;
        return false;
      }
      return true;
    });
    expect(tableNode).not.toBeNull();

    const firstRow = tableNode!.firstChild!;
    expect(firstRow.child(0).attrs.colwidth).toBeNull();
    expect(firstRow.child(0).attrs.userResized).toBe(false);
  });

  it("serialize: mixed userResized — some true, some false — emits comment", () => {
    // Only header has userResized: true, body doesn't matter for detection
    // (we check first row only in extractTableColwidths)
    const headerCells = [
      schema.nodes.tableHeader.create(
        { colwidth: [200], userResized: true },
        schema.nodes.paragraph.create(null, [schema.text("A")]),
      ),
      schema.nodes.tableHeader.create(
        { colwidth: [300], userResized: false },
        schema.nodes.paragraph.create(null, [schema.text("B")]),
      ),
    ];
    const bodyCells = [
      schema.nodes.tableCell.create(
        {},
        schema.nodes.paragraph.create(null, [schema.text("1")]),
      ),
      schema.nodes.tableCell.create(
        {},
        schema.nodes.paragraph.create(null, [schema.text("2")]),
      ),
    ];
    const tableNode = schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, headerCells),
      schema.nodes.tableRow.create(null, bodyCells),
    ]);
    const doc = schema.nodes.doc.create(null, [tableNode]);

    const output = prosemirrorToMarkdown(doc);
    expect(output).toContain("<!-- colwidths:200,300 -->");
  });

  it("serialize: table with all-zero colwidths emits no comment", () => {
    const headerCells = [
      schema.nodes.tableHeader.create(
        { colwidth: [0], userResized: true },
        schema.nodes.paragraph.create(null, [schema.text("A")]),
      ),
      schema.nodes.tableHeader.create(
        { colwidth: [0], userResized: true },
        schema.nodes.paragraph.create(null, [schema.text("B")]),
      ),
    ];
    const tableNode = schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, headerCells),
    ]);
    const doc = schema.nodes.doc.create(null, [tableNode]);

    const output = prosemirrorToMarkdown(doc);
    expect(output).not.toContain("<!-- colwidths:");
  });
});

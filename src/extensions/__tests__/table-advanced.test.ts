import { Schema } from "@tiptap/pm/model";
// §5.5 M10 Table Advanced — cell merge tests
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

// Schema with table nodes including colspan/rowspan
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      marks: "_",
      attrs: { blockId: { default: null } },
    },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 }, blockId: { default: null } },
    },
    table: { content: "tableRow+", group: "block" },
    tableRow: { content: "(tableCell | tableHeader)+" },
    tableCell: {
      content: "paragraph+",
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        alignment: { default: null },
      },
    },
    tableHeader: {
      content: "paragraph+",
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        alignment: { default: null },
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
      attrs: { href: { default: null }, title: { default: null } },
      inclusive: false,
    },
  },
});

/** Count inner cells in a GFM table row like `| A | B |` */
function countInnerCells(line: string): string[] {
  return line
    .split("|")
    .map((s) => s.trim())
    .filter((_s, i, arr) => i > 0 && i < arr.length - 1);
}

function roundtrip(md: string): string {
  const doc = markdownToProsemirror(md, schema);
  return prosemirrorToMarkdown(doc);
}

describe("Table Advanced — cell merge (§5.5 M10)", () => {
  describe("PM→MD grid decomposition: colspan", () => {
    it("colspan=2 header expands to 2 separate cells in markdown", () => {
      // Build a PM table: 1 header row with 1 merged cell (colspan=2), 1 body row with 2 cells
      const mergedHeader = schema.nodes.tableHeader.create(
        { colspan: 2, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("Merged")])],
      );
      const headerRow = schema.nodes.tableRow.create(null, [mergedHeader]);

      const cell1 = schema.nodes.tableCell.create(
        { colspan: 1, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("A")])],
      );
      const cell2 = schema.nodes.tableCell.create(
        { colspan: 1, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("B")])],
      );
      const bodyRow = schema.nodes.tableRow.create(null, [cell1, cell2]);

      const table = schema.nodes.table.create(null, [headerRow, bodyRow]);
      const doc = schema.nodes.doc.create(null, [table]);

      const md = prosemirrorToMarkdown(doc);

      // The header row must have 2 columns in the output
      const lines = md.trim().split("\n");
      const headerCells = countInnerCells(lines[0]);
      expect(headerCells).toHaveLength(2);
    });

    it("colspan=3 header expands to 3 separate cells", () => {
      const mergedHeader = schema.nodes.tableHeader.create(
        { colspan: 3, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("Wide")])],
      );
      const headerRow = schema.nodes.tableRow.create(null, [mergedHeader]);

      const bodyCells = [1, 2, 3].map((n) =>
        schema.nodes.tableCell.create(
          { colspan: 1, rowspan: 1, alignment: null },
          [schema.nodes.paragraph.create(null, [schema.text(String(n))])],
        ),
      );
      const bodyRow = schema.nodes.tableRow.create(null, bodyCells);

      const table = schema.nodes.table.create(null, [headerRow, bodyRow]);
      const doc = schema.nodes.doc.create(null, [table]);

      const md = prosemirrorToMarkdown(doc);
      const lines = md.trim().split("\n");
      const headerCells = countInnerCells(lines[0]);
      expect(headerCells).toHaveLength(3);
    });

    it("colspan=2 body cell expands to 2 cells, second cell empty", () => {
      // Header row: 2 normal headers
      const h1 = schema.nodes.tableHeader.create(
        { colspan: 1, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("H1")])],
      );
      const h2 = schema.nodes.tableHeader.create(
        { colspan: 1, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("H2")])],
      );
      const headerRow = schema.nodes.tableRow.create(null, [h1, h2]);

      // Body row: 1 merged cell spanning 2 columns
      const mergedCell = schema.nodes.tableCell.create(
        { colspan: 2, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("Span")])],
      );
      const bodyRow = schema.nodes.tableRow.create(null, [mergedCell]);

      const table = schema.nodes.table.create(null, [headerRow, bodyRow]);
      const doc = schema.nodes.doc.create(null, [table]);

      const md = prosemirrorToMarkdown(doc);
      const lines = md.trim().split("\n");
      // lines[0] = header, lines[1] = separator, lines[2] = body
      expect(lines.length).toBeGreaterThanOrEqual(3);
      const bodyCells = countInnerCells(lines[2]);
      // Should have 2 cells to match the 2-column grid
      expect(bodyCells).toHaveLength(2);
      // First cell has content, second is empty
      expect(bodyCells[0]).toBe("Span");
      expect(bodyCells[1]).toBe("");
    });
  });

  describe("PM→MD grid decomposition: rowspan", () => {
    it("rowspan=2 cell produces content in first row, empty cell in second row", () => {
      // 2 header cells: first with rowspan=2, second normal
      const h1 = schema.nodes.tableHeader.create(
        { colspan: 1, rowspan: 2, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("TallHeader")])],
      );
      const h2 = schema.nodes.tableHeader.create(
        { colspan: 1, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("H2")])],
      );
      const headerRow = schema.nodes.tableRow.create(null, [h1, h2]);

      // Body row: only 1 cell (the rowspan from h1 fills col 0)
      const bodyCell = schema.nodes.tableCell.create(
        { colspan: 1, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("B2")])],
      );
      const bodyRow = schema.nodes.tableRow.create(null, [bodyCell]);

      const table = schema.nodes.table.create(null, [headerRow, bodyRow]);
      const doc = schema.nodes.doc.create(null, [table]);

      const md = prosemirrorToMarkdown(doc);
      const lines = md.trim().split("\n");
      // lines[0] = header row, lines[1] = separator, lines[2] = body row
      expect(lines.length).toBeGreaterThanOrEqual(3);

      const headerCells = countInnerCells(lines[0]);
      // Header row has 2 columns
      expect(headerCells).toHaveLength(2);
      expect(headerCells[0]).toBe("TallHeader");

      const bodyCells = countInnerCells(lines[2]);
      // Body row also has 2 columns; col 0 is empty (spanned from above)
      expect(bodyCells).toHaveLength(2);
      expect(bodyCells[0]).toBe(""); // spanned cell → empty
      expect(bodyCells[1]).toBe("B2");
    });
  });

  describe("Roundtrip stability", () => {
    it("normal GFM table round-trips with stable cell count and content", () => {
      const input = "| A | B |\n| --- | --- |\n| 1 | 2 |";
      const out = roundtrip(input);
      // Content must be preserved (remark-stringify normalizes separator dashes to minimum)
      expect(out).toContain("| A | B |");
      expect(out).toContain("| 1 | 2 |");
      // Separator row must exist with correct column count
      const lines = out.trim().split("\n");
      expect(lines).toHaveLength(3);
      const sepCells = countInnerCells(lines[1]);
      expect(sepCells).toHaveLength(2);
    });

    it("table with alignment preserves left/center/right alignment markers", () => {
      const input =
        "| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |";
      const out = roundtrip(input);
      // Alignment markers must be present (remark-stringify may normalize dashes count)
      expect(out).toMatch(/:-+/); // left-aligned: :---
      expect(out).toMatch(/:-+:/); // center-aligned: :---:
      expect(out).toMatch(/-+:/); // right-aligned: ---:
    });

    it("simple 3-column table preserves cell count per row", () => {
      const input = "| X | Y | Z |\n| --- | --- | --- |\n| 1 | 2 | 3 |";
      const out = roundtrip(input);
      const lines = out.trim().split("\n");
      // Header and body rows both have 3 inner cells
      expect(countInnerCells(lines[0])).toHaveLength(3);
      expect(countInnerCells(lines[2])).toHaveLength(3);
    });
  });

  describe("PM node construction: colspan/rowspan attributes", () => {
    it("tableCell node retains colspan attr", () => {
      const cell = schema.nodes.tableCell.create(
        { colspan: 3, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create()],
      );
      expect(cell.attrs.colspan).toBe(3);
      expect(cell.attrs.rowspan).toBe(1);
    });

    it("tableHeader node retains rowspan attr", () => {
      const header = schema.nodes.tableHeader.create(
        { colspan: 1, rowspan: 2, alignment: null },
        [schema.nodes.paragraph.create()],
      );
      expect(header.attrs.rowspan).toBe(2);
    });

    it("grid decomposition: merged+normal header produces correct column count", () => {
      // Row 0: [merged(colspan=2), normal] → 3 logical columns
      const merged = schema.nodes.tableHeader.create(
        { colspan: 2, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("M")])],
      );
      const normal = schema.nodes.tableHeader.create(
        { colspan: 1, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("N")])],
      );
      const headerRow = schema.nodes.tableRow.create(null, [merged, normal]);

      const c1 = schema.nodes.tableCell.create(
        { colspan: 1, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("a")])],
      );
      const c2 = schema.nodes.tableCell.create(
        { colspan: 1, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("b")])],
      );
      const c3 = schema.nodes.tableCell.create(
        { colspan: 1, rowspan: 1, alignment: null },
        [schema.nodes.paragraph.create(null, [schema.text("c")])],
      );
      const bodyRow = schema.nodes.tableRow.create(null, [c1, c2, c3]);

      const table = schema.nodes.table.create(null, [headerRow, bodyRow]);
      const doc = schema.nodes.doc.create(null, [table]);

      const md = prosemirrorToMarkdown(doc);
      const lines = md.trim().split("\n");

      // Both header and body should have 3 columns
      expect(countInnerCells(lines[0])).toHaveLength(3);
      expect(countInnerCells(lines[2])).toHaveLength(3);
    });
  });
});

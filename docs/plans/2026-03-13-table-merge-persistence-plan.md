# Table Cell Merge Persistence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist table cell merge (colspan/rowspan) in markdown using `<` and `^` markers so merges survive source-mode toggle and file reopen.

**Architecture:** Extend `table-transformer.ts` with two code paths — serialization emits `<`/`^` marker cells for merged positions, deserialization detects markers and reconstructs colspan/rowspan attributes via a 4-pass algorithm. Non-merged tables use existing code paths unchanged.

**Tech Stack:** TypeScript, Tiptap/ProseMirror, remark (mdast), Vitest

**Spec:** `docs/plans/2026-03-13-table-merge-persistence-design.md`

---

## Chunk 1: Serialization — PM → MD Merge Markers

### Task 1: Colspan Serialization Tests

**Files:**
- Modify: `src/extensions/__tests__/table-advanced.test.ts`

- [ ] **Step 1: Write failing tests for colspan marker serialization**

Add a new `describe` block after the existing "PM→MD grid decomposition: colspan" section:

```typescript
describe("PM→MD merge markers: colspan", () => {
  it("colspan=2 emits '<' marker in second cell", () => {
    const merged = schema.nodes.tableHeader.create(
      { colspan: 2, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("Merged")])],
    );
    const normal = schema.nodes.tableHeader.create(
      { colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("Normal")])],
    );
    const headerRow = schema.nodes.tableRow.create(null, [merged, normal]);

    const c1 = schema.nodes.tableCell.create(
      { colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("A")])],
    );
    const c2 = schema.nodes.tableCell.create(
      { colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("B")])],
    );
    const c3 = schema.nodes.tableCell.create(
      { colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("C")])],
    );
    const bodyRow = schema.nodes.tableRow.create(null, [c1, c2, c3]);

    const table = schema.nodes.table.create(null, [headerRow, bodyRow]);
    const doc = schema.nodes.doc.create(null, [table]);
    const md = prosemirrorToMarkdown(doc);
    const lines = md.trim().split("\n");

    const headerCells = countInnerCells(lines[0]);
    expect(headerCells).toHaveLength(3);
    expect(headerCells[0]).toBe("Merged");
    expect(headerCells[1]).toBe("<");
    expect(headerCells[2]).toBe("Normal");
  });

  it("colspan=3 emits two '<' markers", () => {
    const merged = schema.nodes.tableHeader.create(
      { colspan: 3, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("Wide")])],
    );
    const headerRow = schema.nodes.tableRow.create(null, [merged]);

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
    expect(headerCells[0]).toBe("Wide");
    expect(headerCells[1]).toBe("<");
    expect(headerCells[2]).toBe("<");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/extensions/__tests__/table-advanced.test.ts`
Expected: FAIL — second cell is empty `""` instead of `"<"`

- [ ] **Step 3: Commit failing tests**

```bash
git add src/extensions/__tests__/table-advanced.test.ts
git commit -m "test(§5.5): add colspan marker serialization tests"
```

### Task 2: Rowspan Serialization Tests

**Files:**
- Modify: `src/extensions/__tests__/table-advanced.test.ts`

- [ ] **Step 1: Write failing tests for rowspan marker serialization**

Add after the colspan marker tests:

```typescript
describe("PM→MD merge markers: rowspan", () => {
  it("rowspan=2 emits '^' marker in second row", () => {
    const h1 = schema.nodes.tableHeader.create(
      { colspan: 1, rowspan: 2, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("Tall")])],
    );
    const h2 = schema.nodes.tableHeader.create(
      { colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("Normal")])],
    );
    const headerRow = schema.nodes.tableRow.create(null, [h1, h2]);

    const bodyCell = schema.nodes.tableCell.create(
      { colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("B")])],
    );
    const bodyRow = schema.nodes.tableRow.create(null, [bodyCell]);

    const table = schema.nodes.table.create(null, [headerRow, bodyRow]);
    const doc = schema.nodes.doc.create(null, [table]);
    const md = prosemirrorToMarkdown(doc);
    const lines = md.trim().split("\n");

    const bodyCells = countInnerCells(lines[2]);
    expect(bodyCells).toHaveLength(2);
    expect(bodyCells[0]).toBe("^");
    expect(bodyCells[1]).toBe("B");
  });

  it("2x2 merge emits '<' in header and '^' markers in body", () => {
    const big = schema.nodes.tableHeader.create(
      { colspan: 2, rowspan: 2, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("Big")])],
    );
    const h3 = schema.nodes.tableHeader.create(
      { colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("Normal")])],
    );
    const headerRow = schema.nodes.tableRow.create(null, [big, h3]);

    const bodyCell = schema.nodes.tableCell.create(
      { colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("Other")])],
    );
    const bodyRow = schema.nodes.tableRow.create(null, [bodyCell]);

    const table = schema.nodes.table.create(null, [headerRow, bodyRow]);
    const doc = schema.nodes.doc.create(null, [table]);
    const md = prosemirrorToMarkdown(doc);
    const lines = md.trim().split("\n");

    const headerCells = countInnerCells(lines[0]);
    expect(headerCells).toHaveLength(3);
    expect(headerCells[0]).toBe("Big");
    expect(headerCells[1]).toBe("<");
    expect(headerCells[2]).toBe("Normal");

    const bodyCells = countInnerCells(lines[2]);
    expect(bodyCells).toHaveLength(3);
    expect(bodyCells[0]).toBe("^");
    expect(bodyCells[1]).toBe("^");
    expect(bodyCells[2]).toBe("Other");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/extensions/__tests__/table-advanced.test.ts`
Expected: FAIL — `""` instead of `"^"` and `"<"`

- [ ] **Step 3: Commit failing tests**

```bash
git add src/extensions/__tests__/table-advanced.test.ts
git commit -m "test(§5.5): add rowspan and 2x2 merge marker serialization tests"
```

### Task 3: Implement Serialization

**Files:**
- Modify: `src/pipeline/transformers/table-transformer.ts`

- [ ] **Step 1: Extend grid entry type and fill logic**

In `pmToMdast`, update the grid type and Step 3 fill logic. Replace the grid type declaration and fill loop:

```typescript
// Before (line 81):
const grid: (null | { cell: PmNode; isMain: boolean })[][] = [];

// After:
const grid: (null | { cell: PmNode; isMain: boolean; mainRow: number; mainCol: number })[][] = [];
```

In the fill loop (around line 99), add `mainRow` and `mainCol`:

```typescript
grid[rowIndex + dr][gridCol + dc] = {
  cell,
  isMain: dr === 0 && dc === 0,
  mainRow: rowIndex,
  mainCol: gridCol,
};
```

- [ ] **Step 2: Add hasMerge detection inside the grid fill loop**

Declare `let hasMerge = false;` before the grid fill loop. Inside the fill loop, after reading `cs` and `rs`, add the check:

```typescript
// Add before the grid fill loop:
let hasMerge = false;

// Inside the fill loop, after `const rs = ...`:
if (cs > 1 || rs > 1) hasMerge = true;
```

- [ ] **Step 3: Update Step 4 output logic for non-main cells**

In the Step 4 loop, replace the `else` branch (currently emits empty cell) with marker logic. The existing code at lines 134-139:

```typescript
} else {
  // Spanned or empty cell — emit empty content
  cells.push({
    type: "tableCell",
    children: [],
  } as MdastTableCell);
```

Replace with:

```typescript
} else if (hasMerge && entry) {
  // Merge marker cell
  const marker = entry.mainRow === r ? "<" : "^";
  cells.push({
    type: "tableCell",
    children: [{ type: "text", value: marker } as unknown as MdastNode],
  } as MdastTableCell);
} else {
  // Spanned or empty cell (no merge) — emit empty content
  cells.push({
    type: "tableCell",
    children: [],
  } as MdastTableCell);
```

- [ ] **Step 4: Update existing tests that now expect markers instead of empty cells**

The existing tests in "PM→MD grid decomposition" expected empty strings for spanned cells. With markers enabled, these cells now contain `<` or `^`. Update:

In the test "colspan=2 body cell expands to 2 cells, second cell empty" (around line 155):

```typescript
// Before:
expect(bodyCells[1]).toBe("");

// After:
expect(bodyCells[1]).toBe("<");
```

In the test "rowspan=2 cell produces content in first row, empty cell in second row" (around line 195):

```typescript
// Before:
expect(bodyCells[0]).toBe(""); // spanned cell → empty

// After:
expect(bodyCells[0]).toBe("^"); // spanned cell → rowspan marker
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run src/extensions/__tests__/table-advanced.test.ts`
Expected: ALL PASS — both new marker tests and updated existing tests

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/transformers/table-transformer.ts src/extensions/__tests__/table-advanced.test.ts
git commit -m "feat(§5.5): serialize merge markers (<, ^) in table-transformer pmToMdast"
```

---

## Chunk 2: Deserialization — MD → PM Merge Markers

### Task 4: Colspan Deserialization Tests

**Files:**
- Modify: `src/extensions/__tests__/table-advanced.test.ts`

- [ ] **Step 1: Write failing tests for colspan marker deserialization**

```typescript
describe("MD→PM merge markers: colspan", () => {
  it("'<' marker creates colspan=2 on preceding cell", () => {
    const md = "| A | < | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |";
    const doc = markdownToProsemirror(md, schema);
    const table = doc.firstChild!;
    const headerRow = table.firstChild!;

    // Header row should have 2 PM cells (A with colspan=2, C with colspan=1)
    expect(headerRow.childCount).toBe(2);
    expect(headerRow.child(0).attrs.colspan).toBe(2);
    expect(headerRow.child(0).textContent).toBe("A");
    expect(headerRow.child(1).attrs.colspan).toBe(1);
    expect(headerRow.child(1).textContent).toBe("C");
  });

  it("consecutive '<' markers create colspan=3", () => {
    const md = "| Wide | < | < |\n| --- | --- | --- |\n| 1 | 2 | 3 |";
    const doc = markdownToProsemirror(md, schema);
    const table = doc.firstChild!;
    const headerRow = table.firstChild!;

    expect(headerRow.childCount).toBe(1);
    expect(headerRow.child(0).attrs.colspan).toBe(3);
    expect(headerRow.child(0).textContent).toBe("Wide");
  });

  it("'<' in first column is treated as plain text", () => {
    const md = "| < | B |\n| --- | --- |\n| 1 | 2 |";
    const doc = markdownToProsemirror(md, schema);
    const table = doc.firstChild!;
    const headerRow = table.firstChild!;

    // Both cells should exist with colspan=1
    expect(headerRow.childCount).toBe(2);
    expect(headerRow.child(0).attrs.colspan).toBe(1);
    expect(headerRow.child(0).textContent).toBe("<");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/extensions/__tests__/table-advanced.test.ts`
Expected: FAIL — `colspan` is `1` instead of `2`/`3`, cell count unchanged

- [ ] **Step 3: Commit failing tests**

```bash
git add src/extensions/__tests__/table-advanced.test.ts
git commit -m "test(§5.5): add colspan marker deserialization tests"
```

### Task 5: Rowspan Deserialization Tests

**Files:**
- Modify: `src/extensions/__tests__/table-advanced.test.ts`

- [ ] **Step 1: Write failing tests for rowspan marker deserialization**

```typescript
describe("MD→PM merge markers: rowspan", () => {
  it("'^' marker creates rowspan=2 on cell above", () => {
    const md = "| Tall | B |\n| --- | --- |\n| ^ | C |";
    const doc = markdownToProsemirror(md, schema);
    const table = doc.firstChild!;
    const headerRow = table.firstChild!;
    const bodyRow = table.child(1);

    expect(headerRow.child(0).attrs.rowspan).toBe(2);
    expect(headerRow.child(0).textContent).toBe("Tall");
    // Body row should have only 1 cell (C), since ^ is consumed
    expect(bodyRow.childCount).toBe(1);
    expect(bodyRow.child(0).textContent).toBe("C");
  });

  it("2x2 merge with '<' and '^' markers", () => {
    const md = "| Big | < | N |\n| --- | --- | --- |\n| ^ | ^ | O |";
    const doc = markdownToProsemirror(md, schema);
    const table = doc.firstChild!;
    const headerRow = table.firstChild!;
    const bodyRow = table.child(1);

    // Header: Big (colspan=2, rowspan=2), N (colspan=1, rowspan=1)
    expect(headerRow.childCount).toBe(2);
    expect(headerRow.child(0).attrs.colspan).toBe(2);
    expect(headerRow.child(0).attrs.rowspan).toBe(2);
    expect(headerRow.child(0).textContent).toBe("Big");
    expect(headerRow.child(1).textContent).toBe("N");

    // Body: only O (colspan=1, rowspan=1)
    expect(bodyRow.childCount).toBe(1);
    expect(bodyRow.child(0).textContent).toBe("O");
  });

  it("'^' in first row is treated as plain text", () => {
    const md = "| ^ | B |\n| --- | --- |\n| 1 | 2 |";
    const doc = markdownToProsemirror(md, schema);
    const table = doc.firstChild!;
    const headerRow = table.firstChild!;

    expect(headerRow.childCount).toBe(2);
    expect(headerRow.child(0).attrs.rowspan).toBe(1);
    expect(headerRow.child(0).textContent).toBe("^");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/extensions/__tests__/table-advanced.test.ts`
Expected: FAIL — `rowspan` is `1`, cell counts unchanged

- [ ] **Step 3: Commit failing tests**

```bash
git add src/extensions/__tests__/table-advanced.test.ts
git commit -m "test(§5.5): add rowspan and 2x2 merge marker deserialization tests"
```

### Task 6: Implement Deserialization

**Files:**
- Modify: `src/pipeline/transformers/table-transformer.ts`

- [ ] **Step 1: Add helper function to extract cell text**

Add before the `tableTransformer` export:

```typescript
/** Extract plain text from mdast table cell children (for marker detection) */
function extractCellText(cell: MdastTableCell): string {
  let text = "";
  function walk(node: MdastNode) {
    if ((node as { value?: string }).value) text += (node as { value: string }).value;
    if ((node as { children?: MdastNode[] }).children) {
      for (const child of (node as { children: MdastNode[] }).children) walk(child);
    }
  }
  for (const child of cell.children) walk(child);
  return text;
}
```

- [ ] **Step 2: Rewrite mdastToPm with merge marker detection**

Replace the entire `mdastToPm` function body with:

```typescript
mdastToPm(node: MdastNode, schema: Schema, convertChildren) {
  const table = node as MdastTable;
  const align = table.align || [];
  const rowCount = table.children.length;

  // Pass 1: Build 2D content array and check for merge markers
  const content: string[][] = [];
  const rawCells: MdastTableCell[][] = [];
  let hasMergeMarkers = false;

  for (let r = 0; r < rowCount; r++) {
    content[r] = [];
    rawCells[r] = [];
    const row = table.children[r];
    for (let c = 0; c < row.children.length; c++) {
      const cell = row.children[c];
      rawCells[r][c] = cell;
      const text = extractCellText(cell).trim();
      content[r][c] = text;
      if (text === "<" || text === "^") hasMergeMarkers = true;
    }
  }

  if (!hasMergeMarkers) {
    // Existing logic — no markers, standard GFM table
    const rows: PmNode[] = [];
    table.children.forEach((row, rowIndex) => {
      const cells: PmNode[] = [];
      row.children.forEach((cell, colIndex) => {
        const cellChildren =
          (cell as unknown as { children: MdastNode[] }).children || [];
        const cellContent =
          cellChildren.length > 0
            ? convertChildren({
                children: cellChildren,
              } as unknown as import("mdast").Parent)
            : [];
        const pmContent =
          cellContent.length > 0
            ? cellContent
            : [schema.nodes.paragraph.create()];
        const cellAttrs = {
          colspan: 1,
          rowspan: 1,
          alignment: align[colIndex] || null,
        };
        if (rowIndex === 0) {
          cells.push(schema.nodes.tableHeader.create(cellAttrs, pmContent));
        } else {
          cells.push(schema.nodes.tableCell.create(cellAttrs, pmContent));
        }
      });
      rows.push(schema.nodes.tableRow.create(null, cells));
    });
    return schema.nodes.table.create(null, rows);
  }

  // --- Merge marker path ---
  const colCount = Math.max(...table.children.map((r) => r.children.length));
  const attrs: { colspan: number; rowspan: number; consumed: boolean }[][] = [];
  for (let r = 0; r < rowCount; r++) {
    attrs[r] = [];
    for (let c = 0; c < colCount; c++) {
      attrs[r][c] = { colspan: 1, rowspan: 1, consumed: false };
    }
  }

  // Pass 2: Resolve colspan ('<' markers, per-row left→right)
  for (let r = 0; r < rowCount; r++) {
    for (let c = 1; c < (content[r]?.length || 0); c++) {
      if (content[r][c] === "<") {
        let sourceCol = c - 1;
        while (sourceCol > 0 && content[r][sourceCol] === "<") {
          sourceCol--;
        }
        if (content[r][sourceCol] !== "<" && content[r][sourceCol] !== "^") {
          attrs[r][sourceCol].colspan++;
          attrs[r][c].consumed = true;
        }
      }
    }
  }

  // Pass 3: Resolve rowspan ('^' markers, per-row with deduplication)
  for (let r = 1; r < rowCount; r++) {
    const rowspanApplied = new Set<string>();
    for (let c = 0; c < (content[r]?.length || 0); c++) {
      if (content[r][c] === "^" && !attrs[r][c].consumed) {
        let sourceRow = r - 1;
        while (sourceRow > 0 && content[sourceRow][c] === "^") {
          sourceRow--;
        }
        let sourceCol = c;
        if (attrs[sourceRow]?.[sourceCol]?.consumed) {
          while (sourceCol > 0 && attrs[sourceRow][sourceCol].consumed) {
            sourceCol--;
          }
        }
        const mainKey = `${sourceRow},${sourceCol}`;
        if (!rowspanApplied.has(mainKey)) {
          attrs[sourceRow][sourceCol].rowspan++;
          rowspanApplied.add(mainKey);
        }
        attrs[r][c].consumed = true;
      }
    }
  }

  // Pass 4: Build PM nodes (skip rows where all cells are consumed)
  const rows: PmNode[] = [];
  for (let r = 0; r < rowCount; r++) {
    const cells: PmNode[] = [];
    for (let c = 0; c < (content[r]?.length || 0); c++) {
      if (!attrs[r][c].consumed) {
        const cell = rawCells[r][c];
        const cellChildren =
          (cell as unknown as { children: MdastNode[] }).children || [];
        const cellContent =
          cellChildren.length > 0
            ? convertChildren({
                children: cellChildren,
              } as unknown as import("mdast").Parent)
            : [];
        const pmContent =
          cellContent.length > 0
            ? cellContent
            : [schema.nodes.paragraph.create()];
        const cellAttrs = {
          colspan: attrs[r][c].colspan,
          rowspan: attrs[r][c].rowspan,
          alignment: align[c] || null,
        };
        if (r === 0) {
          cells.push(schema.nodes.tableHeader.create(cellAttrs, pmContent));
        } else {
          cells.push(schema.nodes.tableCell.create(cellAttrs, pmContent));
        }
      }
    }
    // Guard: skip rows where all cells are consumed (avoids ProseMirror
    // RangeError — tableRow requires 1+ children)
    if (cells.length > 0) {
      rows.push(schema.nodes.tableRow.create(null, cells));
    }
  }
  return schema.nodes.table.create(null, rows);
},
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run src/extensions/__tests__/table-advanced.test.ts`
Expected: ALL PASS — deserialization tests + all existing tests

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/transformers/table-transformer.ts
git commit -m "feat(§5.5): deserialize merge markers (<, ^) in table-transformer mdastToPm"
```

---

## Chunk 3: Roundtrip Tests and Edge Cases

### Task 7: Roundtrip Tests

**Files:**
- Modify: `src/extensions/__tests__/table-advanced.test.ts`

- [ ] **Step 1: Write roundtrip tests for merge markers**

Add a new describe block:

```typescript
describe("Roundtrip: merge markers", () => {
  it("colspan=2 roundtrips via '<' marker", () => {
    // Build PM with colspan=2
    const merged = schema.nodes.tableHeader.create(
      { colspan: 2, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("A")])],
    );
    const normal = schema.nodes.tableHeader.create(
      { colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("B")])],
    );
    const headerRow = schema.nodes.tableRow.create(null, [merged, normal]);

    const c1 = schema.nodes.tableCell.create({ colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("1")])]);
    const c2 = schema.nodes.tableCell.create({ colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("2")])]);
    const c3 = schema.nodes.tableCell.create({ colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("3")])]);
    const bodyRow = schema.nodes.tableRow.create(null, [c1, c2, c3]);

    const table = schema.nodes.table.create(null, [headerRow, bodyRow]);
    const doc = schema.nodes.doc.create(null, [table]);

    // PM → MD → PM
    const md = prosemirrorToMarkdown(doc);
    expect(md).toContain("| < |");

    const doc2 = markdownToProsemirror(md, schema);
    const table2 = doc2.firstChild!;
    const headerRow2 = table2.firstChild!;

    expect(headerRow2.child(0).attrs.colspan).toBe(2);
    expect(headerRow2.child(0).textContent).toBe("A");
  });

  it("2x2 merge roundtrips via '<' and '^' markers", () => {
    const big = schema.nodes.tableHeader.create(
      { colspan: 2, rowspan: 2, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("Big")])],
    );
    const h3 = schema.nodes.tableHeader.create(
      { colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("N")])],
    );
    const headerRow = schema.nodes.tableRow.create(null, [big, h3]);

    const bodyCell = schema.nodes.tableCell.create(
      { colspan: 1, rowspan: 1, alignment: null },
      [schema.nodes.paragraph.create(null, [schema.text("O")])],
    );
    const bodyRow = schema.nodes.tableRow.create(null, [bodyCell]);

    const table = schema.nodes.table.create(null, [headerRow, bodyRow]);
    const doc = schema.nodes.doc.create(null, [table]);

    // PM → MD → PM
    const md = prosemirrorToMarkdown(doc);
    expect(md).toContain("| < |");
    expect(md).toContain("| ^ |");

    const doc2 = markdownToProsemirror(md, schema);
    const table2 = doc2.firstChild!;
    const headerRow2 = table2.firstChild!;

    expect(headerRow2.child(0).attrs.colspan).toBe(2);
    expect(headerRow2.child(0).attrs.rowspan).toBe(2);
    expect(headerRow2.child(0).textContent).toBe("Big");
  });

  it("MD with merge markers roundtrips: MD → PM → MD content preserved", () => {
    const input = "| A | < | C |\n| --- | --- | --- |\n| ^ | ^ | D |";
    const doc = markdownToProsemirror(input, schema);
    const output = prosemirrorToMarkdown(doc);

    // Verify markers are re-emitted
    const lines = output.trim().split("\n");
    const headerCells = countInnerCells(lines[0]);
    expect(headerCells[0]).toBe("A");
    expect(headerCells[1]).toBe("<");
    expect(headerCells[2]).toBe("C");

    const bodyCells = countInnerCells(lines[2]);
    expect(bodyCells[0]).toBe("^");
    expect(bodyCells[1]).toBe("^");
    expect(bodyCells[2]).toBe("D");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/extensions/__tests__/table-advanced.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/extensions/__tests__/table-advanced.test.ts
git commit -m "test(§5.5): add merge marker roundtrip tests"
```

### Task 8: Inline Marks and Alignment Roundtrip Tests

**Files:**
- Modify: `src/extensions/__tests__/table-advanced.test.ts`

- [ ] **Step 1: Write inline marks + merge roundtrip tests**

```typescript
describe("Roundtrip: merge markers with inline marks and alignment", () => {
  it("colspan cell with bold text preserves marks on roundtrip", () => {
    const md = "| **Bold** | < | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |";
    const doc = markdownToProsemirror(md, schema);
    const table = doc.firstChild!;
    const headerRow = table.firstChild!;

    // Bold cell has colspan=2
    expect(headerRow.child(0).attrs.colspan).toBe(2);

    // Re-serialize and verify bold + marker preserved
    const output = prosemirrorToMarkdown(doc);
    const lines = output.trim().split("\n");
    const headerCells = countInnerCells(lines[0]);
    expect(headerCells[0]).toContain("**Bold**");
    expect(headerCells[1]).toBe("<");
    expect(headerCells[2]).toBe("C");
  });

  it("merge table with alignment roundtrips correctly", () => {
    const md = "| A | < | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |";
    const doc = markdownToProsemirror(md, schema);
    const output = prosemirrorToMarkdown(doc);

    // Alignment markers preserved
    expect(output).toMatch(/:-+/);   // left
    expect(output).toMatch(/:-+:/);  // center
    expect(output).toMatch(/-+:/);   // right

    // Merge marker preserved
    const lines = output.trim().split("\n");
    const headerCells = countInnerCells(lines[0]);
    expect(headerCells[1]).toBe("<");
  });

  it("rowspan=3 with consecutive '^' markers", () => {
    const md = "| Tall | B |\n| --- | --- |\n| ^ | C |\n| ^ | D |";
    const doc = markdownToProsemirror(md, schema);
    const table = doc.firstChild!;
    const headerRow = table.firstChild!;

    expect(headerRow.child(0).attrs.rowspan).toBe(3);
    expect(headerRow.child(0).textContent).toBe("Tall");

    // Re-serialize and verify markers
    const output = prosemirrorToMarkdown(doc);
    const lines = output.trim().split("\n");
    expect(countInnerCells(lines[2])[0]).toBe("^");
    expect(countInnerCells(lines[3])[0]).toBe("^");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/extensions/__tests__/table-advanced.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/extensions/__tests__/table-advanced.test.ts
git commit -m "test(§5.5): add inline marks, alignment, and rowspan=3 merge roundtrip tests"
```

### Task 9: No-Merge Backward Compatibility and Full Regression

**Files:**
- Modify: `src/extensions/__tests__/table-advanced.test.ts`

- [ ] **Step 1: Add explicit no-merge regression test**

```typescript
describe("Backward compatibility: no-merge tables unchanged", () => {
  it("table without merge produces no markers", () => {
    const input = "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |";
    const output = roundtrip(input);
    expect(output).not.toContain("| < |");
    expect(output).not.toContain("| ^ |");
    expect(output).toContain("| A | B | C |");
    expect(output).toContain("| 1 | 2 | 3 |");
  });
});
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run src/extensions/__tests__/table-advanced.test.ts`
Expected: ALL PASS — all existing + new tests

- [ ] **Step 3: Run all project tests to verify no regressions**

Run: `npx vitest run`
Expected: ALL 1863+ tests pass

- [ ] **Step 4: Commit**

```bash
git add src/extensions/__tests__/table-advanced.test.ts
git commit -m "test(§5.5): add backward compatibility regression test for no-merge tables"
```

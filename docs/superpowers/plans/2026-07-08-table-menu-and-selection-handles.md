# Table Toolbar Clamp + Row/Column Selection Handles + Drag Reorder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the table floating toolbar reachable while scrolling, and add Notion-style grip handles that select and drag-reorder whole rows/columns.

**Architecture:** Three independent slices on top of the existing `@tiptap/extension-table` / `prosemirror-tables` setup. (1) A pure `computeToolbarTop` helper clamps the existing `TableToolbar` to the top of the editor viewport, driven by a new scroll listener. (2) A new `TableSelectionHandles` React overlay (mounted beside `TableInsertButtons`) shows per-column/row grips using the established `position:fixed` + `getEditorZoom()` divide pattern; clicking a grip builds a `CellSelection` and opens a reused context menu. (3) A `use-table-drag` hook (modeled on `use-block-drag`) turns the same grip into a drag handle that dispatches `moveTableColumn`/`moveTableRow`.

**Tech Stack:** React 19 + TypeScript (strict), Tiptap v2 / ProseMirror, `prosemirror-tables`, Vitest + @testing-library/react, CSS design tokens.

## Global Constraints

- File size: keep single files ≤ ~300 lines; `.tsx` files export only components (put pure helpers in sibling `.ts` — mirrors `table-insert-coords.ts`).
- Zustand: never bare `useStore()`; use `useShallow` selectors. (Not expected to be needed here.)
- Filenames: kebab-case. Components/Extensions: PascalCase export; functions/hooks: camelCase.
- Tests: `npm test` (→ `vitest run`); never `npx jest`. Round-trip preservation is the top quality bar (unaffected here — no schema/serialization change).
- CSS: `--color-*` tokens only; keep new rules in existing `toolbar.css` / `components.css`; single CSS file ≤ ~1,500 lines.
- Zoom pattern: for `position:fixed` overlays inside `.editor-area-scroll`, divide visual-viewport coords by `getEditorZoom()`; content-space sizes stay undivided (see `table-insert-coords.ts:31-53`).
- Commit style: Conventional Commits with a `§5.5` reference, English messages.
- Branch: `feature/table-menu-clamp-selection-handles` (already created; spec committed).
- Design refs: §5.5 (table), §4.8 (context menu / block handle), §4.2 (zoom positioning).

---

## File Structure

- **Create** `src/components/toolbar/table-toolbar-position.ts` — pure clamp math (`computeToolbarTop`).
- **Modify** `src/components/toolbar/TableToolbar.tsx` — use the helper; add scroll listener.
- **Create** `src/components/toolbar/table-selection.ts` — shared table-geometry + selection helpers (`findCellPos` moved here, `columnAnchorPos`, `rowAnchorPos`, `selectColumn`, `selectRow`, `computeHandleStyle`, `computeDropIndicatorStyle`, boundary finders, reorder wrappers, span guards).
- **Modify** `src/components/toolbar/TableInsertButtons.tsx` — import `findCellPos` from the shared module instead of defining it locally.
- **Create** `src/components/toolbar/MenuList.tsx` — presentational menu (renders `.context-menu`, viewport clamp, outside-click/Escape close).
- **Modify** `src/components/toolbar/ContextMenu.tsx` — render `<MenuList>` instead of the inline list.
- **Create** `src/components/toolbar/TableSelectionHandles.tsx` — hover-driven grip overlay; click → select + popup; hosts the drop indicator.
- **Create** `src/components/toolbar/use-table-drag.ts` — drag-to-reorder hook.
- **Modify** `src/App.tsx` — mount `<TableSelectionHandles editor={activeEditor} />`.
- **Modify** `src/styles/components.css` — `.table-select-handle`, `.table-drop-indicator`.
- **Create** tests: `src/__tests__/unit/table-toolbar-position.test.ts`, `src/__tests__/unit/table-selection.test.ts`, `src/components/__tests__/menu-list.test.tsx`.

---

## Task 1: Floating toolbar viewport clamp

**Files:**
- Create: `src/components/toolbar/table-toolbar-position.ts`
- Test: `src/__tests__/unit/table-toolbar-position.test.ts`
- Modify: `src/components/toolbar/TableToolbar.tsx:261-331`

**Interfaces:**
- Produces: `computeToolbarTop(r: ToolbarRects): ToolbarPlacement`
  - `ToolbarRects = { tableTop: number; tableBottom: number; scrollTop: number; scrollHeight: number; toolbarHeight: number }`
  - `ToolbarPlacement = { visible: boolean; top: number }`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/unit/table-toolbar-position.test.ts`:

```ts
// §5.5 / §4.2 — floating table toolbar viewport clamp math.
import { describe, expect, it } from "vitest";

import {
  computeToolbarTop,
  type ToolbarRects,
} from "../../components/toolbar/table-toolbar-position";

// scroll viewport spans y ∈ [100, 700] (top=100, height=600). toolbar is 32 tall.
const base: Omit<ToolbarRects, "tableTop" | "tableBottom"> = {
  scrollTop: 100,
  scrollHeight: 600,
  toolbarHeight: 32,
};

describe("computeToolbarTop", () => {
  it("sits above the table when the table top is visible", () => {
    // table top at viewport-relative 200 → desired = 200 - 32 - 6 = 162
    const r: ToolbarRects = { ...base, tableTop: 300, tableBottom: 500 };
    expect(computeToolbarTop(r)).toEqual({ visible: true, top: 162 });
  });

  it("clamps to MIN_TOP when the table top scrolls above the viewport", () => {
    // table top above viewport top (negative relative), bottom still visible
    const r: ToolbarRects = { ...base, tableTop: 40, tableBottom: 400 };
    expect(computeToolbarTop(r)).toEqual({ visible: true, top: 4 });
  });

  it("hides when the table has scrolled (almost) entirely above the viewport", () => {
    // bottom-relative = 130 - 100 = 30 <= toolbarHeight(32)+MIN_TOP(4)=36 → hide
    const r: ToolbarRects = { ...base, tableTop: 10, tableBottom: 130 };
    expect(computeToolbarTop(r)).toEqual({ visible: false, top: 0 });
  });

  it("hides when the table is entirely below the viewport", () => {
    // top-relative = 800 - 100 = 700 >= scrollHeight(600) → hide
    const r: ToolbarRects = { ...base, tableTop: 800, tableBottom: 900 };
    expect(computeToolbarTop(r)).toEqual({ visible: false, top: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- table-toolbar-position`
Expected: FAIL — cannot resolve `../../components/toolbar/table-toolbar-position`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/toolbar/table-toolbar-position.ts`:

```ts
// §5.5 / §4.2 — pure placement math for the floating table toolbar.
// Kept in its own module so TableToolbar.tsx can be unit-tested without a DOM.
//
// All inputs are visual-viewport px (getBoundingClientRect space). The returned
// `top` is relative to the scroll container's top — which equals the toolbar's
// containing block (`.editor-area`) top, since `.editor-area-scroll` is the first
// child of `.editor-area` and their top edges coincide. Zoom handling is unchanged
// from the prior formula (correct at zoom 1).

export interface ToolbarRects {
  /** table.getBoundingClientRect().bottom */
  tableBottom: number;
  /** table.getBoundingClientRect().top */
  tableTop: number;
  /** .editor-area-scroll rect height */
  scrollHeight: number;
  /** .editor-area-scroll rect top */
  scrollTop: number;
  /** measured toolbar height (offsetHeight) */
  toolbarHeight: number;
}

export interface ToolbarPlacement {
  top: number;
  visible: boolean;
}

/** Gap between the toolbar bottom and the table top when the top is visible. */
const GAP = 6;
/** Sticky inset from the top of the visible editor area. */
const MIN_TOP = 4;

export function computeToolbarTop(r: ToolbarRects): ToolbarPlacement {
  const tableTopRel = r.tableTop - r.scrollTop;
  const tableBottomRel = r.tableBottom - r.scrollTop;

  // Table scrolled (almost) entirely above the viewport → nothing useful to pin to.
  if (tableBottomRel <= r.toolbarHeight + MIN_TOP) return { visible: false, top: 0 };
  // Table entirely below the viewport (safety guard).
  if (tableTopRel >= r.scrollHeight) return { visible: false, top: 0 };

  const desired = tableTopRel - r.toolbarHeight - GAP;
  return { visible: true, top: Math.max(desired, MIN_TOP) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- table-toolbar-position`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the helper into `TableToolbar.tsx`**

In `src/components/toolbar/TableToolbar.tsx`:

Add the import near the other local imports (after line 22):

```ts
import { computeToolbarTop } from "./table-toolbar-position";
```

Replace the position block in `updatePosition` (currently lines 306-321, from `// Position toolbar above the table` through `setVisible(true);`) with:

```ts
    // Position toolbar above the table, clamped to the top of the visible editor
    // area so it stays reachable while scrolling a tall table (§5.5).
    const tableRect = tableDOM.getBoundingClientRect();
    const scrollEl = editor.view.dom.closest(".editor-area-scroll");
    const scrollRect = scrollEl?.getBoundingClientRect();
    if (!scrollRect) {
      setVisible(false);
      return;
    }

    const toolbarHeight = toolbarRef.current?.offsetHeight ?? 32;
    const placement = computeToolbarTop({
      tableTop: tableRect.top,
      tableBottom: tableRect.bottom,
      scrollTop: scrollRect.top,
      scrollHeight: scrollRect.height,
      toolbarHeight,
    });
    if (!placement.visible) {
      setVisible(false);
      return;
    }

    const left = tableRect.left - scrollRect.left + tableRect.width / 2;
    setPosition({ top: placement.top, left });
    setVisible(true);
```

- [ ] **Step 6: Add a scroll listener so the toolbar tracks/clamps continuously**

In `TableToolbar.tsx`, replace the effect at lines 324-331 with:

```ts
  useEffect(() => {
    editor.on("selectionUpdate", updatePosition);
    editor.on("transaction", updatePosition);
    const scrollEl = editor.view.dom.closest(".editor-area-scroll");
    scrollEl?.addEventListener("scroll", updatePosition, { passive: true });
    return () => {
      editor.off("selectionUpdate", updatePosition);
      editor.off("transaction", updatePosition);
      scrollEl?.removeEventListener("scroll", updatePosition);
    };
  }, [editor, updatePosition]);
```

- [ ] **Step 7: Verify typecheck + existing tests still pass**

Run: `npx tsc --noEmit && npm test -- TableToolbar table-toolbar-position`
Expected: no TS errors; position tests PASS (there is no existing `TableToolbar` unit test — the filter simply runs the position test).

- [ ] **Step 8: Commit**

```bash
git add src/components/toolbar/table-toolbar-position.ts \
  src/__tests__/unit/table-toolbar-position.test.ts \
  src/components/toolbar/TableToolbar.tsx
git commit -m "feat(§5.5): clamp table toolbar to editor viewport top on scroll"
```

---

## Task 2: Shared table-selection helpers

**Files:**
- Create: `src/components/toolbar/table-selection.ts`
- Test: `src/__tests__/unit/table-selection.test.ts`
- Modify: `src/components/toolbar/TableInsertButtons.tsx:6-57` (remove local `findCellPos`, import it)

**Interfaces:**
- Consumes: `getEditorZoom` (`utils/zoom-coords`), `CellSelection`, `TableMap` (`@tiptap/pm/tables`).
- Produces:
  - `findCellPos(editor: Editor, tablePos: number, targetRow: number, targetCol: number): number | null`
  - `columnAnchorPos(editor, tablePos, colIdx): number | null` (= `findCellPos(editor, tablePos, 0, colIdx)`)
  - `rowAnchorPos(editor, tablePos, rowIdx): number | null` (= `findCellPos(editor, tablePos, rowIdx, 0)`)
  - `selectColumn(editor, cellBeforePos: number): void`
  - `selectRow(editor, cellBeforePos: number): void`
  - `computeHandleStyle(anchor: HandleAnchor, zoom: number): { left: number; top: number }`
  - `HandleAnchor = { axis: "col" | "row"; x: number; y: number }`
  - (reorder wrappers + guards are added in Task 5 — same file)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/unit/table-selection.test.ts`:

```ts
// §5.5 — shared table geometry + whole row/column selection helpers.
import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import {
  columnAnchorPos,
  computeHandleStyle,
  findCellPos,
  rowAnchorPos,
  selectColumn,
  selectRow,
} from "../../components/toolbar/table-selection";

// 2 rows × 3 cols; row 1 = headers A/B/C, row 2 = 1/2/3.
const TABLE_HTML =
  "<table><tr><th>A</th><th>B</th><th>C</th></tr>" +
  "<tr><td>1</td><td>2</td><td>3</td></tr></table>";

let editors: Editor[] = [];
function makeEditor(): Editor {
  const e = new Editor({ extensions: createBaramExtensions(), content: TABLE_HTML });
  editors.push(e);
  return e;
}
afterEach(() => {
  editors.forEach((e) => e.destroy());
  editors = [];
});

/** Position of the table node (before it) in the doc. */
function tablePos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((n, p) => {
    if (pos === -1 && n.type.name === "table") pos = p;
    return pos === -1;
  });
  return pos;
}

describe("computeHandleStyle (zoom-aware)", () => {
  it("centers a column grip above the column at zoom 1", () => {
    // grip long side = 18, short side = 14; col grip is horizontal, sits above the top edge
    expect(computeHandleStyle({ axis: "col", x: 200, y: 100 }, 1)).toEqual({
      left: 200 - 9, // x - MAIN/2
      top: 100 - 14 - 2, // y - CROSS - GAP
    });
  });
  it("centers a row grip left of the row at zoom 1", () => {
    expect(computeHandleStyle({ axis: "row", x: 100, y: 200 }, 1)).toEqual({
      left: 100 - 14 - 2, // x - CROSS - GAP
      top: 200 - 9, // y - MAIN/2
    });
  });
  it("divides visual coords by zoom (fixed-overlay scaling)", () => {
    const s = computeHandleStyle({ axis: "col", x: 200, y: 100 }, 2);
    expect(s).toEqual({ left: 200 / 2 - 9, top: 100 / 2 - 14 - 2 });
  });
});

describe("findCellPos / anchors", () => {
  it("resolves distinct cell positions per column in row 0", () => {
    const editor = makeEditor();
    const tp = tablePos(editor);
    const c0 = columnAnchorPos(editor, tp, 0);
    const c1 = columnAnchorPos(editor, tp, 1);
    const c2 = columnAnchorPos(editor, tp, 2);
    expect(c0).not.toBeNull();
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    expect(new Set([c0, c1, c2]).size).toBe(3);
    expect(findCellPos(editor, tp, 0, 5)).toBeNull(); // out of range
  });
});

describe("selectColumn / selectRow", () => {
  it("selects all cells in a column (2 rows → 2 cells)", () => {
    const editor = makeEditor();
    const tp = tablePos(editor);
    selectColumn(editor, columnAnchorPos(editor, tp, 1)!);
    const sel = editor.state.selection;
    expect(sel).toBeInstanceOf(CellSelection);
    let count = 0;
    (sel as CellSelection).forEachCell(() => {
      count++;
    });
    expect(count).toBe(2);
  });

  it("selects all cells in a row (3 cols → 3 cells)", () => {
    const editor = makeEditor();
    const tp = tablePos(editor);
    selectRow(editor, rowAnchorPos(editor, tp, 1)!);
    const sel = editor.state.selection;
    expect(sel).toBeInstanceOf(CellSelection);
    let count = 0;
    (sel as CellSelection).forEachCell(() => {
      count++;
    });
    expect(count).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- table-selection`
Expected: FAIL — cannot resolve `../../components/toolbar/table-selection`.

- [ ] **Step 3: Write the implementation**

Create `src/components/toolbar/table-selection.ts`:

```ts
// §5.5 — shared table geometry, whole row/column selection, and (Task 5) reorder.
// Pure/logic helpers live here so the overlay .tsx files export only components
// (mirrors table-insert-coords.ts).
import type { Editor } from "@tiptap/react";

import { CellSelection } from "@tiptap/pm/tables";

/** Anchor describing where a grip handle should sit (visual-viewport px). */
export interface HandleAnchor {
  /** "col" → grip above a column; "row" → grip left of a row. */
  axis: "col" | "row";
  /** Column center x (col) or table left edge x (row). */
  x: number;
  /** Table top edge y (col) or row center y (row). */
  y: number;
}

// Grip is a rounded pill: MAIN along the axis it labels, CROSS across it.
const HANDLE_MAIN = 18;
const HANDLE_CROSS = 14;
const HANDLE_GAP = 2; // lift off the table border

/**
 * Zoom-aware `position: fixed` offset for a grip. The grip is a fixed element
 * inside the CSS-zoom container (`.editor-area-scroll`), which WKWebView renders
 * at (zoom × top, zoom × left). anchor.x/y are visual-viewport coords, so
 * dividing by zoom cancels the render-time scaling; the grip's fixed size and the
 * gap are content-space sizes that scale with it, so they stay un-divided.
 */
export function computeHandleStyle(
  anchor: HandleAnchor,
  zoom: number,
): { left: number; top: number } {
  if (anchor.axis === "col") {
    return {
      left: anchor.x / zoom - HANDLE_MAIN / 2,
      top: anchor.y / zoom - HANDLE_CROSS - HANDLE_GAP,
    };
  }
  return {
    left: anchor.x / zoom - HANDLE_CROSS - HANDLE_GAP,
    top: anchor.y / zoom - HANDLE_MAIN / 2,
  };
}

/**
 * Find the PM position directly in front of the cell at (targetRow, targetCol).
 * Moved verbatim from TableInsertButtons so both the insert button and the
 * selection handles share one implementation.
 */
export function findCellPos(
  editor: Editor,
  tablePos: number,
  targetRow: number,
  targetCol: number,
): null | number {
  const tableNode = editor.state.doc.nodeAt(tablePos);
  if (!tableNode) return null;

  let rowIdx = 0;
  let result: null | number = null;

  tableNode.forEach((row, rowOffset) => {
    if (result !== null) return;
    if (rowIdx === targetRow) {
      let colIdx = 0;
      row.forEach((_cell, cellOffset) => {
        if (result !== null) return;
        if (colIdx === targetCol) {
          result = tablePos + 1 + rowOffset + 1 + cellOffset;
        }
        colIdx++;
      });
    }
    rowIdx++;
  });

  return result;
}

/** Cell-before pos for a column's top (row 0) cell — anchor for colSelection. */
export function columnAnchorPos(
  editor: Editor,
  tablePos: number,
  colIdx: number,
): null | number {
  return findCellPos(editor, tablePos, 0, colIdx);
}

/** Cell-before pos for a row's first (col 0) cell — anchor for rowSelection. */
export function rowAnchorPos(
  editor: Editor,
  tablePos: number,
  rowIdx: number,
): null | number {
  return findCellPos(editor, tablePos, rowIdx, 0);
}

/** Select the entire column containing the cell at `cellBeforePos`. */
export function selectColumn(editor: Editor, cellBeforePos: number): void {
  const $cell = editor.state.doc.resolve(cellBeforePos);
  const sel = CellSelection.colSelection($cell);
  editor.view.dispatch(editor.state.tr.setSelection(sel));
  editor.view.focus();
}

/** Select the entire row containing the cell at `cellBeforePos`. */
export function selectRow(editor: Editor, cellBeforePos: number): void {
  const $cell = editor.state.doc.resolve(cellBeforePos);
  const sel = CellSelection.rowSelection($cell);
  editor.view.dispatch(editor.state.tr.setSelection(sel));
  editor.view.focus();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- table-selection`
Expected: PASS (all describe blocks). If `forEachCell` is not present on the built `CellSelection`, use `(sel as CellSelection).ranges.length`-based counting instead — but `forEachCell` is part of the prosemirror-tables `CellSelection` API.

- [ ] **Step 5: Point `TableInsertButtons` at the shared `findCellPos`**

In `src/components/toolbar/TableInsertButtons.tsx`:
- Delete the local `findCellPos` function (lines 28-57).
- Update the import block (lines 9-12) to also import it:

```ts
import { getEditorZoom } from "../../utils/zoom-coords";
import { findCellPos } from "./table-selection";
import {
  computeInsertButtonStyle,
  findTableNearPoint,
} from "./table-insert-coords";
```

- [ ] **Step 6: Verify no regression in insert buttons + typecheck**

Run: `npx tsc --noEmit && npm test -- table-insert-buttons-zoom table-selection`
Expected: no TS errors; both suites PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/toolbar/table-selection.ts \
  src/__tests__/unit/table-selection.test.ts \
  src/components/toolbar/TableInsertButtons.tsx
git commit -m "feat(§5.5): shared table-selection helpers (findCellPos, col/row select, handle style)"
```

---

## Task 3: Extract `MenuList` presentational component

**Files:**
- Create: `src/components/toolbar/MenuList.tsx`
- Test: `src/components/__tests__/menu-list.test.tsx`
- Modify: `src/components/toolbar/ContextMenu.tsx:232-284` (render `<MenuList>`)

**Interfaces:**
- Consumes: `MenuItem` (`./context-menu-types` — `{ label: string; action: () => void; separator?: boolean }`).
- Produces: `MenuList({ items, x, y, onClose }: MenuListProps)` where
  `MenuListProps = { items: MenuItem[]; x: number; y: number; onClose: () => void }`.
  Handles viewport clamping, outside-click, and Escape internally; runs `item.action()` then `onClose()` on click.

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/menu-list.test.tsx`:

```tsx
// §4.8 — MenuList presentational context-menu list.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MenuList } from "../toolbar/MenuList";

describe("MenuList", () => {
  it("renders items and separators", () => {
    render(
      <MenuList
        items={[
          { label: "One", action: () => {} },
          { label: "", action: () => {}, separator: true },
          { label: "Two", action: () => {} },
        ]}
        onClose={() => {}}
        x={10}
        y={10}
      />,
    );
    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByText("Two")).toBeTruthy();
    expect(document.querySelector(".context-menu-separator")).toBeTruthy();
  });

  it("runs the action then closes on click", () => {
    const action = vi.fn();
    const onClose = vi.fn();
    render(
      <MenuList items={[{ label: "Go", action }]} onClose={onClose} x={0} y={0} />,
    );
    fireEvent.click(screen.getByText("Go"));
    expect(action).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <MenuList items={[{ label: "Go", action: () => {} }]} onClose={onClose} x={0} y={0} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- menu-list`
Expected: FAIL — cannot resolve `../toolbar/MenuList`.

- [ ] **Step 3: Write the implementation**

Create `src/components/toolbar/MenuList.tsx`:

```tsx
// §4.8 — Presentational context-menu list. Owns viewport clamping, outside-click,
// and Escape close so both ContextMenu (right-click) and TableSelectionHandles
// (grip popup) share one look + behavior.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { MenuItem } from "./context-menu-types";

export interface MenuListProps {
  items: MenuItem[];
  onClose: () => void;
  x: number;
  y: number;
}

export function MenuList({ items, onClose, x, y }: MenuListProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + rect.width > window.innerWidth) nx = window.innerWidth - rect.width - 4;
    if (ny + rect.height > window.innerHeight) ny = window.innerHeight - rect.height - 4;
    if (nx < 0) nx = 4;
    if (ny < 0) ny = 4;
    setAdjusted({ x: nx, y: ny });
  }, [x, y, items]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const runItem = useCallback(
    (item: MenuItem) => {
      item.action();
      onClose();
    },
    [onClose],
  );

  const pos = adjusted ?? { x, y };

  return (
    <div className="context-menu" ref={menuRef} style={{ left: pos.x, top: pos.y }}>
      {items.map((item, i) =>
        item.separator ? (
          <div className="context-menu-separator" key={i} />
        ) : (
          <button className="context-menu-item" key={i} onClick={() => runItem(item)}>
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- menu-list`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor `ContextMenu.tsx` to render `<MenuList>`**

In `src/components/toolbar/ContextMenu.tsx`:
- Add import after line 21: `import { MenuList } from "./MenuList";`
- Remove the now-duplicated close/clamp machinery: delete `menuRef` (line 32), the `handleClick`/`handleKeyDown` handlers and their `addEventListener`/`removeEventListener` registrations inside the effect (lines 212-231 keep only `contextmenu`), the `adjustedPos` state + `useLayoutEffect` clamp (lines 233-254), and the inline render `return (<div className="context-menu">…)` (lines 260-283). Keep `position`, `items`, `closeMenu`, `findSpecialNode`, `buildMenuItems`, and the `contextmenu` listener effect.

The `contextmenu` effect becomes:

```ts
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (!editor.view.dom.contains(e.target as Node)) return;
      e.preventDefault();

      const specialType = findSpecialNode(e.target);
      if (specialType === "mathInline") {
        setItems(buildMathInlineMenu(editor, e.target as HTMLElement));
        setPosition({ x: e.clientX, y: e.clientY });
        return;
      }
      if (specialType === "mermaidBlock") {
        setItems(buildMermaidBlockMenu(editor, e.target as Element));
        setPosition({ x: e.clientX, y: e.clientY });
        return;
      }
      const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!pos) return;
      if (specialType === "mathBlock") {
        setItems(buildMathBlockMenu(editor, pos.pos));
      } else {
        setItems(buildMenuItems(pos.pos));
      }
      setPosition({ x: e.clientX, y: e.clientY });
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, [editor, buildMenuItems, findSpecialNode]);
```

And the render becomes:

```ts
  if (!position) return null;

  return (
    <MenuList items={items} onClose={closeMenu} x={position.x} y={position.y} />
  );
```

Remove the now-unused imports `useLayoutEffect` and `useRef` from the React import (line 2-8) if no longer referenced.

- [ ] **Step 6: Verify context menu still works + typecheck**

Run: `npx tsc --noEmit && npm test -- menu-list`
Expected: no TS errors; menu-list PASS. (No existing ContextMenu unit test; behavior is verified in the GUI pass of Task 4.)

- [ ] **Step 7: Commit**

```bash
git add src/components/toolbar/MenuList.tsx \
  src/components/__tests__/menu-list.test.tsx \
  src/components/toolbar/ContextMenu.tsx
git commit -m "refactor(§4.8): extract MenuList for shared context-menu rendering"
```

---

## Task 4: `TableSelectionHandles` — grips + select + popup

**Files:**
- Create: `src/components/toolbar/TableSelectionHandles.tsx`
- Modify: `src/styles/components.css` (append `.table-select-handle` rules)
- Modify: `src/App.tsx:728-733` (mount the component)

**Interfaces:**
- Consumes (Task 2): `findTableNearPoint` (`./table-insert-coords`), `columnAnchorPos`, `rowAnchorPos`, `selectColumn`, `selectRow`, `computeHandleStyle`, `HandleAnchor`; `buildTableMenu` (`./context-menu-table`); `MenuList` (Task 3); `getEditorZoom`.
- Produces: `TableSelectionHandles({ editor }: { editor: Editor })` React component (default hover overlay, no exported logic).

**Note:** This task delivers select+popup only. Drag wiring is Task 6 (it edits this file to add `onMouseDown` + `isDragging` gating and the drop indicator).

- [ ] **Step 1: Write the component**

Create `src/components/toolbar/TableSelectionHandles.tsx`:

```tsx
// §5.5 — Notion-style row/column grip handles. Hovering the table's top edge
// shows a grip centered over the hovered column; the left edge shows a grip
// centered on the hovered row. Clicking selects the whole column/row (CellSelection)
// and opens a popup of the cell context-menu actions. Drag-to-reorder is added by
// use-table-drag (Task 6). Uses the position:fixed + getEditorZoom() divide pattern.
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import { getEditorZoom } from "../../utils/zoom-coords";
import { buildTableMenu } from "./context-menu-table";
import { MenuList } from "./MenuList";
import { findTableNearPoint } from "./table-insert-coords";
import {
  columnAnchorPos,
  computeHandleStyle,
  type HandleAnchor,
  rowAnchorPos,
  selectColumn,
  selectRow,
} from "./table-selection";

// Detection bands around the table's top/left edges (content-space px × zoom).
const BAND_OUTER = 28;
const BAND_INNER = 18;
// Suppress the grip within this distance of a gridline so TableInsertButtons' ⊕ wins.
const BOUNDARY_DEADZONE = 8;

interface HandleState extends HandleAnchor {
  /** cell-before pos of the anchor cell (row 0 for col, col 0 for row). */
  cellPos: number;
  /** logical column/row index the grip labels. */
  index: number;
  /** PM position of the table node. */
  tablePos: number;
}

/** Resolve the PM position of a table DOM element. */
function findTablePos(editor: Editor, tableEl: HTMLTableElement): null | number {
  let found: null | number = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === "table") {
      const dom = editor.view.nodeDOM(pos);
      if (dom === tableEl || (dom instanceof HTMLElement && dom.contains(tableEl))) {
        found = pos;
        return false;
      }
    }
    return true;
  });
  return found;
}

export function TableSelectionHandles({ editor }: { editor: Editor }) {
  const [handle, setHandle] = useState<HandleState | null>(null);
  const [menu, setMenu] = useState<null | { items: ReturnType<typeof buildTableMenu>; x: number; y: number }>(null);
  const rafRef = useRef(0);
  const latestEventRef = useRef<MouseEvent | null>(null);
  const hoveringRef = useRef(false);

  const computeHandle = useCallback(
    (e: MouseEvent) => {
      const zoom = getEditorZoom();
      const mouse = { x: e.clientX, y: e.clientY };
      const tableEl = findTableNearPoint(mouse.x, mouse.y, {
        left: BAND_OUTER * zoom,
        right: 0,
        top: BAND_OUTER * zoom,
        bottom: 0,
      });
      if (!tableEl) {
        if (!hoveringRef.current) setHandle(null);
        return;
      }
      const tablePos = findTablePos(editor, tableEl);
      if (tablePos === null) return;
      const rect = tableEl.getBoundingClientRect();

      const inTop =
        mouse.y >= rect.top - BAND_OUTER * zoom && mouse.y <= rect.top + BAND_INNER * zoom;
      const inLeft =
        mouse.x >= rect.left - BAND_OUTER * zoom && mouse.x <= rect.left + BAND_INNER * zoom;

      if (inTop && mouse.x >= rect.left) {
        // Column grip: which column does x fall into?
        const firstRow = tableEl.querySelector("tr");
        if (!firstRow) return;
        const cells = Array.from(firstRow.children) as HTMLElement[];
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i].getBoundingClientRect();
          if (mouse.x >= c.left && mouse.x <= c.right) {
            // Deadzone near either vertical gridline → let ⊕ handle inserts.
            if (
              mouse.x - c.left < BOUNDARY_DEADZONE * zoom ||
              c.right - mouse.x < BOUNDARY_DEADZONE * zoom
            ) {
              if (!hoveringRef.current) setHandle(null);
              return;
            }
            const cellPos = columnAnchorPos(editor, tablePos, i);
            if (cellPos === null) return;
            setHandle({
              axis: "col",
              x: (c.left + c.right) / 2,
              y: rect.top,
              cellPos,
              index: i,
              tablePos,
            });
            return;
          }
        }
      } else if (inLeft && mouse.y >= rect.top) {
        // Row grip: which row does y fall into?
        const rows = Array.from(
          tableEl.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr"),
        ) as HTMLElement[];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].getBoundingClientRect();
          if (mouse.y >= r.top && mouse.y <= r.bottom) {
            if (
              mouse.y - r.top < BOUNDARY_DEADZONE * zoom ||
              r.bottom - mouse.y < BOUNDARY_DEADZONE * zoom
            ) {
              if (!hoveringRef.current) setHandle(null);
              return;
            }
            const cellPos = rowAnchorPos(editor, tablePos, i);
            if (cellPos === null) return;
            setHandle({
              axis: "row",
              x: rect.left,
              y: (r.top + r.bottom) / 2,
              cellPos,
              index: i,
              tablePos,
            });
            return;
          }
        }
      } else if (!hoveringRef.current) {
        setHandle(null);
      }
    },
    [editor],
  );

  useEffect(() => {
    const scroll =
      editor.view.dom.closest(".editor-area-scroll") ??
      document.querySelector(".editor-area-scroll");
    if (!scroll) return;

    const onMove = (e: MouseEvent) => {
      latestEventRef.current = e;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const ev = latestEventRef.current;
        if (ev) computeHandle(ev);
      });
    };
    const onLeave = () => {
      if (!hoveringRef.current) setHandle(null);
    };
    const onScroll = () => {
      setHandle(null);
      setMenu(null);
    };
    scroll.addEventListener("mousemove", onMove as EventListener);
    scroll.addEventListener("mouseleave", onLeave);
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroll.removeEventListener("mousemove", onMove as EventListener);
      scroll.removeEventListener("mouseleave", onLeave);
      scroll.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [editor, computeHandle]);

  // Clear on doc change / zoom / resize (stale positions).
  useEffect(() => {
    const clear = () => {
      setHandle(null);
      setMenu(null);
    };
    editor.on("update", clear);
    window.addEventListener("resize", clear);
    return () => {
      editor.off("update", clear);
      window.removeEventListener("resize", clear);
    };
  }, [editor]);

  const openMenu = useCallback(
    (h: HandleState, clientX: number, clientY: number) => {
      if (h.axis === "col") selectColumn(editor, h.cellPos);
      else selectRow(editor, h.cellPos);
      const resolved = editor.state.doc.resolve(h.cellPos + 1);
      const baseItems = [
        { label: "Cut", action: () => { document.execCommand("cut"); } },
        { label: "Copy", action: () => { document.execCommand("copy"); } },
        { label: "Paste", action: () => { document.execCommand("paste"); } },
      ];
      const items = buildTableMenu(editor, resolved, baseItems);
      if (items) setMenu({ items, x: clientX, y: clientY });
    },
    [editor],
  );

  return (
    <>
      {handle && (
        <button
          className={`table-select-handle table-select-handle-${handle.axis}`}
          onClick={(e) => openMenu(handle, e.clientX, e.clientY)}
          onMouseEnter={() => {
            hoveringRef.current = true;
          }}
          onMouseLeave={() => {
            hoveringRef.current = false;
          }}
          style={computeHandleStyle(handle, getEditorZoom())}
          title={handle.axis === "col" ? "Select column" : "Select row"}
          type="button"
        >
          <svg fill="currentColor" height="10" viewBox="0 0 10 10" width="10">
            <circle cx="2.5" cy="2.5" r="1" />
            <circle cx="5" cy="2.5" r="1" />
            <circle cx="7.5" cy="2.5" r="1" />
            <circle cx="2.5" cy="7.5" r="1" />
            <circle cx="5" cy="7.5" r="1" />
            <circle cx="7.5" cy="7.5" r="1" />
          </svg>
        </button>
      )}
      {menu && menu.items && (
        <MenuList items={menu.items} onClose={() => setMenu(null)} x={menu.x} y={menu.y} />
      )}
    </>
  );
}
```

- [ ] **Step 2: Add CSS**

Append to `src/styles/components.css` (after the `.table-insert-btn` block near line 690):

```css
/* §5.5 Table Row/Column Selection Handles — Notion-style grips */
.table-select-handle {
  position: fixed;
  z-index: 50;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: white;
  cursor: pointer;
  background: var(--color-accent-default);
  border: none;
  border-radius: 4px;
  box-shadow: 0 1px 4px rgb(0 0 0 / 15%);
  opacity: 0.9;
  transition: opacity 0.15s, background 0.15s;
}

.table-select-handle:hover {
  opacity: 1;
  background: var(--color-accent-hover);
}

.table-select-handle-col {
  width: 18px;
  height: 14px;
}

.table-select-handle-row {
  width: 14px;
  height: 18px;
}
```

- [ ] **Step 3: Mount in `App.tsx`**

In `src/App.tsx`, add the import alongside the other toolbar imports (near line 30):

```ts
import { TableSelectionHandles } from "./components/toolbar/TableSelectionHandles";
```

And mount it inside the `{activeEditor && (<>…</>)}` block, right after `<TableInsertButtons editor={activeEditor} />` (line 733):

```tsx
                    <TableInsertButtons editor={activeEditor} />
                    <TableSelectionHandles editor={activeEditor} />
```

- [ ] **Step 4: Typecheck + full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no TS errors; suite green (2739+ passing, no new failures).

- [ ] **Step 5: Manual GUI verification (WKWebView)**

Run: `npm run tauri dev` (or the project's dev command). In a document with a table:
1. Hover the top edge over a column (away from gridlines) → a grip appears centered above that column. Move across columns → grip follows.
2. Click the grip → the whole column highlights (`.selectedCell`) and a popup lists the cell menu actions (Cut/Copy/Paste, Add/Delete Row·Column, alignment, Merge/Split when applicable, Toggle Header, Copy as MD/HTML).
3. Run "Delete Column" from the popup → the selected column is removed.
4. Repeat on the left edge for a row grip.
5. Near a gridline, confirm the ⊕ insert button (not the grip) appears — no fighting.
6. Confirm the floating toolbar (above the table) and the grip do not overlap.
7. Set editor zoom to 150% and confirm grips still land on the right column/row.

Record the results (pass/fail per step) in the task notes.

- [ ] **Step 6: Commit**

```bash
git add src/components/toolbar/TableSelectionHandles.tsx src/styles/components.css src/App.tsx
git commit -m "feat(§5.5): Notion-style row/column selection grips with popup menu"
```

---

## Task 5: Reorder logic (move wrappers + boundary mapping + span guard)

**Files:**
- Modify: `src/components/toolbar/table-selection.ts` (append reorder helpers)
- Modify: `src/__tests__/unit/table-selection.test.ts` (append reorder tests)

**Interfaces:**
- Consumes: `moveTableColumn`, `moveTableRow`, `TableMap` (`@tiptap/pm/tables`).
- Produces:
  - `boundaryToDestIndex(from: number, boundaryIndex: number): number`
  - `moveColumn(editor, tablePos: number, from: number, boundaryIndex: number): boolean`
  - `moveRow(editor, tablePos: number, from: number, boundaryIndex: number): boolean`
  - `axisHasSpan(editor, tablePos: number, axis: "col" | "row"): boolean`

- [ ] **Step 1: Write the failing tests (append to `table-selection.test.ts`)**

Add these imports to the existing import from `table-selection`:

```ts
import {
  axisHasSpan,
  boundaryToDestIndex,
  columnAnchorPos,
  computeHandleStyle,
  findCellPos,
  moveColumn,
  moveRow,
  rowAnchorPos,
  selectColumn,
  selectRow,
} from "../../components/toolbar/table-selection";
```

Append these describe blocks:

```ts
/** First-row cell texts, left→right. */
function headerTexts(editor: Editor): string[] {
  const out: string[] = [];
  const table = editor.state.doc.nodeAt(tablePos(editor));
  table?.firstChild?.forEach((cell) => out.push(cell.textContent));
  return out;
}

describe("boundaryToDestIndex", () => {
  it("maps a right-side boundary to remove-then-insert index", () => {
    expect(boundaryToDestIndex(0, 3)).toBe(2); // drag col0 to far right of 3 cols
    expect(boundaryToDestIndex(2, 0)).toBe(0); // drag col2 to far left
    expect(boundaryToDestIndex(1, 1)).toBe(1); // onto its own left edge
  });
});

describe("moveColumn / moveRow", () => {
  it("moves the first column to the far right", () => {
    const editor = makeEditor();
    const tp = tablePos(editor);
    expect(headerTexts(editor)).toEqual(["A", "B", "C"]);
    const ok = moveColumn(editor, tp, 0, 3); // boundary after last col
    expect(ok).toBe(true);
    expect(headerTexts(editor)).toEqual(["B", "C", "A"]);
  });

  it("no-ops when dropping onto its own edge", () => {
    const editor = makeEditor();
    const tp = tablePos(editor);
    expect(moveColumn(editor, tp, 1, 1)).toBe(false);
    expect(headerTexts(editor)).toEqual(["A", "B", "C"]);
  });

  it("moves a row (row 0 → below row 1) changing the header row", () => {
    const editor = makeEditor();
    const tp = tablePos(editor);
    const ok = moveRow(editor, tp, 0, 2); // boundary after last row
    expect(ok).toBe(true);
    // header row is now the old data row → first cell text is "1"
    expect(headerTexts(editor)[0]).toBe("1");
  });
});

describe("axisHasSpan (merged-cell guard)", () => {
  it("is false for a plain table", () => {
    const editor = makeEditor();
    expect(axisHasSpan(editor, tablePos(editor), "col")).toBe(false);
    expect(axisHasSpan(editor, tablePos(editor), "row")).toBe(false);
  });

  it("detects colspan / rowspan", () => {
    const e = new Editor({
      extensions: createBaramExtensions(),
      content:
        "<table><tr><th colspan='2'>AB</th></tr>" +
        "<tr><td>1</td><td>2</td></tr></table>",
    });
    editors.push(e);
    expect(axisHasSpan(e, tablePos(e), "col")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- table-selection`
Expected: FAIL — `boundaryToDestIndex`, `moveColumn`, `moveRow`, `axisHasSpan` not exported.

- [ ] **Step 3: Implement (append to `table-selection.ts`)**

Add the import at the top (extend the existing `@tiptap/pm/tables` import):

```ts
import {
  CellSelection,
  moveTableColumn,
  moveTableRow,
  TableMap,
} from "@tiptap/pm/tables";
```

Append these functions:

```ts
/**
 * Translate a drop boundary (0..N, the gridline the indicator snapped to) into the
 * destination index for moveTable*'s remove-then-insert semantics. Dropping to the
 * right of the source shifts the target left by one (the source is removed first).
 */
export function boundaryToDestIndex(from: number, boundaryIndex: number): number {
  return boundaryIndex > from ? boundaryIndex - 1 : boundaryIndex;
}

/** Move a column; returns false on a no-op (same slot). */
export function moveColumn(
  editor: Editor,
  tablePos: number,
  from: number,
  boundaryIndex: number,
): boolean {
  const to = boundaryToDestIndex(from, boundaryIndex);
  if (to === from) return false;
  return moveTableColumn({ from, to, pos: tablePos + 1 })(
    editor.state,
    editor.view.dispatch,
  );
}

/** Move a row; returns false on a no-op (same slot). */
export function moveRow(
  editor: Editor,
  tablePos: number,
  from: number,
  boundaryIndex: number,
): boolean {
  const to = boundaryToDestIndex(from, boundaryIndex);
  if (to === from) return false;
  return moveTableRow({ from, to, pos: tablePos + 1 })(
    editor.state,
    editor.view.dispatch,
  );
}

/**
 * True if any cell in the table spans more than one column ("col") or row ("row").
 * Conservative merged-cell guard: reorder is disabled for spanned tables in v1
 * because moveTable* can corrupt geometry across a span.
 */
export function axisHasSpan(
  editor: Editor,
  tablePos: number,
  axis: "col" | "row",
): boolean {
  const table = editor.state.doc.nodeAt(tablePos);
  if (!table) return false;
  const attr = axis === "col" ? "colspan" : "rowspan";
  let found = false;
  table.descendants((n) => {
    if (found) return false;
    const role = n.type.spec.tableRole;
    if (role === "cell" || role === "header_cell") {
      if (((n.attrs[attr] as number | undefined) ?? 1) > 1) {
        found = true;
        return false;
      }
    }
    return true;
  });
  return found;
}
```

Note: `TableMap` is imported for use by the drop-indicator boundary math in Task 6; if lint flags it as unused after this task, add the boundary helper from Task 6 in the same commit or leave the import out until Task 6. Prefer to keep this task's diff lint-clean — omit `TableMap` from the import here and add it in Task 6.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- table-selection`
Expected: PASS. If `moveColumn(editor, tp, 0, 3)` does not yield `["B","C","A"]`, the library's `to` convention differs from remove-then-insert — adjust `boundaryToDestIndex` (drop the `-1`) and update the test's expected index accordingly, then re-run until the resulting **column order** matches `["B","C","A"]`. The column-order assertion, not the index, is the contract.

- [ ] **Step 5: Commit**

```bash
git add src/components/toolbar/table-selection.ts src/__tests__/unit/table-selection.test.ts
git commit -m "feat(§5.5): table column/row reorder helpers + merged-cell guard"
```

---

## Task 6: Drag-to-reorder — `use-table-drag` + drop indicator + integration

**Files:**
- Create: `src/components/toolbar/use-table-drag.ts`
- Modify: `src/components/toolbar/table-selection.ts` (add `computeDropIndicatorStyle` + boundary finder)
- Modify: `src/__tests__/unit/table-selection.test.ts` (test the pure additions)
- Modify: `src/components/toolbar/TableSelectionHandles.tsx` (wire drag + render indicator)
- Modify: `src/styles/components.css` (`.table-drop-indicator`)

**Interfaces:**
- Produces (in `table-selection.ts`):
  - `nearestBoundaryIndex(edges: number[], coord: number): number` — given sorted gridline coords and a cursor coord, the nearest boundary index (0..edges.length-1).
  - `computeDropIndicatorStyle(axis, boundaryCoord: number, tableRect: DOMRect, zoom: number): { left: number; top: number; width: number; height: number }`
- Produces (in `use-table-drag.ts`):
  - `useTableDrag(editor): { isDragging: boolean; startDrag: (e: React.MouseEvent, spec: TableDragSpec) => void; indicator: DropIndicatorState | null }`
  - `TableDragSpec = { axis: "col" | "row"; from: number; tablePos: number; edges: number[]; tableRect: DOMRect }`
  - `DropIndicatorState = { axis: "col" | "row"; boundaryCoord: number; tableRect: DOMRect }`

- [ ] **Step 1: Write failing tests for the pure additions (append to `table-selection.test.ts`)**

```ts
import {
  computeDropIndicatorStyle,
  nearestBoundaryIndex,
} from "../../components/toolbar/table-selection";

describe("nearestBoundaryIndex", () => {
  it("snaps to the closest gridline", () => {
    const edges = [100, 200, 320]; // 2 columns → 3 boundaries
    expect(nearestBoundaryIndex(edges, 105)).toBe(0);
    expect(nearestBoundaryIndex(edges, 170)).toBe(1);
    expect(nearestBoundaryIndex(edges, 400)).toBe(2);
  });
});

describe("computeDropIndicatorStyle", () => {
  const rect = { left: 100, top: 50, width: 300, height: 120 } as DOMRect;
  it("draws a vertical line for a column drop (zoom 1)", () => {
    expect(computeDropIndicatorStyle("col", 200, rect, 1)).toEqual({
      left: 200,
      top: 50,
      width: 2,
      height: 120,
    });
  });
  it("draws a horizontal line for a row drop and divides by zoom", () => {
    expect(computeDropIndicatorStyle("row", 90, rect, 2)).toEqual({
      left: 100 / 2,
      top: 90 / 2,
      width: 300 / 2,
      height: 2,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- table-selection`
Expected: FAIL — `nearestBoundaryIndex` / `computeDropIndicatorStyle` not exported.

- [ ] **Step 3: Implement the pure additions (append to `table-selection.ts`)**

```ts
/** Index of the gridline in `edges` nearest to `coord`. */
export function nearestBoundaryIndex(edges: number[], coord: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < edges.length; i++) {
    const d = Math.abs(edges[i] - coord);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Fixed-overlay style for the drop indicator line. `boundaryCoord` is the visual x
 * (col) or y (row) of the snapped gridline; tableRect gives the cross-axis span.
 * Visual coords divide by zoom (fixed element inside the zoom container); the 2px
 * thickness is content-space.
 */
export function computeDropIndicatorStyle(
  axis: "col" | "row",
  boundaryCoord: number,
  tableRect: DOMRect,
  zoom: number,
): { height: number; left: number; top: number; width: number } {
  if (axis === "col") {
    return {
      left: boundaryCoord / zoom,
      top: tableRect.top / zoom,
      width: 2,
      height: tableRect.height / zoom,
    };
  }
  return {
    left: tableRect.left / zoom,
    top: boundaryCoord / zoom,
    width: tableRect.width / zoom,
    height: 2,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- table-selection`
Expected: PASS.

- [ ] **Step 5: Create `use-table-drag.ts`**

```ts
// §5.5 — drag a column/row grip to reorder (Notion-style). Mouse-event only
// (WKWebView HTML5 DnD is broken), modeled on use-block-drag.ts: a 5px threshold
// distinguishes click (select+popup) from drag (reorder); isDragging clears on a
// setTimeout so the trailing click is suppressed.
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import {
  computeDropIndicatorStyle,
  moveColumn,
  moveRow,
  nearestBoundaryIndex,
} from "./table-selection";

const DRAG_THRESHOLD_PX = 5;

export interface TableDragSpec {
  axis: "col" | "row";
  /** sorted gridline coords (visual px): x for columns, y for rows. */
  edges: number[];
  from: number;
  tableRect: DOMRect;
  tablePos: number;
}

export interface DropIndicatorState {
  axis: "col" | "row";
  boundaryCoord: number;
  tableRect: DOMRect;
}

interface DragRef extends TableDragSpec {
  active: boolean;
  startX: number;
  startY: number;
}

export function useTableDrag(editor: Editor): {
  indicator: DropIndicatorState | null;
  isDragging: boolean;
  startDrag: (e: React.MouseEvent, spec: TableDragSpec) => void;
} {
  const [isDragging, setIsDragging] = useState(false);
  const [indicator, setIndicator] = useState<DropIndicatorState | null>(null);
  const dragRef = useRef<DragRef | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragRef.current;
      if (!s) return;
      if (!s.active) {
        if (Math.abs(e.clientX - s.startX) + Math.abs(e.clientY - s.startY) <= DRAG_THRESHOLD_PX)
          return;
        s.active = true;
        setIsDragging(true);
        document.body.classList.add("table-dragging");
        window.getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      const coord = s.axis === "col" ? e.clientX : e.clientY;
      const bi = nearestBoundaryIndex(s.edges, coord);
      setIndicator({ axis: s.axis, boundaryCoord: s.edges[bi], tableRect: s.tableRect });
    };

    const onUp = (e: MouseEvent) => {
      const s = dragRef.current;
      dragRef.current = null;
      setIndicator(null);
      document.body.classList.remove("table-dragging");
      if (!s || !s.active) {
        setIsDragging(false);
        return; // a click — select+popup handles it
      }
      setTimeout(() => setIsDragging(false), 0);
      const coord = s.axis === "col" ? e.clientX : e.clientY;
      const bi = nearestBoundaryIndex(s.edges, coord);
      if (s.axis === "col") moveColumn(editor, s.tablePos, s.from, bi);
      else moveRow(editor, s.tablePos, s.from, bi);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("table-dragging");
    };
  }, [editor]);

  const startDrag = useCallback((e: React.MouseEvent, spec: TableDragSpec) => {
    if (e.button !== 0) return;
    dragRef.current = { ...spec, active: false, startX: e.clientX, startY: e.clientY };
  }, []);

  return { indicator, isDragging, startDrag };
}

/** Re-export so consumers get the indicator style from one import site. */
export { computeDropIndicatorStyle };
```

- [ ] **Step 6: Wire drag into `TableSelectionHandles.tsx`**

Imports: `getEditorZoom` is **already imported** (Task 4) — do not re-add it. Add `axisHasSpan` to the **existing** `./table-selection` import (merge into that import list, don't add a second import from the same module — `import/no-duplicates` will flag it). Add one new import:

```ts
import { computeDropIndicatorStyle, useTableDrag } from "./use-table-drag";
```

Inside the component, after the state hooks, add:

```ts
  const { indicator, isDragging, startDrag } = useTableDrag(editor);
```

Add a helper to collect gridline edges for a table + axis (place above the return). `nodeDOM` may return the `.tableWrapper` div (columnResizing wraps the table in a TableView), so resolve the `<table>` robustly:

```ts
  const collectEdges = useCallback(
    (h: HandleState): { edges: number[]; tableRect: DOMRect } | null => {
      const dom = editor.view.nodeDOM(h.tablePos);
      const tableEl =
        dom instanceof HTMLTableElement
          ? dom
          : dom instanceof HTMLElement
            ? dom.querySelector("table")
            : null;
      if (!tableEl) return null;
      const tableRect = tableEl.getBoundingClientRect();
      if (h.axis === "col") {
        const firstRow = tableEl.querySelector("tr");
        if (!firstRow) return null;
        const cells = Array.from(firstRow.children) as HTMLElement[];
        const edges = [cells[0].getBoundingClientRect().left];
        cells.forEach((c) => edges.push(c.getBoundingClientRect().right));
        return { edges, tableRect };
      }
      const rows = Array.from(
        tableEl.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr"),
      ) as HTMLElement[];
      const edges = [rows[0].getBoundingClientRect().top];
      rows.forEach((r) => edges.push(r.getBoundingClientRect().bottom));
      return { edges, tableRect };
    },
    [editor],
  );
```

Update the grip `<button>`: add `onMouseDown` to start a drag (unless the table has a span on that axis), and guard the click with `isDragging`:

```tsx
        <button
          className={`table-select-handle table-select-handle-${handle.axis}`}
          onClick={(e) => {
            if (isDragging) return; // a drag just ended — don't open the menu
            openMenu(handle, e.clientX, e.clientY);
          }}
          onMouseDown={(e) => {
            if (axisHasSpan(editor, handle.tablePos, handle.axis)) return; // merged cells → click-only
            const info = collectEdges(handle);
            if (!info) return;
            startDrag(e, {
              axis: handle.axis,
              from: handle.index,
              tablePos: handle.tablePos,
              edges: info.edges,
              tableRect: info.tableRect,
            });
          }}
          onMouseEnter={() => {
            hoveringRef.current = true;
          }}
          onMouseLeave={() => {
            hoveringRef.current = false;
          }}
          style={computeHandleStyle(handle, getEditorZoom())}
          title={handle.axis === "col" ? "Select or drag column" : "Select or drag row"}
          type="button"
        >
```

Render the indicator (inside the fragment, after the `{menu && …}` block):

```tsx
      {indicator && (
        <div
          className="table-drop-indicator"
          style={computeDropIndicatorStyle(
            indicator.axis,
            indicator.boundaryCoord,
            indicator.tableRect,
            getEditorZoom(),
          )}
        />
      )}
```

- [ ] **Step 7: Add CSS**

Append to `src/styles/components.css` (after `.table-select-handle-row`):

```css
/* §5.5 Table drag-to-reorder drop indicator */
.table-drop-indicator {
  position: fixed;
  z-index: 51;
  pointer-events: none;
  background: var(--color-accent-default);
  border-radius: 1px;
}

body.table-dragging {
  cursor: grabbing;
  user-select: none;
}
```

- [ ] **Step 8: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no TS errors; suite green.

- [ ] **Step 9: Manual GUI verification (WKWebView)**

Run the dev app. In a table:
1. Press and drag a column grip sideways → a vertical drop indicator snaps to the nearest gridline; release → the column lands at that position.
2. A plain click (no movement) still selects + opens the popup (does not reorder).
3. Drag a row grip vertically → horizontal indicator; release reorders the row.
4. In a table with a merged cell (colspan or rowspan), the grip still selects on click but does not initiate a drag on that axis.
5. Verify at 150% zoom the indicator and drop position are correct.

Record pass/fail per step.

- [ ] **Step 10: Commit**

```bash
git add src/components/toolbar/use-table-drag.ts \
  src/components/toolbar/table-selection.ts \
  src/components/toolbar/TableSelectionHandles.tsx \
  src/__tests__/unit/table-selection.test.ts \
  src/styles/components.css
git commit -m "feat(§5.5): drag-to-reorder table rows/columns with drop indicator"
```

---

## Final Verification

- [ ] **Full suite + typecheck**: `npx tsc --noEmit && npm test` — green, no new failures (baseline 2739 passing).
- [ ] **Lint/knip if part of CI**: run the project's lint (`npm run lint` if present) to confirm no unused imports (esp. the `TableMap`/re-export notes).
- [ ] **Manual GUI sign-off**: Tasks 4 & 6 GUI checklists all pass in WKWebView, including a non-1 zoom pass.
- [ ] **Update memory/spec status** if desired (not required by this plan).
- [ ] **Finish the branch** via superpowers:finishing-a-development-branch (PR per project PR style: motivation, design, architecture, implementation, tests, checklist).

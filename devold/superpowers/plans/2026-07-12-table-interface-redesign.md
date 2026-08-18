# Table Interface Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the three overlapping table UI surfaces into one context-aware Typora-style smart toolbar, removing the redundant grip popup and the top-edge collision.

**Architecture:** Keep the Notion-style hover affordances (⊕ insert, ⣿ grip for selection + drag-reorder) but make the floating `TableToolbar` the single command surface. Clicking a grip selects a row/column, which raises the toolbar's *Selection* variant — so the grip's dropdown popup is deleted, its commands covered by the toolbar plus the existing right-click menu. A shared module publishes the toolbar's rect so ⊕/grips suppress themselves only where they'd render under the toolbar (footprint-only deconfliction).

**Tech Stack:** React 19 + TypeScript (strict), Tiptap/ProseMirror v2 (`@tiptap/pm/tables`), Vitest.

## Global Constraints

- TypeScript strict mode; functional components + hooks only; file names kebab-case.
- Tests run via `npm test` (→ `vitest run`). Never use jest.
- Pure logic lives in `.ts` modules with unit tests; `.tsx` files export only components (react-refresh/only-export-components) — follow the existing `table-*-coords.ts` / `table-selection.ts` split.
- Conventional Commits; every commit subject carries the `§5.5` reference.
- No ProseMirror schema or pipeline/transformer changes — Markdown round-trip must stay byte-identical.
- Keep single files ≤ ~300 lines where reasonable.
- Branch: `feature/table-interface-redesign` (already checked out).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/components/toolbar/table-toolbar-rect.ts` | Shared signal: current toolbar rect + `isUnderToolbar` footprint test | **Create** |
| `src/components/toolbar/context-menu-table.ts` | Table menu builders; add `buildTableOverflowItems` for the toolbar `⋯` | Modify |
| `src/components/toolbar/table-toolbar-position.ts` | Toolbar clamp math; raise `GAP` | Modify |
| `src/components/toolbar/TableToolbar.tsx` | Context-aware variants + `⋯` overflow + publish rect | Modify |
| `src/components/toolbar/TableSelectionHandles.tsx` | Grip = select-only (remove popup) + col-grip suppression | Modify |
| `src/components/toolbar/TableInsertButtons.tsx` | Col ⊕ footprint suppression | Modify |
| `src/__tests__/unit/table-toolbar-rect.test.ts` | Unit tests for `isUnderToolbar` | **Create** |
| `src/__tests__/unit/table-toolbar-position.test.ts` | Update for new `GAP` | Modify |
| `src/__tests__/unit/table-toolbar-overflow.test.ts` | Unit tests for `buildTableOverflowItems` | **Create** |

Task order: 1 (rect module) → 2 (position GAP) → 3 (overflow items) → 4 (toolbar wiring) → 5 (handles: remove popup + suppress) → 6 (insert buttons: suppress). Foundations first; consumers last.

---

### Task 1: Shared toolbar-rect signal + `isUnderToolbar`

**Files:**
- Create: `src/components/toolbar/table-toolbar-rect.ts`
- Test: `src/__tests__/unit/table-toolbar-rect.test.ts`

**Interfaces:**
- Consumes: `isPointNearRect` from `./table-insert-coords`.
- Produces:
  - `setTableToolbarRect(rect: DOMRect | null): void`
  - `getTableToolbarRect(): DOMRect | null`
  - `isUnderToolbar(x: number, y: number, rect: DOMRect | null, margin?: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/unit/table-toolbar-rect.test.ts`:

```ts
// §5.5 — footprint-suppression geometry for the table toolbar rect signal.
import { describe, expect, it } from "vitest";

import {
  getTableToolbarRect,
  isUnderToolbar,
  setTableToolbarRect,
} from "../../components/toolbar/table-toolbar-rect";

// A toolbar occupying x ∈ [200, 400], y ∈ [100, 132] (visual-viewport px).
const rect = { left: 200, right: 400, top: 100, bottom: 132 } as DOMRect;

describe("isUnderToolbar", () => {
  it("is false when the rect is null (toolbar hidden)", () => {
    expect(isUnderToolbar(300, 132, null)).toBe(false);
  });

  it("is true for a point inside the horizontal footprint at the table edge", () => {
    // grip/⊕ sits just below the toolbar bottom (132) → within default margin 16
    expect(isUnderToolbar(300, 140, rect)).toBe(true);
  });

  it("is false for a point outside the horizontal footprint", () => {
    // same y, but x left of the toolbar → the ⊕ there must still show
    expect(isUnderToolbar(150, 140, rect)).toBe(false);
  });

  it("is false for a point vertically far from the toolbar", () => {
    // deep inside a tall table, far below the toolbar → not suppressed
    expect(isUnderToolbar(300, 400, rect)).toBe(false);
  });

  it("respects a custom margin", () => {
    expect(isUnderToolbar(300, 150, rect, 4)).toBe(false); // 150 > 132 + 4
    expect(isUnderToolbar(300, 150, rect, 32)).toBe(true); // 150 < 132 + 32
  });

  it("round-trips the stored rect via the setter/getter", () => {
    setTableToolbarRect(rect);
    expect(getTableToolbarRect()).toBe(rect);
    setTableToolbarRect(null);
    expect(getTableToolbarRect()).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- table-toolbar-rect`
Expected: FAIL — cannot resolve `../../components/toolbar/table-toolbar-rect`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/toolbar/table-toolbar-rect.ts`:

```ts
// §5.5 — Shared signal: the floating table toolbar's current visual-viewport
// rect, so hover affordances (TableInsertButtons ⊕, TableSelectionHandles grip)
// can suppress themselves where they'd render under the toolbar (footprint-only
// deconfliction). Read synchronously from mousemove handlers — no React state,
// so no re-render churn on the hover hot path.
import { isPointNearRect } from "./table-insert-coords";

let toolbarRect: DOMRect | null = null;

/** Publish the toolbar's rect (visual-viewport space) or null when hidden. */
export function setTableToolbarRect(rect: DOMRect | null): void {
  toolbarRect = rect;
}

/** Current toolbar rect, or null when the toolbar is hidden. */
export function getTableToolbarRect(): DOMRect | null {
  return toolbarRect;
}

/**
 * True when (x, y) falls within the toolbar's horizontal footprint AND is
 * vertically adjacent to it (within `margin` px above/below). Used to hide a
 * top-edge ⊕/grip candidate that would collide with the toolbar. A null rect
 * (toolbar hidden) always returns false, so affordances show normally.
 */
export function isUnderToolbar(
  x: number,
  y: number,
  rect: DOMRect | null,
  margin = 16,
): boolean {
  if (!rect) return false;
  return isPointNearRect(x, y, rect, {
    left: 0,
    right: 0,
    top: margin,
    bottom: margin,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- table-toolbar-rect`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/toolbar/table-toolbar-rect.ts src/__tests__/unit/table-toolbar-rect.test.ts
git commit -m "feat(§5.5): add shared table-toolbar rect signal + isUnderToolbar"
```

---

### Task 2: Raise the toolbar clearance gap

**Files:**
- Modify: `src/components/toolbar/table-toolbar-position.ts:29`
- Test: `src/__tests__/unit/table-toolbar-position.test.ts:19-21`

**Interfaces:**
- Consumes: nothing new.
- Produces: unchanged `computeToolbarTop` signature; only the `GAP` constant value changes (6 → 20).

- [ ] **Step 1: Update the failing test**

In `src/__tests__/unit/table-toolbar-position.test.ts`, change the first case's expected top from `162` to `148` and its comment:

```ts
  it("sits above the table when the table top is visible", () => {
    // table top at viewport-relative 200 → desired = 200 - 32 - 20 = 148
    const r: ToolbarRects = { ...base, tableTop: 300, tableBottom: 500 };
    expect(computeToolbarTop(r)).toEqual({ visible: true, top: 148 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- table-toolbar-position`
Expected: FAIL — received `{ visible: true, top: 162 }`, expected `top: 148`.

- [ ] **Step 3: Change the GAP constant**

In `src/components/toolbar/table-toolbar-position.ts`, replace the `GAP` line:

```ts
/**
 * Gap between the toolbar bottom and the table top when the top is visible.
 * Wide enough to clear the grip/⊕ upward protrusion (~16px) so the toolbar and
 * the hover affordances never visually kiss at the table's top edge (§5.5).
 */
const GAP = 20;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- table-toolbar-position`
Expected: PASS (4 tests — the clamp/hide cases are unaffected since `max(desired, 4)` still yields 4, and the hide guards don't use `GAP`).

- [ ] **Step 5: Commit**

```bash
git add src/components/toolbar/table-toolbar-position.ts src/__tests__/unit/table-toolbar-position.test.ts
git commit -m "fix(§5.5): widen table toolbar clearance gap to clear grip/⊕ band"
```

---

### Task 3: `buildTableOverflowItems` for the toolbar `⋯` menu

**Files:**
- Modify: `src/components/toolbar/context-menu-table.ts` (add export; reuse `findTableAtCursor`)
- Test: `src/__tests__/unit/table-toolbar-overflow.test.ts` (Create)

**Interfaces:**
- Consumes: `Editor`, existing `findTableAtCursor`, `prosemirrorToMarkdown`, `MenuItem`.
- Produces: `buildTableOverflowItems(editor: Editor): MenuItem[]` — a fixed 7-entry list: Toggle Header Row, Toggle Header Column, separator, Copy as Markdown, Copy as HTML, separator, Delete Table.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/unit/table-toolbar-overflow.test.ts`:

```ts
// §5.5 — the toolbar ⋯ overflow menu item list (labels + order, no editor DOM).
import { describe, expect, it, vi } from "vitest";

import type { Editor } from "@tiptap/react";

import { buildTableOverflowItems } from "../../components/toolbar/context-menu-table";

// A stub editor: buildTableOverflowItems only wires actions; constructing the
// item list must not touch editor state, so a bare stub is enough.
const editor = {} as unknown as Editor;

describe("buildTableOverflowItems", () => {
  it("lists header toggles, copies, and delete-table separated into 3 groups", () => {
    const items = buildTableOverflowItems(editor);
    const labels = items.map((i) => (i.separator ? "---" : i.label));
    expect(labels).toEqual([
      "Toggle Header Row",
      "Toggle Header Column",
      "---",
      "Copy as Markdown",
      "Copy as HTML",
      "---",
      "Delete Table",
    ]);
  });

  it("gives every non-separator item a callable action", () => {
    const items = buildTableOverflowItems(editor);
    for (const item of items.filter((i) => !i.separator)) {
      expect(typeof item.action).toBe("function");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- table-toolbar-overflow`
Expected: FAIL — `buildTableOverflowItems` is not exported.

- [ ] **Step 3: Implement `buildTableOverflowItems`**

In `src/components/toolbar/context-menu-table.ts`, add this export below `buildTableMenu` (it reuses the existing `findTableAtCursor` and `prosemirrorToMarkdown` already imported in this file):

```ts
/**
 * The item list for the table toolbar's `⋯` overflow menu (§5.5). These are the
 * lower-frequency commands kept out of the compact primary toolbar row. Rendered
 * by the shared MenuList, same as the right-click context menu.
 */
export function buildTableOverflowItems(editor: Editor): MenuItem[] {
  return [
    {
      label: "Toggle Header Row",
      action: () => editor.chain().focus().toggleHeaderRow().run(),
    },
    {
      label: "Toggle Header Column",
      action: () => editor.chain().focus().toggleHeaderColumn().run(),
    },
    { label: "", action: () => {}, separator: true },
    {
      label: "Copy as Markdown",
      action: () => {
        const table = findTableAtCursor(editor);
        if (!table || !table.node) return;
        const tempDoc = editor.schema.nodes.doc.create(null, [table.node]);
        navigator.clipboard.writeText(prosemirrorToMarkdown(tempDoc).trim());
      },
    },
    {
      label: "Copy as HTML",
      action: () => {
        const table = findTableAtCursor(editor);
        if (!table) return;
        const dom = editor.view.nodeDOM(table.pos);
        if (dom && dom instanceof HTMLElement) {
          navigator.clipboard.writeText(dom.outerHTML);
        }
      },
    },
    { label: "", action: () => {}, separator: true },
    {
      label: "Delete Table",
      action: () => editor.chain().focus().deleteTable().run(),
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- table-toolbar-overflow`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/toolbar/context-menu-table.ts src/__tests__/unit/table-toolbar-overflow.test.ts
git commit -m "feat(§5.5): add buildTableOverflowItems for table toolbar overflow"
```

---

### Task 4: Rewire `TableToolbar` — variants, `⋯` overflow, publish rect

**Files:**
- Modify: `src/components/toolbar/TableToolbar.tsx`

**Interfaces:**
- Consumes: `buildTableOverflowItems` (Task 3), `MenuList` + `MenuListProps` (existing), `setTableToolbarRect` (Task 1), `CellSelection`.
- Produces: no new exports; behavioral contract — primary row differs by selection type, low-frequency commands live under `⋯`, and the toolbar's rect is published whenever visible.

This task has no isolated unit (it is React wiring on top of Task 3's tested logic). Each step shows the exact edit; verification is `tsc` + `npm test` (no regressions) + the manual check in Step 9.

- [ ] **Step 1: Add imports**

At the top of `TableToolbar.tsx`, add:

```ts
import { useLayoutEffect } from "react"; // add to the existing react import group
import { buildTableOverflowItems } from "./context-menu-table";
import { MenuList } from "./MenuList";
import { setTableToolbarRect } from "./table-toolbar-rect";
```

(Merge `useLayoutEffect` into the existing `import { ... } from "react"` line rather than adding a second import.)

- [ ] **Step 2: Add selection-variant + overflow state**

Inside `TableToolbar`, alongside the existing `useState` calls, add:

```ts
const [isSelection, setIsSelection] = useState(false);
const [overflow, setOverflow] = useState<null | { x: number; y: number }>(null);
// Mirrors the grip popup's toggle guard: MenuList closes on the ⋯ mousedown
// (document listener) before onClick fires, so onClick must not re-open when it
// was already open. Captured in the ⋯ button's onMouseDown.
const overflowWasOpenRef = useRef(false);
```

- [ ] **Step 3: Record the variant inside `updatePosition`**

In `updatePosition`, right after `const isCellSel = selection instanceof CellSelection;`, add:

```ts
    setIsSelection(isCellSel);
```

- [ ] **Step 4: Publish the toolbar rect**

After the `useEffect` that wires `selectionUpdate`/`transaction`/`scroll`, add a layout effect that publishes the rect on every position/visibility change and clears it on unmount:

```ts
  // §5.5 — publish our rect so TableInsertButtons/TableSelectionHandles can
  // suppress the top-edge ⊕/grip that would render under this toolbar.
  useLayoutEffect(() => {
    setTableToolbarRect(
      visible && toolbarRef.current
        ? toolbarRef.current.getBoundingClientRect()
        : null,
    );
  }, [visible, position]);

  useEffect(() => () => setTableToolbarRect(null), []);
```

- [ ] **Step 5: Gate merge/split on the Selection variant**

Wrap the existing Merge and Split buttons (and their trailing separator) so they render only in the Selection variant. Replace the block:

```tsx
      <div className="table-toolbar-separator" />
      <button
        className="table-toolbar-btn"
        disabled={!editor.can().mergeCells()}
        onClick={() => editor.chain().focus().mergeCells().run()}
        title="Merge Cells (⌘M)"
      >
        <MergeCellsIcon />
      </button>
      <button
        className="table-toolbar-btn"
        disabled={!editor.can().splitCell()}
        onClick={() => editor.chain().focus().splitCell().run()}
        title="Split Cell"
      >
        <SplitCellsIcon />
      </button>
```

with:

```tsx
      {isSelection && (
        <>
          <div className="table-toolbar-separator" />
          <button
            className="table-toolbar-btn"
            disabled={!editor.can().mergeCells()}
            onClick={() => editor.chain().focus().mergeCells().run()}
            title="Merge Cells (⌘M)"
          >
            <MergeCellsIcon />
          </button>
          <button
            className="table-toolbar-btn"
            disabled={!editor.can().splitCell()}
            onClick={() => editor.chain().focus().splitCell().run()}
            title="Split Cell"
          >
            <SplitCellsIcon />
          </button>
        </>
      )}
```

- [ ] **Step 6: Remove the header-toggle buttons from the primary row**

Delete the two header-toggle buttons and their bounding separators (they move to `⋯`). Remove this block entirely:

```tsx
      <div className="table-toolbar-separator" />
      <button
        className="table-toolbar-btn"
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
        title="Toggle Header Row"
      >
        <HeaderRowIcon />
      </button>
      <button
        className="table-toolbar-btn"
        onClick={() => editor.chain().focus().toggleHeaderColumn().run()}
        title="Toggle Header Column"
      >
        <HeaderColIcon />
      </button>
```

- [ ] **Step 7: Remove Copy-as / Delete-Table primary buttons; replace the trailing group with `⋯`**

Delete the Copy-as-Markdown, Copy-as-HTML buttons and their separator, and the final Delete-Table button and its separator (Delete Table moves to `⋯`). Keep the AI button. Then, immediately after the AI button, add the overflow trigger + menu. The tail of the JSX (from the AI button onward) should read:

```tsx
      <div className="table-toolbar-separator" />
      <button
        className="table-toolbar-btn table-toolbar-btn-ai"
        onClick={(e) => {
          const table = findTable(editor);
          if (!table || !table.node) return;
          const tempDoc = editor.schema.nodes.doc.create(null, [table.node]);
          const md = prosemirrorToMarkdown(tempDoc).trim();
          if (!md) return;
          showNodeViewAIMenu(e.currentTarget, "table", md, editor, table.pos);
        }}
        title="AI Commands"
      >
        <Sparkles size={14} />
      </button>
      <div className="table-toolbar-separator" />
      <button
        aria-label="More table options"
        className="table-toolbar-btn"
        onMouseDown={() => {
          overflowWasOpenRef.current = overflow !== null;
        }}
        onClick={(e) => {
          if (overflowWasOpenRef.current) {
            setOverflow(null);
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          setOverflow({ x: r.left, y: r.bottom + 4 });
        }}
        title="More"
      >
        <MoreIcon />
      </button>
```

Then, after the closing `</div>` of the `.table-toolbar` container, wrap the return in a fragment and render the overflow menu:

```tsx
  if (!visible) return null;

  return (
    <>
      <div
        className="table-toolbar"
        onMouseDown={(e) => e.preventDefault()}
        ref={toolbarRef}
        style={{ top: position.top, left: position.left }}
      >
        {/* ...all the buttons... */}
      </div>
      {overflow && (
        <MenuList
          items={buildTableOverflowItems(editor)}
          onClose={() => setOverflow(null)}
          x={overflow.x}
          y={overflow.y}
        />
      )}
    </>
  );
```

- [ ] **Step 8: Add the `MoreIcon` and drop now-unused icon components**

Add a `MoreIcon` (three horizontal dots) next to the other inline icon definitions:

```tsx
// Overflow icon: horizontal three-dot "more" glyph
const MoreIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.6}>
    <circle cx="3.5" cy="8" fill="currentColor" r="1.1" stroke="none" />
    <circle cx="8" cy="8" fill="currentColor" r="1.1" stroke="none" />
    <circle cx="12.5" cy="8" fill="currentColor" r="1.1" stroke="none" />
  </svg>
);
```

Delete the now-unused `HeaderRowIcon`, `HeaderColIcon`, `CopyMdIcon`, and `CopyHtmlIcon` component definitions and the now-unused `handleCopyAsMarkdown` / `handleCopyAsHTML` callbacks (their logic now lives in `buildTableOverflowItems`). Leave `MergeCellsIcon`, `SplitCellsIcon`, `DeleteRowIcon`, `DeleteColIcon`, `Trash2` (if Trash2 is now unused after Delete-Table removal, drop it from the lucide import too).

- [ ] **Step 9: Verify — typecheck, tests, manual**

Run: `npx tsc --noEmit` → Expected: no errors (watch for unused-import/var errors from Step 8; remove any leftovers).
Run: `npm test` → Expected: full suite green (no regressions; existing toolbar has no render test).
Manual (`npm run tauri dev`): put the cursor in a cell → toolbar shows align · delete row/col · AI · ⋯ (no merge/split). Select multiple cells or click a grip → merge/split appear. Click `⋯` → menu lists Header toggles, Copy as MD/HTML, Delete Table; clicking `⋯` again closes it; clicking an item runs it and closes.

- [ ] **Step 10: Commit**

```bash
git add src/components/toolbar/TableToolbar.tsx
git commit -m "feat(§5.5): context-aware table toolbar with overflow menu"
```

---

### Task 5: `TableSelectionHandles` — grip select-only + col-grip suppression

**Files:**
- Modify: `src/components/toolbar/TableSelectionHandles.tsx`

**Interfaces:**
- Consumes: `getTableToolbarRect` + `isUnderToolbar` (Task 1), existing `selectColumn` / `selectRow` / `axisHasSpan`.
- Produces: no new exports; grip `onClick` now only selects; the grip popup is gone.

- [ ] **Step 1: Remove popup imports, add suppression import**

Remove `import { buildTableMenu } from "./context-menu-table";` and `import { MenuList } from "./MenuList";`. Add:

```ts
import { getTableToolbarRect, isUnderToolbar } from "./table-toolbar-rect";
```

- [ ] **Step 2: Delete the popup state and helpers**

Remove the `menu` state, `menuWasOpenRef`, `menuOwnerRef`, and the entire `openMenu` callback. Remove the `handleKey` calls that only fed `menuOwnerRef` (keep the `handleKey` function only if still referenced; after this change it is unused — delete it too).

- [ ] **Step 3: Suppress the column grip under the toolbar**

In `computeHandle`, inside the `if (inTop && mouse.x >= rect.left)` branch, after locating the column cell rect and BEFORE `setHandle({ axis: "col", ... })`, add the footprint check:

```ts
            // §5.5 — don't place a column grip under the floating toolbar; that
            // real estate belongs to the toolbar (footprint-only suppression).
            const colCenterX = (c.left + c.right) / 2;
            if (isUnderToolbar(colCenterX, rect.top, getTableToolbarRect())) {
              if (!hoveringRef.current) setHandle(null);
              return;
            }
```

(Row grips on the left edge are never suppressed — no edit needed in the `inLeft` branch.)

- [ ] **Step 4: Grip click selects only**

Replace the grip `onClick` handler:

```tsx
          onClick={(e) => {
            if (isDragging) return; // a drag just ended — don't select
            if (menuWasOpenRef.current) return;
            openMenu(handle, e.clientX, e.clientY);
          }}
```

with:

```tsx
          onClick={() => {
            if (isDragging) return; // a drag just ended
            if (handle.axis === "col") selectColumn(editor, handle.cellPos);
            else selectRow(editor, handle.cellPos);
          }}
```

- [ ] **Step 5: Simplify grip `onMouseDown`**

The `onMouseDown` no longer needs to capture popup state. Replace it with the drag-only version:

```tsx
          onMouseDown={(e) => {
            if (axisHasSpan(editor, handle.tablePos, handle.axis)) return; // merged → click-only
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
```

- [ ] **Step 6: Drop the popup from render + scroll cleanup**

In the returned JSX, delete the `{menu && menu.items && (<MenuList .../>)}` block. In the `onScroll` handler and the doc-change `clear` effect, remove the `setMenu(null)` calls (keep `setHandle(null)`).

- [ ] **Step 7: Verify — typecheck, tests, manual**

Run: `npx tsc --noEmit` → Expected: no errors (remove any now-unused imports/vars flagged: `buildTableMenu`, `MenuList`, `menu`, `handleKey`).
Run: `npm test -- table-selection` → Expected: PASS (selection helpers unchanged).
Manual: hover a column near the toolbar → grip does NOT appear directly under the toolbar but DOES appear left/right of it and on the left edge; click a grip → the whole row/column selects and the toolbar switches to the Selection variant (merge/split visible); NO popup opens; drag a grip → row/column still reorders.

- [ ] **Step 8: Commit**

```bash
git add src/components/toolbar/TableSelectionHandles.tsx
git commit -m "refactor(§5.5): grip selects row/col only; drop grip popup, suppress under toolbar"
```

---

### Task 6: `TableInsertButtons` — column ⊕ footprint suppression

**Files:**
- Modify: `src/components/toolbar/TableInsertButtons.tsx`

**Interfaces:**
- Consumes: `getTableToolbarRect` + `isUnderToolbar` (Task 1).
- Produces: no new exports; the top ⊕ is hidden where it would render under the toolbar.

- [ ] **Step 1: Add the suppression import**

At the top of `TableInsertButtons.tsx`, add:

```ts
import { getTableToolbarRect, isUnderToolbar } from "./table-toolbar-rect";
```

- [ ] **Step 2: Suppress the column ⊕ under the toolbar**

In `computeButton`, inside the `if (nearTop) { ... }` branch, after `bestX` is finalized and BEFORE building `colBtn` / `setButton(colBtn)`, add:

```ts
        // §5.5 — the column ⊕ shares the top edge with the floating toolbar;
        // hide it only where it would render under the toolbar (footprint-only).
        if (isUnderToolbar(bestX, tableRect.top, getTableToolbarRect())) {
          setButton(null);
          lockedButtonRef.current = null;
          return;
        }
```

(The row ⊕ in the `else` branch sits on the left edge and is never suppressed.)

- [ ] **Step 3: Verify — typecheck, tests, manual**

Run: `npx tsc --noEmit` → Expected: no errors.
Run: `npm test -- table-insert-buttons` → Expected: PASS (zoom coord math unchanged).
Manual: with the cursor in a cell (toolbar visible), hover the top edge under the toolbar → no ⊕; hover the top edge left/right of the toolbar → ⊕ still appears and inserts a column; hover the left edge → row ⊕ still appears.

- [ ] **Step 4: Commit**

```bash
git add src/components/toolbar/TableInsertButtons.tsx
git commit -m "fix(§5.5): suppress column ⊕ insert button under the table toolbar"
```

---

### Task 7: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full unit suite**

Run: `npm test`
Expected: all pass (baseline was 2739 passed | 6 skipped; three new tests added in Tasks 1 & 3, one updated in Task 2 — count rises accordingly, zero failures).

- [ ] **Step 3: Manual GUI acceptance (WKWebView, `npm run tauri dev`)**

Confirm, at zoom 1 and one zoomed-in level:
- Editing state: toolbar = align · delete row/col · AI · ⋯; no overlap with ⊕/grips.
- Selection state (drag-select AND grip-click): toolbar adds merge/split.
- ⋯ overflow opens above/below the toolbar as a single layer — no competing popup.
- Column ⊕/grip suppressed only directly under the toolbar; left-edge row affordances always work; column insert still reachable left/right of the toolbar and via right-click.
- Right-click menu still lists the full command set (unchanged).
- Grip drag-to-reorder rows/columns still works.

- [ ] **Step 4: Round-trip sanity**

Run: `npm test -- table` (covers `table-colwidth`, `table-advanced`, transformer/roundtrip table tests)
Expected: all pass — no Markdown serialization change.

---

## Self-Review

**Spec coverage:**
- Interaction state machine → Tasks 4 (variant detection) + 5 (grip select raises Selection). ✓
- Compact context-aware toolbar contents → Task 4 (Steps 5–7). ✓
- `⋯` overflow reusing `MenuList` → Tasks 3 + 4. ✓
- Insertion stays with ⊕ / right-click (not in toolbar) → Task 4 removes no insert (none existed); ⊕ retained in Task 6. ✓
- Collision resolution: clearance gap → Task 2; footprint suppression → Tasks 1, 5, 6; layering (popup removed) → Task 5. ✓
- Deletions (grip popup, menu state) → Task 5. ✓
- Keep unchanged (`use-table-drag`, `buildTableMenu` right-click, `MenuList`) → not modified; drag reverified in Tasks 5 & 7. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step carries full code. ✓

**Type consistency:** `setTableToolbarRect`/`getTableToolbarRect`/`isUnderToolbar` (Task 1) used verbatim in Tasks 4–6. `buildTableOverflowItems(editor)` (Task 3) called with one arg in Task 4. `MenuList` props (`items`/`onClose`/`x`/`y`) match its existing signature. `selectColumn`/`selectRow`/`axisHasSpan` signatures match `table-selection.ts`. ✓

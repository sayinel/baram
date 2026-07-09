# Table Floating Menu Clamp + Notion-style Row/Column Selection Handles

**Date:** 2026-07-08
**Branch:** `feature/table-menu-clamp-selection-handles`
**Design refs:** §5.5 (Table), §4.8 (Context Menu / Block Handle), §4.2 (zoom-aware positioning)

## Motivation

Two table-editing pain points:

1. **Floating toolbar sticks to the table top and scrolls out of view.** The
   `TableToolbar` (§5.5) is positioned directly above the table's top edge and its
   position is recomputed only on `selectionUpdate` / `transaction`. When the user
   scrolls a tall table so its top edge leaves the viewport, the toolbar is pushed
   above the visible editor area and clipped away — the user loses access to table
   controls while still editing cells lower in the table.

2. **No way to select a whole row or column.** Users can only place the caret in a
   single cell or drag a rectangular `CellSelection` by hand. Notion offers a grip
   handle on the top edge of each column and the left edge of each row; clicking it
   selects the entire column/row and opens a popup of row/column operations. Baram
   has no equivalent affordance.

## Verified architecture facts

- `.editor-area-scroll` (the scroll container, `overflow-y:auto; zoom:var(--editor-zoom)`)
  is the **first and only** child of `.editor-area` (`position:relative`). Their top
  edges coincide (no header between them). `App.tsx:618-697`.
- `TableToolbar` renders **inside** `.editor-area-scroll` but is `position:absolute`.
  Because `.editor-area-scroll` is `position:static`, the toolbar's containing block
  is `.editor-area`. Consequences: the toolbar does **not** move when the container
  scrolls (it's pinned relative to `.editor-area`), yet it **is** clipped by the
  container's overflow box. `components.css:568`.
- Current toolbar top formula: `top = tableRect.top - scrollRect.top - toolbarHeight - 6`,
  recomputed on `selectionUpdate` + `transaction` only. `TableToolbar.tsx:306-331`.
- New hover overlays in this codebase (`TableInsertButtons`, `BlockHandle`) use
  `position:fixed` and divide visual-viewport coords by `getEditorZoom()` to cancel
  the CSS-zoom render scaling (documented in `table-insert-coords.ts:31-53`).
- `prosemirror-tables` exports `CellSelection.colSelection($anchorCell, $headCell?)`
  and `CellSelection.rowSelection($anchorCell, $headCell?)`. `$anchorCell` is a
  `ResolvedPos` obtained from `doc.resolve(cellBeforePos)`.
- `prosemirror-tables` exports `moveTableColumn({from, to}): Command` and
  `moveTableRow({from, to}): Command` (index-based), so the actual reorder is built in
  — this feature only supplies the drag interaction. `index.d.ts:480-536`.
- An existing pointer-drag pattern lives in `use-block-drag.ts`: `startDrag` on
  `mousedown`, a 5px activation threshold distinguishing click from drag, a shared
  drop-indicator (`showDropIndicator`/`hideDropIndicator`/`resolveInsertTarget` in
  `utils/editor/drop-indicator.ts`), and `setTimeout(()=>setIsDragging(false),0)` so a
  trailing click can read `isDragging` to suppress the menu. WKWebView HTML5 DnD is
  broken, so this is mouse-event-only. `use-block-drag.ts:1-112`.
- The cell "before" position is `tablePos + 1 + rowOffset + 1 + cellOffset`
  (`TableInsertButtons.tsx:29-57`, `findCellPos`).
- The right-click table cell menu is built by `buildTableMenu(editor, resolved, baseItems)`
  (`context-menu-table.ts:11`), producing a flat `MenuItem[]` (`{label, action, separator?}`)
  rendered with `.context-menu` / `.context-menu-item` / `.context-menu-separator`
  classes (`ContextMenu.tsx:260-283`).

## Scope

**In scope (v1):**
- Clamp the floating toolbar to the top of the visible editor area when the table's
  top scrolls above the viewport; hide it only when the table is fully out of view.
- Recompute toolbar position on scroll (not only on transactions).
- A column grip handle on the table top edge and a row grip handle on the left edge,
  shown on hover. **Click** selects the whole column/row and opens a popup menu;
  **drag** reorders the column/row (Notion-style), with a drop indicator.
- The popup reproduces the cell right-click context menu items (per user decision).

**Out of scope (v1):**
- Drag to *select a range* across multiple columns/rows (existing manual cell-drag
  `CellSelection` already covers multi-cell selection; grip-drag is reserved for
  reorder).
- Cell background color / "색" submenu from Notion (not present in Baram's menu).
- Rewriting `TableInsertButtons` or the zoom handling of the existing toolbar.

---

## Part 1 — Floating toolbar viewport clamp

### Behavior

Let `scrollRect = .editor-area-scroll` rect, `tableRect = table DOM` rect. All values
are visual-viewport px (parity with the existing formula; zoom handling is unchanged
from today's code, correct at zoom 1).

- `tableTop = tableRect.top - scrollRect.top` — table top relative to the container's
  visible top (also equals its offset within `.editor-area`, since tops coincide).
- `tableBottom = tableRect.bottom - scrollRect.top`.
- `desiredTop = tableTop - toolbarHeight - GAP` (GAP = 6, current value).
- `MIN_TOP = 4` — sticky inset from the top of the visible editor area.
- **Clamp:** `top = Math.max(desiredTop, MIN_TOP)`.
  - Table top visible → `desiredTop ≥ MIN_TOP` → toolbar sits above the table (today's
    behavior, unchanged).
  - Table top scrolled above the viewport → `desiredTop < MIN_TOP` → toolbar sticks at
    `MIN_TOP`, i.e. pinned to the top of the edit screen (the requested behavior).
- **Hide when the table is effectively gone:** if `tableBottom <= toolbarHeight + MIN_TOP`
  (table bottom has scrolled to/above where the pinned toolbar would sit) → `setVisible(false)`.
  Also hide if `tableTop > scrollRect.height` (table entirely below the viewport — a
  safety guard; shouldn't normally happen while the caret is inside it).

`left` is unchanged (`tableRect.left - scrollRect.left + tableRect.width/2`, with the
existing `translateX(-50%)`).

### Implementation

In `TableToolbar.tsx`:
- Keep `updatePosition` but replace the raw `top` assignment with the clamp + hide
  logic above. Read `scrollRect.height` from the same `.editor-area-scroll` element
  already queried.
- Add a `scroll` listener on the `.editor-area-scroll` container (resolved via
  `editor.view.dom.closest(".editor-area-scroll")`) that calls `updatePosition`,
  `{ passive: true }`. Register/cleanup in the existing `useEffect` alongside the
  `selectionUpdate`/`transaction` handlers.
- No CSS change required.

### Edge cases

- Small tables (no virtual-scroll transactions on scroll): the new scroll listener is
  what makes them track/clamp correctly — previously they only repositioned on caret
  moves.
- Tab switch / doc replace: existing `transaction` handler already re-evaluates; the
  hide guard prevents a stranded toolbar.

---

## Part 2 — Row/Column selection handles

### New files

- `src/components/toolbar/TableSelectionHandles.tsx` — the hover-driven overlay
  (React component, mounted in `App.tsx` next to `TableInsertButtons`).
- `src/components/toolbar/table-selection.ts` — pure helpers (kept separate so the
  `.tsx` only exports a component, matching `table-insert-coords.ts`):
  - `findColumnCellBeforePos(editor, tablePos, colIdx): number | null`
  - `findRowCellBeforePos(editor, tablePos, rowIdx): number | null`
    (both reuse the `findCellPos` offset math; row 0 / col 0 as the anchor row/col).
  - `selectColumn(editor, cellBeforePos)` → dispatch `CellSelection.colSelection(doc.resolve(pos))`.
  - `selectRow(editor, cellBeforePos)` → dispatch `CellSelection.rowSelection(doc.resolve(pos))`.
  - `computeHandleStyle(anchor, zoom)` → zoom-divided `{left, top}` (parity with
    `computeInsertButtonStyle`).
- `src/components/toolbar/use-table-drag.ts` — the drag-to-reorder hook (Part 3),
  modeled on `use-block-drag.ts`.

`findCellPos` currently lives inside `TableInsertButtons.tsx`. To avoid duplication it
will move to `table-selection.ts` (or a shared `table-dom.ts`) and be imported by both
files. This is a targeted refactor in service of the feature, not unrelated cleanup.

### Hover detection

Mount pattern mirrors `TableInsertButtons`: listen on the active `.editor-area-scroll`
for `mousemove` (rAF-debounced), `mouseleave`, `scroll`, and `editor.on("update")` /
`window resize` to clear. Determine the table under/near the cursor with
`findTableNearPoint`.

- **Column handle:** when the cursor is within the top band of the table
  (`tableRect.top - OUTER ≤ y ≤ tableRect.top + INNER`), resolve **which column** the
  cursor's `x` falls into by walking the first row's cells and testing
  `cellRect.left ≤ x ≤ cellRect.right`. Anchor the grip **horizontally centered on that
  column** (`x = (cellRect.left + cellRect.right)/2`), sitting straddling the table top
  border (`y = tableRect.top`, with a CSS translate lifting it ~half its height above).
- **Row handle:** symmetric on the left band; grip centered vertically on the hovered
  row, straddling the left border.

**Coexistence with `TableInsertButtons`:** the insert `⊕` anchors to a column/row
**boundary** (nearest gridline). The select grip anchors to a column/row **center**.
They occupy different pixels for normal column widths. To make the distinction crisp and
avoid a fight at narrow columns, the select grip suppresses itself when the cursor is
within `BOUNDARY_DEADZONE` (≈8px × zoom) of a gridline — there the `⊕` wins; away from
gridlines the grip shows. The two components remain independent (no shared state); this
is a pure geometry gate.

**Collision with the floating toolbar:** the toolbar floats ~`toolbarHeight+6`px above
the table top; the column grip straddles the top border (~8px above at most), so they
do not overlap.

### Grip visual

A small rounded button (~18×14) containing a 6-dot grid glyph (inline SVG, matching the
screenshot's `⠿`), styled via new `.table-select-handle` rules in `toolbar.css`.
`position:fixed`, `z-index` at/above the insert button. Accent color on hover.

### Click vs. drag

The grip's `onMouseDown` starts a potential drag (see Part 3). Using the 5px threshold
from `use-block-drag`: if the pointer moves past the threshold before mouseup it's a
**drag** (Part 3); otherwise it's a **click**, which runs the select+popup flow below.
The popup's open handler checks `isDragging` (cleared on a `setTimeout(…,0)`) so a
just-finished drag never opens the menu.

### Click → select + popup

On grip click:
1. Build the appropriate `CellSelection` (`selectColumn` / `selectRow`) and dispatch it
   so the whole column/row is visibly selected (existing `.selectedCell` styling
   highlights it).
2. Open a popup menu anchored to the grip. The menu items are produced by
   `buildTableMenu(editor, resolvedCellInSelection, baseItems)` — i.e. **the same items
   as the cell right-click menu** (user decision). `baseItems` = Cut/Copy/Paste (as in
   `ContextMenu.tsx`). Because the active selection is now the full column/row, the
   menu's Delete Row / Delete Column / alignment / merge-split actions operate on that
   selection.
3. Render the popup with the existing `.context-menu` classes via a small shared
   presentational component so styling is not duplicated (see below). Include the same
   viewport-clamp logic (`ContextMenu.tsx:238-254`).

### Shared popup rendering

Extract a minimal presentational component
`src/components/toolbar/MenuList.tsx` (`{ items, position, onClose }`) that renders the
`.context-menu` markup and closes on outside-click / Escape / item action. Refactor
`ContextMenu.tsx` to use it, and reuse it for the handle popup. This keeps a single
source of truth for menu look/behavior. (Targeted refactor; if it proves invasive during
implementation, fall back to a local `.context-menu`-classed render inside
`TableSelectionHandles` and leave `ContextMenu` untouched.)

### App wiring

`App.tsx`: add `<TableSelectionHandles editor={activeEditor} />` inside the
`{activeEditor && (<>…</>)}` block, next to `<TableInsertButtons />`.

---

## Part 3 — Drag to reorder rows/columns

### Behavior (Notion-style)

The same grip that selects a column/row is also its drag handle:
- `mousedown` on the grip records the source column/row index and start point.
- Moving past a 5px threshold activates a drag: apply a `body.table-col-dragging` /
  `body.table-row-dragging` class (cursor + disable text selection) and select the
  dragged column/row so the moving band is visible.
- During the drag, compute the **target boundary** nearest the cursor (same
  boundary-walk used by `TableInsertButtons`: for columns, the nearest column gridline
  to `x`; for rows, the nearest row gridline to `y`) and render a **drop indicator** —
  a line at that boundary spanning the table's height (columns) or width (rows).
- `mouseup`: if never activated → treat as a click (select+popup). If activated →
  translate the target boundary into a destination index and dispatch
  `moveTableColumn({from, to})` or `moveTableRow({from, to})`. No-op if `to === from`
  or `to === from + 1` (dropping onto its own edge). Clear indicator + body class, and
  `setTimeout(()=>setIsDragging(false),0)` so the trailing click doesn't open the menu.

### Implementation

- New hook `src/components/toolbar/use-table-drag.ts`, modeled directly on
  `use-block-drag.ts`, exposing `{ isDragging, startDrag(e, {tablePos, axis, index}) }`.
  `axis: "col" | "row"`.
- Boundary math + index resolution reuse the first-row / row-list walks already present
  in `TableInsertButtons.computeButton`; factor the shared cell/row-rect boundary finder
  into `table-selection.ts` so both the insert button and the drag hook use one
  implementation (targeted dedup).
- **Drop indicator:** a lightweight positioned element rendered by
  `TableSelectionHandles` (a `position:fixed` div, zoom-divided like the grip). Vertical
  for column drags (height = table height, x = boundary), horizontal for row drags
  (width = table width, y = boundary). New `.table-drop-indicator` CSS in `toolbar.css`.
  A purpose-built indicator is used rather than the block `drop-indicator` (which draws
  horizontal between-block lines and resolves block positions, not table gridlines).
- **Index mapping:** `moveTableColumn`/`moveTableRow` use logical indices. A boundary to
  the left of column `k` means destination index `k`; the source index is the dragged
  column's index. prosemirror-tables handles the actual cell relocation and colwidth
  carry-over.

### Merged-cell guard

`moveTableColumn`/`moveTableRow` can misbehave when a `colspan`/`rowspan` cell straddles
the moved line. Guard: before starting a drag, scan the table's `TableMap` for any cell
spanning the dragged column/row (span > 1 crossing its boundary); if found, do **not**
activate drag (grip remains click-only for select+popup) and, in dev, `console.debug`
the reason. Verified against real behavior during implementation; if plain moves already
throw/return false for spanned tables we rely on the command's own no-op and simply keep
the guard as a UX affordance.

---

## Testing

Round-trip preservation is unaffected (no schema/serialization change). Tests:

- **Unit (`table-selection.ts`):** `findColumnCellBeforePos` / `findRowCellBeforePos`
  return correct PM positions for a known table doc; `selectColumn`/`selectRow` produce a
  `CellSelection` whose `ranges` cover the expected column/row (assert cell count).
- **Unit (reorder):** given a table doc, dispatching the move for `from→to` yields the
  expected column/row order after round-trip to markdown; boundary→index mapping helper
  returns the right destination index for representative cursor positions; the
  merged-cell guard returns "blocked" for a doc with a spanning cell across the target.
- **Unit (toolbar clamp):** extract the clamp math into a pure helper
  (`computeToolbarTop({tableRect, scrollRect, toolbarHeight})` → `{top, visible}`) and
  test: table fully visible → `top = desiredTop`, `visible`; top scrolled above →
  `top = MIN_TOP`, `visible`; table fully scrolled past → `visible=false`.
- **Existing suites:** `npm test` (vitest) must stay green; `cargo test` unaffected.
- **Manual GUI verification (WKWebView, per project policy):** scroll a tall table and
  confirm the toolbar pins to the top then hides when the table leaves; hover the top/
  left edges and confirm grips appear centered per column/row, click selects the full
  column/row and opens the popup, and popup actions mutate the right cells. Verify at a
  non-1 zoom that grips land correctly (they use the fixed+divide pattern). Drag a grip
  and confirm the drop indicator tracks the nearest boundary and the column/row lands at
  the drop position; confirm a merged-cell table blocks the drag but still allows
  click-select.

## Risks

- **Hover-zone contention** between grips and `⊕` — mitigated by the boundary deadzone;
  verify manually on narrow columns.
- **Click vs. drag ambiguity** on the grip — the 5px threshold + `isDragging` deferral
  (proven in `use-block-drag`) keeps select and reorder distinct; verify a plain click
  never nudges the order.
- **Merged cells + reorder** — `moveTableColumn`/`moveTableRow` may throw or corrupt with
  spanning cells; the `TableMap` guard blocks drag there. Confirm the guard against a
  real spanned table during implementation and adjust if the command is actually safe.
- **`findCellPos` / boundary-finder move** touches `TableInsertButtons` — keep the logic
  identical, only relocate + import, and rely on existing insert-button behavior to
  confirm no regression.
- **`MenuList` extraction** could ripple into `ContextMenu`; the fallback (local render)
  bounds the risk.
- Zoom correctness of the **existing toolbar** is unchanged (pre-existing at zoom≠1);
  not addressed here to keep the change focused.

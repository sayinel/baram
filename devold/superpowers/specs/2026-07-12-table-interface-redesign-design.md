# Table Interface Redesign — Design Spec

**Date:** 2026-07-12
**Design doc reference:** §5.5 (Table Toolbar / Notion-style handles)
**Status:** Approved for planning

## Motivation

The table editing UI is built from three independent React components that all
compete for the **same physical space** (the table's top and left edges) and
offer **largely duplicated commands**:

<!-- colwidths:120,266,261,515 -->

| Component         | File                        | Trigger                                             | Role                                                                                           |
| ----------------- | --------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Floating toolbar  | `TableToolbar.tsx`          | cursor in cell OR cell-selection — **always shown** | 13 buttons: align, header toggles, merge/split, delete row/col, Copy MD/HTML, AI, delete table |
| Insert buttons    | `TableInsertButtons.tsx`    | hover near an edge gridline                         | ⊕ insert row/column                                                                            |
| Selection handles | `TableSelectionHandles.tsx` | hover near an edge cell-center                      | ⣿ grip → selects row/col **+ opens a large dropdown popup**                                    |

Three observed problems (from user screenshots):

1. **Physical collision.** The toolbar is placed only `GAP = 6px` above the
   table top (`table-toolbar-position.ts`). The grips and ⊕ straddle the top
   edge and protrude \~8px upward, so they poke into that 6px gap and overlap the
   toolbar. When the table is scrolled, the toolbar pins to `MIN_TOP = 4` and
   collides with the grip band directly.
2. **Command redundancy.** The grip's dropdown popup (built by
   `buildTableMenu`) and the floating toolbar duplicate nearly every command:
   align, header toggles, merge/split, delete row/col, delete table, Copy
   MD/HTML all appear in **both**. Toolbar-only = AI. Popup-only = Cut/Copy/Paste
   and Add Row/Column.
3. **Layering.** Native button tooltips (`z-index: 9999`) and the grip popup
   (`z-index: 10000`) stack over the toolbar and the table.

**Root cause:** a Notion-style model (grips + ⊕ + drag-reorder) and a
Typora-style always-on floating toolbar were both bolted on, so two design
languages fight for the same edge real estate and expose the same commands twice.

## Chosen Direction

**Typora-style: a single, context-aware smart toolbar is the one command
surface.** The three surfaces are separated by *user intent* so they never
overlap in purpose or (with one suppression rule) in pixels.

### 1. Interaction state machine

<!-- colwidths:98,383,663 -->

| State         | Trigger                                          | Visible affordances                                                                 |
| ------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Hover**     | pointer near an edge, cursor NOT in the table    | ⊕ insert + ⣿ grip (selection only). **No toolbar.**                                 |
| **Editing**   | cursor inside a cell (empty selection)           | Smart toolbar — *Editing* variant. Hover ⊕/grips remain (with suppression rule §3). |
| **Selection** | multi-cell `CellSelection`, incl. **grip click** | Smart toolbar — *Selection* variant.                                                |

**Key consequence — the popup is absorbed, not relocated.** Clicking a grip
already creates a whole-row/column `CellSelection`; that selection now simply
raises the toolbar in its *Selection* variant. The grip's dropdown popup
therefore becomes redundant and is **deleted entirely**. The grip retains two
jobs: select the row/column, and drag-to-reorder (`use-table-drag`, unchanged).

The full command list remains reachable via the **existing right-click context
menu** (`ContextMenu.tsx` → `buildTableMenu`), which already works on tables and
requires no change.

### 2. Toolbar contents — compact, context-aware, with `⋯` overflow

The toolbar is split by state to shrink its width (width is what drives the
collision). Decision: **compact** primary set; everything else in a `⋯` overflow
menu.

**Editing variant (cursor in a single cell) — 6 controls:**

```
┌────────────────────────────┐
│ ◀ ▮ ▶ │ ⌫row ⌫col │ ✦ │ ⋯ │
└────────────────────────────┘
  align     delete r/c   AI  more
```

- Align Left / Center / Right (toggle: clicking the active alignment clears it)
- Delete Row, Delete Column
- AI (`✦`, `showNodeViewAIMenu`)
- `⋯` overflow

**Selection variant (multi-cell / grip) — 8 controls:**

```
┌──────────────────────────────────────────────┐
│ ⧉ merge  ⤨ split │ ◀ ▮ ▶ │ ⌫row ⌫col │ ✦ │ ⋯ │
└──────────────────────────────────────────────┘
  merge/split enabled by editor.can()
```

- Merge Cells, Split Cell (enabled per `editor.can()`, as today)
- Align Left / Center / Right
- Delete Row, Delete Column
- AI
- `⋯` overflow

`⋯`**&#x20;overflow menu (both variants):**
Toggle Header Row · Toggle Header Column · Copy as Markdown · Copy as HTML ·
Delete Table

Notes:

- **Insertion is NOT in the toolbar.** Hover `⊕` (directional, contextual) and
  the right-click menu own insertion. Clean split: *toolbar modifies, ⊕ inserts.*
- The `⋯` menu **reuses the existing&#x20;**`MenuList`**&#x20;component** — moved off the grip
  and onto the toolbar. `buildTableMenu` shrinks to right-click-only usage
  (it may keep its full item list; the toolbar `⋯` uses a small dedicated item
  list, not the full `buildTableMenu` output).
- "No Alignment" is dropped as an explicit item; the align buttons already
  toggle off. It remains in the right-click menu.

### 3. Collision resolution

1. **Clearance.** Raise `GAP` in `computeToolbarTop` so the toolbar bottom sits
   clearly above the grip/⊕ upward-protrusion (\~8px) plus a margin. Exact value
   tuned against the rendered grip/⊕ height during implementation; unit test in
   `table-toolbar-position.test.ts` updated to assert the new gap.
2. **Footprint-only suppression** (chosen over full-top suppression). While the
   toolbar is visible, suppress **only** the top ⊕ and column grips whose x
   falls within the toolbar's horizontal bounding rect. The top edge to the
   left/right of the toolbar, and the entire left edge (row grips + left ⊕),
   stay active — so column insertion via hover is preserved everywhere except
   directly under the toolbar.
   - Mechanism: publish the toolbar's client rect (or `null` when hidden) as a
     lightweight shared signal (module-level ref or small context) that
     `TableInsertButtons` and `TableSelectionHandles` read in their
     compute/hover logic to skip a candidate that intersects the rect.
3. **Layering.** With the grip popup gone, the only floating layer over the
   table is the `⋯` dropdown. It renders as a single `MenuList` above the
   toolbar. No competing `z-index: 10000` popup remains.

### 4. Change map

**Delete:**

- `TableSelectionHandles.tsx`: the `openMenu` path, `menu`/`menuWasOpenRef`/
  `menuOwnerRef` state, and the `<MenuList>` render for the grip popup. The grip
  `onClick` now only selects the row/column (via existing `selectColumn`/
  `selectRow`) — no popup.

**Keep unchanged:**

- `use-table-drag.ts` (drag-to-reorder), `table-selection.ts` selection helpers,
  `ContextMenu.tsx` + `buildTableMenu` right-click path, `MenuList.tsx`
  (now consumed by the toolbar).

**Modify:**

- `TableToolbar.tsx`: split buttons into Editing vs Selection variants; add the
  `⋯` overflow (reusing `MenuList`); move Header toggles / Copy MD / Copy HTML /
  Delete Table into overflow. Detect variant via `selection instanceof
  CellSelection`. Publish the toolbar rect signal.
- `table-toolbar-position.ts`: raise `GAP`; keep clamp behavior.
- `TableInsertButtons.tsx` & `TableSelectionHandles.tsx`: subscribe to the
  toolbar-rect signal; skip candidates intersecting it (footprint suppression).

## Testing

- **Unit:** `table-toolbar-position.test.ts` — new gap value; still hides when
  the table scrolls off. New test for footprint-suppression geometry (a
  candidate x inside vs outside the toolbar rect).
- **Unit:** toolbar variant selection — Editing set vs Selection set given
  `CellSelection` vs empty selection; `⋯` overflow item list.
- **Existing:** `table-selection.test.ts`, `table-insert-buttons-zoom.test.ts`
  must still pass (grip selection + drag + zoom coords unchanged).
- **Manual (WKWebView):** verify no overlap in Editing and Selection states at
  zoom 1 and zoomed; grip click selects and raises the Selection toolbar; ⊕
  still inserts left/right of the toolbar and on the left edge; right-click menu
  still complete; `⋯` overflow opens above the toolbar without collision.

## Out of scope

- Keyboard access to the toolbar (pre-existing gap; table ops still available via
  shortcuts like ⌘M and the right-click menu).
- Replacing native `title` tooltips with custom tooltips (raised clearance gives
  them room; custom tooltips are a separate concern).
- Any change to `use-table-drag` reorder behavior.

## Non-goals / preserved behavior

- Drag-to-reorder rows/columns stays.
- Right-click full command menu stays as the exhaustive fallback.
- Markdown round-trip is unaffected (no schema/transformer changes).

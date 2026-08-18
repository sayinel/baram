# Block Handle Enhancements — Design (2026-06-25)

§4.8 Block Handle. Follow-up to PR-pending `feature/block-handle-improvements`
(alignment / NodeView visibility / grip icon / hover range / zoom & scroll hide).

## Goal

Bring the block handle closer to Notion's affordances by adding **drag-to-reorder**,
a **Turn into** (block-type conversion) submenu, and **Copy link / Add-block-below**
helpers — reusing existing infrastructure and preserving Markdown round-trip.

## Scope

In scope (user-approved):

1. **Drag-to-reorder** — grab the handle and drag a block up/down.
2. **Turn into** — convert the current block's type (paragraph ↔ heading ↔ list ↔ quote ↔ code).
3. **Copy link + small additions** — "Copy link to block" (both wikilink and
   block-reference forms) and a `+` "Add block below" button.

Out of scope (deferred):

- **Block color / background.** Markdown has no color standard, so persistence
  would require HTML (`<span style>` / `<div>`) or a non-standard extension,
  breaking pure `.md` round-trip — which is the project's top quality bar.
  Explicitly excluded this round.
- Drag-to-indent (list nesting), block comments — larger scope.

## Reusable assets (verified)

| Need | Asset | File |
| --- | --- | --- |
| Drop position + indicator | `resolveInsertTarget(y)`, `showDropIndicator`, `hideDropIndicator`, `insertNodeAtPos` (handles list split; **avoids posAtCoords** for WKWebView safety) | `src/utils/editor/drop-indicator.ts` |
| Mouse-event DnD pattern | threshold + drag state | `src/components/sidebar/hooks/use-file-tree-dnd.ts` |
| Node re-placement | Move Up/Down (`deleteRange` + `insertContentAt`) | `src/components/toolbar/BlockHandle.tsx` |
| Block-type commands | `setParagraph`/`toggleHeading`/`toggleBlockquote`/`toggleBulletList`/`toggleOrderedList`/`toggleTaskList`/`setCodeBlock` | Tiptap, used in `SlashMenu` |
| Block id | `addBlockId(view, pos)`, `editBlockId` | `src/extensions/plugins/block-id-decoration.ts` |
| Link forms | wikilink `[[target#^id]]` (`wikilink-transformer.ts`); block ref `((target#^id))` (`block-reference.ts` §30b) | — |
| Active file path | `tab.filePath` → basename | `src/stores/editor/editor.ts` |

WKWebView constraint: HTML5 DnD is broken, so ProseMirror native `draggable`
and `Dropcursor` are **not** used for reordering — custom mouse-event DnD only.

## Detailed design

### A. Drag-to-reorder

- **Trigger**: `mousedown` on the grip button. Track start point; only enter drag
  mode once the pointer moves past a **4px threshold** — below that, `mouseup`
  is a click (opens the menu, current behavior). This disambiguates click vs drag.
- **During drag**: on `mousemove`, call `resolveInsertTarget(e.clientY)` and
  `showDropIndicator(target)`. Suppress hover-hide and the menu while dragging.
- **Drop**: on `mouseup`, move the source node in a single transaction —
  delete the source range and insert the node at the target position. If the
  target lies *after* the source, subtract the source `nodeSize` when mapping
  the insert position. Lists are split by the existing `insertNodeAtPos`.
- **Guards**: ignore drops onto the node itself or its own descendants; clamp
  stale positions; `hideDropIndicator()` on cancel/escape.
- **Zoom**: `e.clientY` and the DOM rects scanned by `resolveInsertTarget` are
  both visual-space, so they stay consistent; no extra ÷zoom needed for the
  indicator. The handle's own position keeps the existing ÷zoom treatment.
- **Extraction**: move drag logic into a new `use-block-drag.ts` hook.
  `BlockHandle.tsx` is already ~430 lines; keep it under the ~300-line guide by
  isolating the drag state machine.

### B. Turn into

- Add a `Turn into ▸` submenu to the handle menu, reusing the existing AI-submenu
  hover pattern (`block-handle-ai-trigger`/`block-handle-ai-submenu`).
- Options: **Text, Heading 1/2/3, Bullet list, Numbered list, To-do list, Quote, Code.**
  Mark the current type (check/disabled).
- Action: select the block at `handle.pos` (NodeSelection or text selection
  inside it), then run the matching chained command
  (`setParagraph` / `toggleHeading({ level })` / `toggleBulletList` / …).
- Hide conversions that don't apply to the current block type.

### C. Copy link + small additions

- **Copy link to block** → two menu items (user chose "both"):
  - `Copy link` → `[[<basename>#^<id>]]`
  - `Copy block ref` → `((<basename>#^<id>))`
  - Both ensure a blockId first (call `addBlockId` if absent), then write to the
    clipboard. `<basename>` derives from the active `tab.filePath` via the shared
    `basename()` util (`src/utils/path-utils.ts`).
- **➕ Add block below**: a small `+` button left of the grip. Inserts an empty
  paragraph after `handle.pos` and moves the cursor into it.

### UI / menu order

`Turn into ▸` → Duplicate / Delete / Move Up / Move Down → Copy link / Copy block ref
→ Add/Edit Block ID → AI ▸. The grip gains a sibling `+` button.

## Round-trip / serialization impact

None. Drag and Turn-into only change document structure (already round-trip-tested
node types). Copy link reuses existing wikilink / block-reference serialization.
No new persisted attributes are introduced.

## Risks / gotchas

- **Click vs drag**: threshold must be reliable so the menu still opens on a plain click.
- **Atom/NodeView blocks** (math/mermaid/code): draggable like any block; verify
  the indicator resolves their boundaries (DOM-rect scan already handles this).
- **List items**: `insertNodeAtPos` splits lists; dragging a list item out should
  behave sensibly (move as its own block vs back into a list — keep current
  Move Up/Down semantics as the baseline).
- **Position mapping** after delete+insert (source-before-target offset).
- **Cursor/selection** preservation through Turn-into conversions.

## Testing

- Unit: node-move helper (source before/after target, list split, top/bottom edges).
- Unit: Turn-into command mapping per source type; Copy-link string builders
  (`[[..]]` and `((..))`) incl. blockId auto-creation.
- Round-trip: converted blocks serialize identically to typed equivalents
  (reuse existing extension round-trip suites).
- Manual (WKWebView): drag across blocks/lists at zoom 1 and ≠1; click still
  opens menu; `+` inserts below; copied links navigate back.

## File touch list (anticipated)

- `src/components/toolbar/BlockHandle.tsx` — menu items, `+` button, wire drag hook
- `src/components/toolbar/use-block-drag.ts` *(new)* — drag state machine
- `src/utils/editor/drop-indicator.ts` — possibly a small move-aware insert helper
- `src/utils/toolbar/block-turn-into.ts` *(new, optional)* — conversion item builder
- `src/styles/toolbar.css` — `+` button, drag-active styles
- Tests under `src/__tests__/` and/or extension round-trip suites

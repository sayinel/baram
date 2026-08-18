# SVG Block Resize — Design (§5.1)

Notion-style edge-drag resize handles for the `svgBlock` (` ```svg ` fenced block).

## Goal

Let users resize a rendered SVG block by dragging left/right edge handles, instead
of it always filling the document width. Resized width persists across save/reload.

## Decisions (from brainstorming)

- **Persistence**: store the width as `width="N%"` on the **root `<svg>`** inside the
  fence `code`. Round-trips naturally through the ` ```svg ` fence; no new node
  attribute and no transformer change.
- **Drag behavior**: free drag with a light snap at 10% increments (10/20/.../100),
  minimum 10%, live `%` label while dragging.
- **Handles / alignment**: handles on both left and right edges; block stays
  centered (consistent with current rendering and the Mermaid block).

## Architecture

### Width helper — `setSvgRootWidth(code, pct)` (svg-utils.ts)
Pure string op on the **root `<svg>` opening tag only**: replace an existing
`width="…"`, or insert `width="N%"` if absent. Children untouched.

### Rendering
Unchanged. `.svg-block-render svg { max-width:100%; height:auto }` + centered, so
the SVG's own `width="N%"` determines display size. No wrapper / node attribute.

### Interaction (svg-block-view.tsx)
WKWebView breaks HTML5 DnD, so use mouse events (see project memory):
- Left/right vertical handles shown on `.svg-block-preview:hover` (CSS).
- Handle `mousedown` → `document` `mousemove`/`mouseup`; `stopPropagation` so the
  block isn't selected / the event doesn't reach ProseMirror.
- Centered ⇒ `width = 2 × |cursorX − blockCenterX| / containerWidth × 100`, the same
  formula for either handle. `clamp(10, 100)`; snap to nearest 10% within ±3%.
- During drag: update the rendered `<svg>`'s `style.width` via a ref (no re-sanitize)
  + show a `%` label overlay.
- Initial width = measured rendered width ÷ container width (handles px / % / none
  uniformly).
- `mouseup`: `setSvgRootWidth(code, pct)` → `updateAttributes({ code })` (persist).

### Export
Unaffected. PNG/SVG raster uses `svgDimensions`, which falls back to the viewBox for
`%` widths, so exports stay at native resolution regardless of display width.

## Testing
- `setSvgRootWidth`: replace existing width, insert when absent, only the root tag,
  handle self-closing / multi-attr roots.
- Round-trip: `<svg width="50%" …>` preserved through md→pm→md.
- Drag interaction itself: jsdom can't lay out, so GUI-verified.

## Files
- `src/utils/markdown/svg-utils.ts` — `setSvgRootWidth`
- `src/extensions/nodes/svg-block-view.tsx` — handles + drag
- `src/styles/editor/svg-block.css` — handle + label styles
- `src/utils/markdown/__tests__/svg-utils.test.ts` — helper tests

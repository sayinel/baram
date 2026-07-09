# Media Block UX Parity — Resize, Captions, Mermaid PNG (§5.1/§5.5)

Bring the SVG block's resize + export UX to the Mermaid block and image, and add
captions to the SVG and Mermaid blocks. Reuse shared infrastructure.

## Decisions (from brainstorming)

- **Persistence**: format-native metadata, round-tripped.
  - Mermaid: a `%% baram-meta: {json}` comment line at the top of the source
    (after any frontmatter). Mermaid ignores `%%`; stripped before `mermaid.render`.
  - SVG: width on root `<svg width="N%">` (done); caption in a root `<title>`.
  - Image: keep existing HTML width + `alt` caption.
- **Image resize UI**: replace 25/50/75/100/Custom presets with SVG-style edge
  drag handles. (10% snap subsumes the presets.)
- **SVG caption** stored in `<title>`; **image caption** unchanged (alt).

## Shared infrastructure (de-dup)

- `views/use-media-resize.ts` — hook owning the edge-drag maths: centered block ⇒
  `width = 2 × |cursorX − centerX| / containerWidth`, free drag, snap to nearest
  10%, min 10%, mouse-event driven (WKWebView DnD is broken), commit on mouseup.
  Returns `{ dragPct, startResize }`; takes a container ref + `onCommit(pct)`.
- `components/.../BlockCaption.tsx` — caption display (below block, centered,
  muted) + click-to-edit inline, mirroring the image caption UX. `value` +
  `onCommit(text)`.
- Shared CSS: generalize `.svg-render-frame` / `.svg-resize-handle` into reusable
  `.media-*` classes used by all three blocks.

## Per item

1. **Mermaid Download PNG** — add to the Mermaid hover toolbar + context menu,
   reusing `downloadSvgAsPng(svgHtml)` (Mermaid already holds the rendered,
   sanitized SVG).
2. **Resize**
   - Image: drop preset toolbar; add edge handles; commit to the existing
     `widthPercent` attr (already serialized to `<img width="X%">`).
   - Mermaid: frame + handles; width persisted in `%% baram-meta` (parse/strip
     on render). Helpers `parseMermaidMeta` / `setMermaidMeta`.
   - SVG: already done.
3. **Captions** (SVG + Mermaid)
   - `<BlockCaption>` below the block; add affordance on hover when empty.
   - SVG: `getSvgCaption` / `setSvgCaption` via root `<title>`.
   - Mermaid: caption field in `%% baram-meta`.

## Metadata format

- Mermaid: single top line `%% baram-meta: {"width":50,"caption":"…"}` (JSON →
  safe escaping). Stripped before render; preserved in the fence (round-trips).
- SVG: `<title>…</title>` as first child of root `<svg>`.

## Testing

- Unit: `parseMermaidMeta`/`setMermaidMeta`/strip; `getSvgCaption`/`setSvgCaption`;
  `use-media-resize` snap/clamp maths (pure parts).
- Round-trip: mermaid width+caption, svg caption, preserved through md→pm→md.
- Drag/render: GUI-verified (jsdom can't lay out).

## Files

- New: `views/use-media-resize.ts`, `BlockCaption.tsx`, `utils/markdown/mermaid-meta.ts`.
- Edit: `svg-block-view.tsx` (use shared hook/component), `mermaid-block-view.tsx`,
  `image-view.tsx`, `mermaid-block.ts` (render strip), `svg-utils.ts` (caption
  helpers), CSS, `registry.json`.

---

## Follow-up: menu unification + caption-as-toolbar-button (2026-06-30)

The three media blocks had divergent hover menus: SVG/Mermaid shared an identical
light top-right icon pill under two separate class names (`svg-hover-toolbar`,
`mermaid-hover-toolbar`); the image used a dark top-center pill (`image-toolbar`)
with a text "Caption" button. Captions on SVG/Mermaid were add-able only by
clicking a hover placeholder below the block.

**Decision** (user-approved): standardize all three on the light top-right icon
pill, and surface caption editing as a toolbar **icon button** (`Captions`) on
every block.

- **Shared component**: `views/MediaToolbar.tsx` (`MediaToolbar` container +
  `MediaToolbarButton`). The container stops native `mousedown` so button clicks
  never select/edit the block. Styles live in `media-block.css` as
  `.media-toolbar` / `.media-toolbar-btn`; reveal via
  `.{svg,mermaid}-block-preview:hover`, `.image-node-view:hover`, and
  `.image-figure.image-selected`.
- **Caption editing is parent-controlled**: `BlockCaption` takes `editing` +
  `onEditingChange`; the toolbar Caption button flips it. When empty and not
  editing it renders nothing — the toolbar button is the add affordance (the
  hover placeholder below is gone). Caption display below stays for set values.
- **Per-capability buttons**: SVG/Mermaid keep Caption · AI · Copy · PNG ·
  Fullscreen; image keeps Caption · AI (no source/PNG/fullscreen concept).
- **Export**: stripping consolidated to the shared `.media-toolbar` /
  `.media-resize-handle` / `.media-resize-label` (previously the SVG toolbar and
  the new resize handles were not stripped from exported HTML — fixed here).

Removed: `.svg-hover-toolbar*`, `.mermaid-hover-toolbar*`, `.image-toolbar*`, the
dead `.image-size-*` preset inputs, and the unused `.block-caption-placeholder`.

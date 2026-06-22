# Large-File Windowing Engine — Design Spec (2026-06-20)

> Branch: `feature/large-file-windowing`. §perf-large-file C4 (true windowing).
> Supersedes the content-visibility virtualization approach (removed in `0d3d4a2`, proven a dead end).
> Prior context: [`large-file-perf-c4-handoff.md`](../impl-notes/large-file-perf-c4-handoff.md), [`large-file-perf-c3-handoff.md`](../impl-notes/large-file-perf-c3-handoff.md).

## 1. Goal & Success Criteria

Make editing a ~3,264-top-level-block document (CONTEXT.md, ~21k lines) feel real-time ("Obsidian-level"):

| Metric | Current (flag-OFF, CONTEXT.md) | Target |
|---|---|---|
| `view.dispatch` median (synthetic bench) | 53 ms | single digits (≈4–10 ms) |
| `inputLatency` p50 (keydown→paint) | 152 ms | dramatic drop; aim < 16 ms |
| scroll / click-to-cursor / nav / math-edit | sluggish | smooth |

**Hard requirements (non-negotiable):** roundtrip (MD→PM→MD) preserved, export/print unchanged, full-text search/find unaffected, no content loss, no blank gaps on scroll, scrollbar/document height correct.

## 2. Settled Principles (bench-proven, do NOT re-litigate)

These were established by a controlled `view.dispatch` benchmark on the real fixture (handoff "UPDATE 2026-06-19b"):

| Primitive | median `view.dispatch` (≈3,110 off-screen hidden) | Verdict |
|---|---|---|
| baseline (none hidden) | 170 ms | — |
| `content-visibility:hidden` + `contain-intrinsic-size` | 178 ms | **DEAD END — no improvement** |
| `display:none` | 6 ms | **28× — the only thing that works** |

- **`display:none` removes the box from layout flow.** PM's `updateState`/selection-sync forces a synchronous flow layout of every top-level box every transaction; `content-visibility:hidden` keeps the box in flow (only skips paint/descendant layout) so it cannot help. Only box removal does.
- **Scroll height is preserved with pseudo-element spacers**: `.tiptap::before { height: var(--vtop) }` and `.tiptap::after { height: var(--vbot) }`. Pseudo-elements are not DOM nodes, so ProseMirror's child reconciliation cannot strip them (real spacer `<div>`s get removed because "PM owns the children").
- **Hiding is applied through NodeViews, never imperative style on default-rendered DOM.** PM re-renders a default-rendered block when other plugins' decorations shift around the caret, clobbering an inline `display:none`. PM does **not** re-render an off-screen NodeView, so styling a NodeView's `dom` is safe. (Dead-ends v1–v6 from the handoff confirm this — do not retry imperative-on-default or `Decoration.node`.)

## 3. Architecture

Three cooperating parts, all living in a rebuilt `src/extensions/plugins/viewport-virtualize.ts` (+ a small CSS rule and a settings flag).

### 3.1 Generic block NodeView (light types)

Wraps each light top-level block so the controller can toggle its visibility safely.

- **Covered types:** `paragraph`, `heading`, `bulletList`, `orderedList`, `taskList`, `blockquote`, `horizontalRule`, `definitionList`, `callout` (and any other light top-level container). Final container list is locked by the container-safety spike (§7.2).
- **Rendering:** render via the node's own `toDOM` (`DOMSerializer.renderSpec(document, toDOM(node))`) so `tag`/`attrs`/`contentDOM` exactly match the default — a faithful passthrough when virtualization is inactive.
- **`setHidden(hidden, reservePx)`:** `hidden ? dom.style.display = 'none' : dom.style.display = ''`. (Reserve height is tracked by the controller's height map for the spacers, not via `contain-intrinsic-size` here.)
- **`ignoreMutation(m)`:** return `true` only for `m.type === 'attributes' && m.target === dom` (our own style write on the wrapper). Never ignore mutations targeting `contentDOM` children — those are real content edits PM needs.
- **`update(newNode)`:** return `false` when `newNode.type !== current.type || !newNode.sameMarkup(current)` (force re-create); otherwise accept and keep.

### 3.2 Heavy block hiding (own React NodeViews)

`codeBlock`, `mathBlock`, `mermaidBlock`, `queryBlock`, `table` already own React NodeViews and cannot be wrapped again. The controller toggles `display:none` directly on their existing NodeView `dom` (safe: PM doesn't re-render off-screen NodeViews). Coexists with the existing `lazy-visible.ts` lazy-mount (orthogonal: lazy-mount = first render; windowing = hide/show of an already-mounted block).

### 3.3 VirtualizeController (per editor)

Owns the height map, computes the visible band on scroll, toggles the delta, and writes the spacers.

- **Height map:** ordered array of per-top-level-block heights (measured while visible, estimated otherwise) + cumulative offsets. Node-keyed so structural edits remap rather than corrupt.
- **Band computation:** on scroll (rAF-throttled) and resize, read `scrollTop` + viewport height, binary-search the cumulative offsets to find `[first, last]` blocks intersecting `[scrollTop − BUFFER, scrollTop + viewportH + BUFFER]`. Toggle only blocks that crossed the previous band boundary (the delta).
- **Spacers:** `--vtop` = Σ heights of hidden blocks above `first`; `--vbot` = Σ heights of hidden blocks below `last`. Written as CSS custom properties on `.tiptap`.
- **Typing does ZERO windowing work.** A docChanged tx only marks positions dirty + schedules a debounced remeasure; it never evaluates the band (typing in place doesn't move the window). This is the fix for the freeze that killed every prior controller (they ran `evaluateAll()` over all blocks every tx).
- **Registration:** light NodeViews register themselves on create / unregister on destroy. Heavy blocks are discovered as the ordered direct children of `.tiptap`.

## 4. Visible-Window Detection: scroll-driven band + height map (NOT IntersectionObserver)

**Why not IntersectionObserver:** a `display:none` element has no box, so IO never fires for it — we could hide a block but never learn when to reveal it. IO is fundamentally incompatible with the `display:none` primitive. (IO was viable only while paired with content-visibility, which keeps the box observable — but content-visibility is the dead end.) IO stays in use *only* for heavy-block lazy-mount (`lazy-visible.ts`), which is a separate concern.

**Why band computation is robust:** it computes an absolute block range from `scrollTop`, so a fast scroll / fling lands on the correct window directly — no relative-delta drift, no blank gaps. The earlier band-math failures were a **coordinate-space bug under CSS `zoom`**, not a flaw in the approach; we fix that head-on (§5).

## 5. CSS `zoom` coordinate handling (the historical landmine)

`.editor-area-scroll` has `zoom: var(--editor-zoom, 1)` (`layout.css:124`). `offsetTop`/`offsetHeight` report **layout** (pre-zoom) coordinates while `getBoundingClientRect()` reports **visual** (post-zoom) coordinates; `scrollTop`'s space is the unknown that broke prior attempts. 

**Resolution — Step-0 coordinate spike (§7.1):** empirically determine which space `scrollTop` lives in, then measure block heights with the matching API (`offsetHeight` if layout-space, `getBoundingClientRect().height` if visual-space) so the band math is internally consistent. This is a ~5-line console probe run once in the GUI; it gates all geometry code.

## 6. Edge Cases

- **Selection/cursor in a hidden block:** programmatic navigation (global search, backlinks, outline click, find-in-doc match) must call `revealBlock(pos)` to expand the window around the target *before* `setSelection`/`scrollIntoView` (a `display:none` element has no geometry to scroll to). Normal typing is unaffected — the caret is always inside the visible band.
- **Height-cache invalidation:** on edit, mark the edited block dirty and re-measure while it's visible (debounced). Structural edits (block insert/delete) remap the node-keyed cache. Off-screen blocks are never edited, so their cached heights stay valid; stale heights cause only minor scroll drift, corrected on scroll-to.
- **Export/print:** `src/utils/export/export-html.ts` clones `editor.view.dom`. Wrap export/print paths in `withVirtualizationSuspended(fn)` — reveal all blocks, run `fn`, restore. (`display:none` content is still present in the DOM, so export likely works regardless, but explicit suspension guarantees it.)
- **Find-in-document:** find-replace builds decorations across the whole doc; matches inside hidden blocks won't paint until revealed. Match navigation reuses `revealBlock`.

## 7. Verification Strategy (jsdom cannot exercise this → GUI-centric)

### 7.1 Step-0 coordinate spike (highest priority, gates everything)
Console probe in the GUI: compare `scroller.scrollTop` against a known block's `offsetTop` and `getBoundingClientRect().top` at a scrolled position to determine `scrollTop`'s coordinate space under the active `--editor-zoom`. Lock the height-measurement API to match.

### 7.2 Container-safety spike
Wrap one container type (e.g. `blockquote`) in the generic NodeView, put a math/mermaid block inside it, and confirm in the GUI that edit-entry into the nested block still works. Derive the safe NodeView config (likely: correct `contentDOM`, `ignoreMutation` scoped to the wrapper's own `style` attribute only, no `stopEvent` interception). If a type proves intractable, fall back to leaving that single type in flow (correct but slightly slower) rather than blocking the whole engine.

### 7.3 Synthetic dispatch bench
`view.dispatch` median (50 single-char inserts, warmup discarded) FULL DOM vs windowed, plus `hidden` count. Target: windowed median single digits, a few thousand blocks hidden.

### 7.4 GUI checklist (all required before declaring done)
1. Scroll top-to-bottom: all content appears, no permanent blank gaps.
2. Typing stays smooth (burst → scroll → type again, no freeze).
3. Click / outline-nav / backlink / find-in-doc to an off-screen target reveals it.
4. Scrollbar position and document height stay correct (no jump).
5. Export/print output is complete; roundtrip (MD→PM→MD) unchanged.
6. math/mermaid/code/table edit-entry works (incl. nested in a container).

### 7.5 Automated (vitest)
Unit-test the pure logic: height-map cumulative offsets, band `[first,last]` computation from a scrollTop + heights fixture, spacer `--vtop`/`--vbot` summation, delta-toggle (only boundary-crossing blocks flip). DOM/zoom/IO behavior is GUI-only.

## 8. Activation & Kill-Switch

- **Auto-ON for large docs:** engaged on the large keep-alive editor (`LARGE_DOC_BLOCK_THRESHOLD = 500`).
- **Kill-switch:** a real settings flag `virtualizeLargeDocs` (default **ON**) so a regression can be disabled without a rebuild. Replaces the DEV-only `window.__baramFlags.virtualize` gate.
- **Registration:** the `ViewportVirtualize` extension is added in `createBaramExtensions()` (both editors receive it). When inactive (small doc / flag off), the generic NodeView is a faithful `toDOM` passthrough and the controller does nothing.

## 9. Explicitly Out of Scope (separate follow-up plans)

- Plugin `DecorationSet` long-tail: `fold` / `listAtomFix` / `block-id` each map a whole-doc-sized decoration set every keystroke. Windowing fixes the *layout* floor; these are separate and measured afterward.
- Open time (~2s): all mermaid/katex/table render at load — a separate lever.
- Folding cost on a huge doc (folding ~1,391 headings builds a large folded DecorationSet).

## 10. Key Risks

| Risk | Mitigation |
|---|---|
| `scrollTop` coordinate space wrong under zoom → blank screen (prior failure) | Step-0 spike locks the measurement API before any geometry code |
| Container NodeView breaks nested math/mermaid edit-entry (prior failure) | Container-safety spike; per-type fallback to flow |
| Fast scroll → blank gaps | Absolute band from scrollTop (not relative deltas) + BUFFER margin |
| Spacer height drift from stale off-screen heights | Node-keyed cache, re-measure on scroll-to; minor drift acceptable |
| Per-keystroke regression (the freeze that killed prior controllers) | Typing marks dirty + debounced remeasure only; band evaluated on scroll/resize only |
| Export incomplete under `display:none` | `withVirtualizationSuspended` + DOM content is present anyway |

## 11. Conventions

Commit msgs English, `§perf-large-file` tag + C4, lowercase subject (commitlint). Conversational replies Korean. pre-commit: prettier + eslint `--max-warnings=0` (perfectionist sorting) — run `--fix`/`--write` and retry. Vitest only (`npx vitest run`), never jest. `CONTEXT.md` (repo root, untracked) is the perf fixture — never commit it.

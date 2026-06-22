# Large-Doc Edit-Latency — Fix Plan (2026-06-22)

> Follow-up to `docs/impl-notes/large-doc-edit-latency-scoping.md`.
> Branch: `feature/large-doc-edit-latency`. Diagnosis complete; this records the confirmed
> root cause and the incremental, measurement-gated fix plan.

## Confirmed root cause (evidence-based, not guessed)

Measured on CONTEXT.md (~3,003 top-level nodes) via `__baramPerf.txBreakdown()` + a per-dispatch
provenance probe (GUI-run):

> **Every non-trivial transaction reconciles a number of React NodeViews proportional to the
> total mounted count — NOT to the change size.** Only incremental text typing is cheap (~5ms);
> selection changes, entry doc-changes, and progressive-load chunk inserts all pay the full cost.

Measurement (math/inline-math edit-entry, click → edit):
- `selectClickedLeaf` (NodeSelection on click): **398ms** (selection-only tx)
- `mathInlineEdit$` (atom → `$formula$` text, `math-inline-edit.ts` handleClick): **405ms**
- → felt "~1s edit-entry" = these two ≈ **803ms**
- **Surprise**: clicking while the doc was STILL progressively loading — **23 `baramProgressiveLoad`
  chunk inserts = 18.3s (91% of measured cost)**, worst single chunk 983ms. Same root cause.

Mechanism (confirmed in `node_modules/@tiptap/react@3.26.0/dist/index.js`):
- All React NodeViews render into ONE shared `Portals` container; `setRenderer`/`removeRenderer`
  rebuild the whole `renderers` map (`{...renderers}`, O(n)) and notify subscribers → Portals
  re-renders n children.
- `ReactRenderer` constructor calls `flushSync(() => this.render())` **per NodeView creation** once
  `isEditorContentInitialized` → a chunk mounting K nodeviews forces K synchronous full-Portals
  re-renders over the growing set.

Why windowing ON/OFF both reproduce: the C4 windowing engine (`viewport-virtualize.ts`) only
`display:none`s off-screen LIGHT blocks and never hides heavy/inline React NodeViews
(`windowable:false`). `display:none` keeps them MOUNTED → the reconcile set is identical either way.
The windowing controller does NOT dispatch PM transactions (it is not the cascade source).

Ruled out by measurement: decoration plugins fold/listAtomFix/blockId (selection-only fast paths,
<12ms), selectionUpdate/transaction listeners (<5ms), syntax-reveal/writing-flow appendTransaction.

## NodeView composition (decides the approach)

819 doc nodes of React-candidate types: `table 342`, `mathInline 317`, `mermaidBlock 94`, `codeBlock 66`.
But **table and codeBlock are VANILLA NodeViews** (prosemirror-tables `TableView`;
`views/code-block-node-view.ts` custom CodeMirror NodeView), NOT React portals.

→ **Actual React portals ≈ mathInline 317 + mermaidBlock 94 = 411.** `mathInline` alone is 77%.

## Approach (decision: attack the shared root cause directly)

No single vanilla-izable type solves it on its own, so the strategy is to break the O(n) React-portal
coupling — starting with the largest, safest contributor and gating each next step on measurement.

### Increment 1 — vanilla-ize the MathInline NodeView — ❌ REFUTED & REVERTED (2026-06-22)

Implemented (vanilla `MathInlineNodeView`), code-verified (typecheck + 2487 tests + lint all green),
then GUI-measured. **Result refuted the hypothesis:** React portals dropped 850→97 (`.react-renderer`)
but `TX.maxMs` was unchanged (~1100ms vs ~1179ms) and progressive load got WORSE (chunk inserts
slower → adaptive sizing shrank chunks → ~2× chunk count, count 50→108). Reverted to baseline.

**Conclusion: per-transaction cost does NOT scale with React-NodeView count.** The ~1100ms (chunk
insert) and ~400ms (selection/edit-entry) are inside PM `view.updateState` itself — not plugins
(<12ms), events (<5ms), or React portals. This rules out the entire "reduce React NodeViews"
direction (the original Approaches B & C below are dead).

### Localized: forced reflow, dominated by @tiptap Placeholder (CONFIRMED)

A JS+Layout profile showed **Layout & Rendering dominates** (forced reflow), and a layout-read
probe (one edit-entry click) pinned it:
- `getClientRects` **271,906×** ← `posAtCoords` ← `getViewportBoundaryPositions` ← `computeAndDispatch`
  in **@tiptap Placeholder** (the `tiptap__placeholder$` plugin). Its viewport-boundary tracking
  calls `posAtCoords` a catastrophic number of times → full-DOM reflow on every transaction.
  **20× the next contributor.** No PlaceholderOptions flag disables the scan (`PLUGIN_KEY:
  PluginKey<ViewportState>`, unconditional).
- 2nd: `offsetHeight` **13,943×** ← windowing `reconcile`/`measureBand` — but only during progressive
  LOAD (firstPass measures all blocks); ~65 when settled. Separate load-time concern.
- Reproduces windowing ON/OFF because Placeholder was registered unconditionally.

### Increment 2 — gate Placeholder off on the large keep-alive editor ✅ DONE (2026-06-22)

`src/extensions/index.ts`: wrapped `Placeholder.configure(...)` in the `options.isLargeKeepaliveEditor`
gate (same gate as ViewportVirtualize). Large docs are never empty → zero UX cost. Only CSS dep is
`.tiptap p.is-editor-empty:first-child::before` (empty-editor only, N/A for large docs). Test-setup's
`elementFromPoint` polyfill stays (small-doc test editors still register Placeholder).

Verified — typecheck + 2487 tests + lint green; GUI re-measure (CONTEXT.md edit-entry):

| metric | before | after |
| --- | --- | --- |
| `getClientRects` (placeholder) | 271,906 | 4 |
| tx worst (`maxMs`) | 1,099ms | 408ms |
| tx total | 17,482ms | 813ms |
| stall total | 46,008ms | 1,571ms |

### Residuals (smaller, separate — decide whether to pursue)

1. **edit-entry ~408ms** — the `mathInlineEdit` overlay's `coordsAtPos` (`math-inline-edit.ts`
   `updateOverlay`) reads layout right after the atom→text doc change → ~1 forced reflow on the
   3,000-block DOM. Fix: defer/rAF the overlay positioning, or skip on large docs.
2. **mouse-over-table jank** — `TableInsertButtons.tsx` rAF mousemove handler reads
   `getBoundingClientRect` per row/cell of the near table (43,795 in the probe window, mousemove-
   driven, NOT edit-entry). Fix: cache rects / coarse-grained boundary search.
3. **load-time** — windowing `measureBand` reads `offsetHeight` over all blocks during progressive
   load (13,943). Fix: measure only the band, or throttle firstPass full measures.

---

### (dead — kept for history) Increment 1 — vanilla-ize the MathInline NodeView

- `math-inline.ts`: replace `ReactNodeViewRenderer(MathInlineView)` with a vanilla PM NodeView
  factory. `MathInlineView` is render-only (atom; editing handled by the MathInlineEdit plugin via
  decorations) — inputs are `formula`/`mathSize`/`selected` only; no React state/store/context.
- Vanilla NodeView: render KaTeX into an inner `<span>` (1:1 with current code), keep classes
  `math-inline` / `math-inline-rendered`, `data-math-size` attr; toggle `math-inline-selected` via
  `selectNode()`/`deselectNode()`.
- Removes 317 of 411 React portals (77%).
- **Doubles as the decisive experiment**: big improvement → React-portal O(n) is the bottleneck →
  do mermaid next. Little improvement → bottleneck is PM reconcile over the vanilla table/code
  NodeViews → pivot to a PM-level approach.

Verification: `npx vitest run` (no test imports MathInlineView; serialization is transformer-based,
unaffected) + typecheck + GUI re-measure (same probe: edit-entry ms + progressive-load chunk ms,
before/after) + visual check (render, click-to-edit, selection highlight).

Rollback: single commit; revert the one `addNodeView` line.

### Later (measurement-gated)
- Increment 1 effective → **Increment 2: mermaid (94)** vanilla-ize / lighten (more careful — it has
  interactive UI: templates, fullscreen, context menu, lazy-visible IO).
- Increment 1 limited → pivot: reduce PM reconcile cost over the 408 vanilla table/code NodeViews.

## Conventions
Commit msgs English, lowercase subject (commitlint), tag the relevant section. Vitest only
(`npx vitest run`). `CONTEXT.md` is the untracked perf fixture — never commit it. GUI verification
is human-run (jsdom can't exercise layout).

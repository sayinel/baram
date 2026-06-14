# §perf-large-file C4 — Block-Level Virtualization Implementation Plan

> Date: 2026-06-13
> Mode: RALPLAN-DR **DELIBERATE** (high cross-cutting regression risk)
> Predecessors: `docs/plans/2026-06-09-large-file-perf-plan.md`, `2026-06-10-large-file-perf-c2-plan.md`, `2026-06-11-large-file-perf-c3-plan.md`
> Status: **Phase 0 spike DONE → C4 PAUSED (2026-06-14).** Mechanism validated, but no cheap implementation works; the robust path is A1 (NodeView) — a substantial effort deferred until there is appetite. The truncation bug (the real user-facing issue) is fixed and shipped separately (commit `d0d655b`). Spike plugin removed; this plan + the perf instrumentation fixes are kept.

## Phase 0 RESULT — mechanism GO, but PAUSED (no cheap impl) (2026-06-14)

Measured on the `CONTEXT.md` fixture (WKWebView/Tauri dev) via `window.__baramPerf` typing avg (`transactions.totalMs / count`), after the §9 active-editor instrumentation fix landed:

| | typing avg / tx |
|---|---|
| flag OFF (current C3) | **467 ms** (consistent across runs: 519 / 530 / 467) |
| flag ON (off-screen blocks `content-visibility:hidden`) | **28 ms** (~16× faster, **under the 33 ms target**) |

**Resolved unknowns:**
- §2.5 — YES: on WKWebView, `content-visibility:hidden` + `contain-intrinsic-size` on off-screen top-level blocks DOES remove them from the synchronous forced layout the typing path triggers. The dominant per-keystroke cost was WebKit laying out all ~3,500 blocks (~97% of tx time; plugins ~3%, confirmed via the C4 per-plugin instrumentation fix).
- Pre-mortem #1 fear (content-visibility ineffective / repeats the `auto` failure) — DISPROVED for the `hidden` (script-gated) variant.
- The v1/v2 spike froze due to **Decoration.node churn** (~3,400 decorations remapped + re-applied per keystroke — the C3.1d identity-churn class), NOT content-visibility.

**But the cheap approaches do NOT survive integration (why C4 is paused):** the spike iterated v1→v5 and hit a hard wall — there is no quick, robust way to keep off-screen blocks hidden under ProseMirror:
- **Decoration.node (v1/v2):** survives PM re-renders but remaps ~3,400 node decorations per keystroke → froze typing.
- **Imperative `el.style.contentVisibility` (v3/v4/v5):** no churn, and gave the 28ms number — BUT only in a *fixed-position, short* measurement. In sustained typing, OTHER plugins' decorations (fold, block-id, …) shift position below the caret and make PM **re-render those blocks, clobbering the imperative inline style** → blocks get laid out again → typing fell back to ~800–1260ms (SLOW TX logs, `plugins≈none`), i.e. *worse* than OFF (467ms) due to content-visibility toggle thrash.
- **Typing-only hybrid (v5):** hide on keydown / reveal on idle. Same clobbering → still slow; also trades nothing because always-on virtualization trades typing speed for scroll speed (laid-out blocks scroll free on the compositor; hidden blocks must be laid out as they enter → slow scroll).

**Conclusion:** the §2.5 mechanism is real (content-visibility:hidden DOES exclude off-screen blocks from WKWebView's forced layout), but a production solution must let PM own the off-screen rendering decision so it is not clobbered — i.e. **Option A1 (a per-top-level-block NodeView that renders a sized placeholder when off-screen)**. That is the substantial, multi-phase effort the plan scoped (with the selection/DOMObserver risks in §5/§7). No cheaper path survived. **C4 is paused here**; resume with A1 + the AM-1..AM-7 amendments when there is appetite.

> Status: PAUSED — Phase 0 gate ran; mechanism validated but the cheap implementations failed integration. A1 (NodeView) is the only robust path and is deferred. Spike plugin (`viewport-virtualize.ts`) removed; perf instrumentation fixes (active-editor + config-survival) and this plan are kept.

---

## 0. Problem Statement (evidence-backed; not re-litigated here)

Typing in a ~3,500 top-level-block (~21k-line) document — the `CONTEXT.md` fixture (`wc -l CONTEXT.md` = 21,308 lines) — has:

- input latency p50 = 170 ms, p99/max ~1,272 ms
- open ~2 s, click-to-cursor ~0.5 s

Diagnosis via `window.__baramPerf` (`src/utils/editor/perf-trace.ts`): `longTasks count=0` (no JS task > 50 ms), `inputLatency p50=170ms`, rAF stalls ~10 s total. **The bottleneck is WebKit (WKWebView) layout/paint over the full ~3,500-element DOM tree per keystroke, NOT JavaScript.** ProseMirror renders all top-level blocks to the DOM.

`contain: layout paint` (C3.1c, `src/styles/editor.css:1337-1339`) isolates each block but does **not skip** off-screen layout. A prior `content-visibility: auto` attempt (`909fa2d` C1) was reverted twice — once for line-disappearance on Enter (`5c82ab6`) and finally replaced by layout containment (`be1be5f` C3.1c) because it forced whole-document re-layout on every caret/coordinate query (~300 ms/keystroke, ~5 s/click). The CSS comment at `src/styles/editor.css:1329-1336` records this verbatim.

**Goal:** render only viewport(+buffer) top-level blocks in the DOM (block-level virtualization) so off-screen blocks leave the layout tree, without regressing the subsystems listed in §7.

**Perf targets (CLAUDE.md §8.4):** typing < 16 ms ideal / < 33 ms acceptable; 10k-line open < 1 s; click-to-cursor must NOT regress beyond current ~0.5 s.

---

## 1. Requirements Summary + Acceptance Criteria

### 1.1 Functional requirements

| # | Requirement |
|---|---|
| FR-1 | Off-screen top-level blocks are removed from (or collapsed in) the rendered DOM so WebKit does not lay them out per keystroke. |
| FR-2 | Document height (and therefore scrollbar geometry and scroll offset) is preserved when blocks are virtualized in/out. No scroll "jump." |
| FR-3 | All navigation that targets a position (backlink block-id, search line, heading) scrolls correctly even when the target block is currently off-screen / unrendered. |
| FR-4 | Click-to-cursor (`posAtCoords`) lands on the correct position; typing, selection, IME/composition, undo/redo work across virtualized boundaries. |
| FR-5 | Folding, find-in-document, decoration plugins continue to function correctly across the unrendered range. |
| FR-6 | Expensive NodeViews (CodeMirror code blocks, Mermaid, KaTeX, tables) mount/unmount without losing user state or thrashing on scroll. |
| FR-7 | Composes with the existing keep-alive dual-editor model, per-editor Schema, source-mode toggle, and progressive loader. |
| FR-8 | A kill switch disables virtualization entirely and falls back to current (C3) behavior at runtime. |

### 1.2 Acceptance Criteria (concrete, testable metrics)

> AMENDED by consensus review — see §12: AC-6 (now forced-reflow time, not DOM count), AC-7 (anchor-block index, not raw px), AC-9 (+ AC-9b/AC-11 export byte-identity). §12 wins on conflict.

Measured on the `CONTEXT.md` fixture, DEV build, WKWebView (Tauri), via `window.__baramPerf` after the §9 measurement prerequisite fix lands.

| # | Criterion | Target | How verified |
|---|-----------|--------|--------------|
| AC-1 | Typing input latency p50 | ≤ 33 ms (stretch ≤ 16 ms) | `__baramPerf.inputLatency().p50` after 200 keystrokes mid-document |
| AC-2 | Typing input latency p99 | ≤ 80 ms (from 1,272 ms) | `__baramPerf.inputLatency().p99` |
| AC-3 | rAF stall total during 30 s typing | ≤ 1 s (from ~10 s) | `__baramPerf.stalls().totalMs` |
| AC-4 | Click-to-cursor (off-screen target) | ≤ 500 ms (no regression) | manual timed click + e2e timing assertion |
| AC-5 | 10k-line open → editable | < 1 s warm | `timePhase` open trace |
| AC-6 | Rendered DOM top-level element count mid-scroll | ≤ ~80 (viewport + 2× buffer) instead of ~3,500 | `document.querySelectorAll('.tiptap > *').length` |
| AC-7 | Scroll offset drift after fast scroll up+down to same anchor | ≤ 4 px | e2e scroll-stability test |
| AC-8 | Roundtrip MD→PM→MD on fixture | byte-identical (no regression) | `npm test` roundtrip suite |
| AC-9 | Kill switch OFF → behavior byte-identical to C3 | all existing tests green | feature-flag toggle test |
| AC-10 | Existing test suite | 2356 passed / 5 skipped maintained or improved; `cargo test` 163/163 | `npm test`, `cargo test` |

A **measurement honesty clause:** AC-1..AC-4 are meaningless until §9 lands, because `instrumentEditor` currently hooks only the shared `editor`, not the keep-alive editor that is active for large docs. The keep-alive editor's `txBreakdown` reads 0. §9 is a hard prerequisite, sequenced into Phase 0.

---

## 2. RALPLAN-DR

### 2.1 Principles

1. **Measure the active editor or you are flying blind.** The keep-alive editor is the one rendering the large doc; the shared editor instrumentation is a measurement artifact. No perf claim is valid until the active editor is instrumented (§9).
2. **Preserve ProseMirror as the source of truth for the document.** The doc model must stay complete; only the *rendered DOM* is windowed. We never mutate the doc to virtualize. (This is what makes posAtCoords/selection/undo even tractable.)
3. **Reversible and gated.** Every phase sits behind a runtime feature flag with a verified fallback to C3 behavior. A spike gates the architecture choice before we sink cost into it.
4. **Don't regress the click.** The single most important non-typing metric is click-to-cursor; the prior `content-visibility` attempt died on exactly this (~5 s). Any option that cannot demonstrate ≤ 500 ms click on the fixture is invalidated.
5. **Reuse the incremental machinery already built.** C3.1 already converted several plugins to `changedRanges` (`changed-ranges.ts`; used by `fold.ts:488`, `block-id-decoration.ts:319`, `prompt-highlight.ts:172`). Virtualization must extend, not fight, this.

### 2.2 Decision Drivers (top 3)

1. **WebKit layout cost is proportional to rendered DOM node count, and `posAtCoords`/`domAtPos`/click force synchronous full layout.** Any approach that leaves all blocks layable-out (even via `content-visibility`) loses, because the click path re-lays everything. The winning approach must physically reduce the DOM/layout tree for off-screen content.
2. **ProseMirror's `EditorView` expects its managed DOM to mirror the document.** It owns `nodeDOM`, `domAtPos`, `posAtCoords`, the DOMObserver, and selection sync. Fighting this directly (deleting DOM under it) corrupts selection mapping and triggers re-render. This is the biggest architectural constraint and the source of the **single biggest unknown** (§2.5).
3. **The subsystem blast radius is large** (§7: 8 subsystems, keep-alive dual editor, per-editor Schema, source mode, progressive loader). Decision must favor an approach whose failure modes are *localized and observable*, not silently corrupting.

### 2.3 Viable Options

#### Option A — ProseMirror-native viewport window (Decoration/NodeView that suppresses off-screen rendering)

Two sub-variants, both keeping the doc complete:

- **A1 — `nodeViews` placeholder swap.** A plugin tracks the visible top-level block range (from scroll position + estimated heights). For top-level blocks outside the window, register a cheap NodeView that renders a single sized `<div>` placeholder (height = estimated/measured block height, set via inline `height` or `contain-intrinsic-size`) and renders `node` content only when in-window. ProseMirror still "renders" every block, but off-screen blocks become one empty fixed-height box → near-zero layout/paint cost. The doc, positions, selection mapping stay intact because PM still owns a DOM node per block.
- **A2 — Decoration-driven hiding + sized placeholder widgets.** Use `Decoration.node({ style: 'content-visibility:hidden; contain-intrinsic-size: <h>px' })` on off-screen top-level blocks, recomputed on scroll (debounced/rAF). `content-visibility: hidden` (NOT `auto`) skips rendering its contents entirely but is script-controlled, so we choose *when* to reveal — avoiding the `auto` click-relayout trap because the click handler can pre-reveal the target block's neighborhood before `posAtCoords`.

Pros:
- Doc stays complete → `posAtCoords`, `domAtPos`, selection, undo/redo, IME all keep working through PM's own machinery (no parallel coordinate system).
- Reuses PM's `nodeViews`/decoration lifecycle; integrates with `changedRanges` incremental plugins already built.
- Kill switch is trivial: disable the plugin → PM renders everything (current C3).

Cons (bounded):
- A1: writing a robust per-top-level-block NodeView that swaps placeholder↔real on scroll without breaking `defining`/`atom` semantics is fiddly; must handle blocks whose height changes when edited.
- A2: `content-visibility: hidden` still creates a layout box per block (cheaper than full layout but not free); WKWebView support/behavior must be spike-verified — this is essentially "the `content-visibility` family that already burned us, used in `hidden` + script-gated form." Risk it shares the click-relayout failure.
- Both: height estimation errors cause scroll drift (§7 risk 8); off-screen lazy NodeViews (`onFirstVisible`, `lazy-visible.ts`) never fire if their wrapper is not in a layable subtree (FR-6).

#### Option B — External windowing/virtual-scroll layer above ProseMirror

A React virtual-scroll container (e.g. hand-rolled or a windowing lib) sits above the editor; only viewport blocks are handed to a (possibly per-segment) ProseMirror view. Essentially: split the doc into windowed segments and mount PM only for the visible segment(s).

Pros:
- Maximal layout reduction — off-screen content is genuinely not in any PM DOM.
- Conceptually simple windowing math.

Cons (bounded — and severe):
- Breaks the single-document model: selection spanning a virtualized boundary, find-across-doc, undo/redo across segments, and folding ranges that cross segments become multi-view coordination problems. Each of §7's 8 subsystems would need a parallel cross-segment implementation.
- `posAtCoords` and a single contiguous selection no longer have one authoritative `EditorView`. This is exactly what the keep-alive dual-editor model already shows is expensive to keep correct (the cross-schema bug fixed in `use-tab-switching.ts:482-493`).
- Highest blast radius against §7; lowest reversibility.

#### Option C — Revisit `content-visibility: auto` + `contain-intrinsic-size` + viewport-distance gating (cheaper interim)

Re-introduce `content-visibility: auto` on `.tiptap > *` WITH a measured/estimated `contain-intrinsic-size` per block, plus a script gate that, on click/`posAtCoords`/navigation, temporarily forces nearby blocks `content-visibility: visible` (or removes the rule within a viewport-distance band) BEFORE the coordinate query, so the click does not force-lay-out all 3,500 blocks.

Pros:
- Smallest diff; mostly CSS + a focused scroll/click pre-reveal shim. Fast to prototype.
- Doc stays complete; PM untouched.

Cons (bounded):
- This is the approach that already failed twice (`5c82ab6`, `be1be5f`). The reason it failed — `content-visibility: auto` forces synchronous full-document relayout on any coordinate query — is intrinsic to `auto`; the gating shim must perfectly bracket *every* coordinate query (PM does many internally: DOMObserver, `scrollIntoView`, `coordsAtPos`, selection sync). Missing one re-triggers the ~5 s stall.
- `contain-intrinsic-size` correctness on WKWebView for variable-height blocks (code, tables, math) is unproven and drives scroll stability.

### 2.4 Recommendation + invalidation rationale

**Recommend Option A (lead with A2 placeholder-decoration, fall back to A1 NodeView) — but ONLY after the Phase 0 spike proves the click path.**

Rationale:
- Option A keeps ProseMirror authoritative (Principle 2), giving us posAtCoords/selection/undo "for free" and a trivial kill switch (Principle 3), while still physically shrinking what WebKit lays out (Driver 1).
- **Invalidate B:** the cross-view coordination cost against all 8 subsystems (Driver 3) plus the loss of a single authoritative `EditorView` for `posAtCoords`/selection makes it the highest-risk, lowest-reversibility option. The existing dual-editor keep-alive code already demonstrates how expensive even *two* editors are to keep coherent (cross-schema truncation bug, `use-tab-switching.ts:482-493`); N segment-views multiply that.
- **Invalidate C as the primary approach (keep as interim/fallback):** it is the twice-reverted approach; its failure mode (`auto` forces full relayout on coordinate queries) is structural, and PM issues many internal coordinate queries we cannot easily bracket. We keep C as a *time-boxed fallback* only if the Phase 0 spike shows A cannot hit AC-4 (click) on WKWebView.
- A2 vs A1: A2 (decoration + `content-visibility: hidden` + `contain-intrinsic-size`) is the smaller diff and the spike's first probe; if WKWebView still force-lays-out hidden blocks on click (sharing C's failure), fall to A1 (true placeholder NodeView swap), where off-screen blocks are genuinely a single empty box.

**Honest feasibility note (the biggest technical unknown — §2.5).**

### 2.5 Is ProseMirror-native virtualization even feasible? (single biggest unknown)

ProseMirror's `EditorView` is designed so its DOM mirrors the document; it uses `viewDesc` trees, `domAtPos`/`posAtCoords` walk that DOM, and the DOMObserver reconciles native selection back to doc positions. There is no first-class "render only a window" API. Known precedents:
- The community has repeatedly asked for viewport/virtual rendering; the canonical answer from PM's author is that NodeViews can render lightweight stand-ins, and `content-visibility`/`contain` are the sanctioned CSS levers, but **PM still constructs a viewDesc per node** — so the win must come from making each off-screen viewDesc's DOM cheap to lay out, not from removing it.
- Large-doc editors (e.g. some CodeMirror-6-based and bespoke PM forks) achieve windowing by either (a) decorations that hide content while keeping a sized box, or (b) splitting into documents — i.e. our A and B.

**THE unknown the spike MUST resolve:** *On WKWebView specifically, does a script-controlled `content-visibility: hidden` + `contain-intrinsic-size` (A2) — or a placeholder NodeView (A1) — actually remove off-screen blocks from the synchronous layout that `posAtCoords`/click triggers, OR does WebKit still force-lay-out the hidden/placeholder subtrees on a coordinate query (reproducing the ~5 s click stall)?* Everything else (height estimation, scroll math, plugin compat) is engineering; this is physics-of-the-engine and cannot be assumed. Phase 0 exists to answer exactly this with a number, behind a flag, before any commitment.

---

## 3. Pre-mortem — 3 concrete failure scenarios

1. **"The click still takes 5 seconds."** We ship A2; WKWebView ignores `content-visibility: hidden` for purposes of `posAtCoords` and force-lays-out all blocks on click (same root cause as the reverted C1). Symptom: AC-1 (typing) passes but AC-4 (click) fails catastrophically. **Mitigation:** Phase 0 measures the click path *first*, on the fixture, before anything else. If A2 fails the click, the gate routes to A1 (placeholder NodeView, genuinely empty off-screen box) or kills the effort and keeps C3. Pre-reveal-on-click shim (force visible a band around `event.clientY`→`posAtCoords` target before querying) is built into the spike.

2. **"Scroll jitters and the cursor jumps half a page."** Height estimation for variable-height blocks (code blocks with N lines, tables with 441 rows in the fixture, Mermaid [103 in fixture], KaTeX) is wrong, so `contain-intrinsic-size`/placeholder heights don't match real heights. When a block scrolls into view and lays out at its true height, total document height changes and the scroll offset drifts (AC-7 fails); restoring a backlink/search target lands on the wrong block (FR-3). **Mitigation:** measure-and-cache real heights as blocks are revealed (a `Map<blockKey, px>`), seed estimates from node type + content length, and on reveal adjust scrollTop by the delta between estimate and measured height (the standard virtual-scroll "scroll anchoring" correction). Spike validates AC-7 on the fixture which contains the worst cases.

3. **"Expensive NodeViews lose state or never render."** CodeMirror code blocks (`code-block-node-view.ts:143` uses `onFirstVisible`), Mermaid (`mermaid-block-view.tsx:54`), and KaTeX (`math-block-view.tsx:105`) rely on `IntersectionObserver` (`lazy-visible.ts`) firing when their wrapper enters the viewport. If virtualization keeps the wrapper out of a layable subtree, the observer never fires (FR-6) → blank code/math. Conversely, mount/unmount churn on fast scroll re-runs `mermaid.render` (`mermaid-block-view.tsx:660`) and rebuilds CodeMirror state, dropping cursor/scroll inside the code block. **Mitigation:** the virtualization window must keep a buffer large enough (≥ viewport) so NodeViews mount slightly before visible and the existing `onFirstVisible` keeps working; never unmount a NodeView that currently holds focus/selection; preserve CodeMirror `EditorState` across reveal/hide (cache by block key). Spike includes a fixture region with code+mermaid+math+table to validate.

---

## 4. Phased Plan

> Every phase is behind the runtime feature flag (§8). Flag OFF must equal C3 behavior exactly (AC-9).

### Phase 0 — SPIKE / de-risk (gate before commitment)

**Goal:** answer §2.5's unknown with numbers; de-risk posAtCoords, scroll stability, height estimation, on the `CONTEXT.md` fixture, behind a flag. **No production wiring beyond the flag.**

Files touched:
- `src/utils/editor/perf-trace.ts` — **§9 prerequisite first**: make `instrumentEditor` instrument the *active* (keep-alive) editor, not only the shared one (currently `App.tsx:303` calls it once on `editor`). Allow re-instrumenting / instrumenting a passed editor; expose per-editor `txBreakdown`.
- `src/App.tsx:303` — call `instrumentEditor(activeEditor)` (re-bind when `activeKeepaliveEditor` changes), so `__baramPerf` covers the editor that actually renders the large doc.
- NEW `src/extensions/plugins/viewport-virtualize.ts` (spike, flag-gated) — minimal A2: a plugin that, on scroll (rAF-debounced), computes a visible top-level block index range from scrollTop + a height map, and emits `Decoration.node` with `content-visibility:hidden; contain-intrinsic-size:<estH>px` for out-of-window top-level blocks. Plus a click pre-reveal shim in `handleDOMEvents.mousedown`/`mousewheel` that force-reveals a band around the target before PM's `posAtCoords` runs.
- NEW `src/utils/editor/block-heights.ts` (spike) — estimate + measure-and-cache per-block heights; scroll-anchor correction helper.
- Probe-only fallback branch for A1 (placeholder NodeView) reusing the same height map, to A/B against A2 if A2 fails the click.

Approach: instrument first, then prototype A2, measure typing AND click on the fixture, then (if needed) A1.

**Exit / go-no-go gate (must record numbers in the impl note):**
- GO if A2 (or A1) achieves AC-1 (typing p50 ≤ 33 ms) AND AC-4 (click ≤ 500 ms) AND AC-6 (DOM count ≤ ~80) on the fixture, with AC-7 scroll drift ≤ 4 px achievable.
- PIVOT to A1 if A2 passes typing but fails click; re-run gate.
- NO-GO (fall back to Option C interim, or abandon to keep C3) if neither A1 nor A2 can pass AC-4 on WKWebView. Document the measured failure.

### Phase 1 — Core virtualization (chosen variant), flag-gated, prose-only

Files touched: `viewport-virtualize.ts`, `block-heights.ts`, `src/extensions/index.ts` (register plugin behind flag), `src/styles/editor.css` (any `contain-intrinsic-size` rules), `src/App.tsx` (wire flag + pass active editor).

Approach: harden the spike winner for plain paragraph/heading/list/blockquote docs. Real-height measurement on reveal + scroll-anchor correction. Window = viewport + 1× buffer above/below. Compose with progressive loader: virtualization activates only after `finishLoad` (`use-tab-switching.ts:516`) and only for keep-alive (large) docs (`childCount ≥ LARGE_DOC_BLOCK_THRESHOLD`, `use-large-doc-keepalive.ts:19`).

Exit: AC-1, AC-2, AC-3, AC-6 pass on a prose-only large fixture; AC-8 roundtrip green; AC-9 flag-off identical; existing tests green.

### Phase 2 — Navigation, scroll-restore, click correctness

Files touched: `src/hooks/use-tab-switching.ts` (scroll-restore for virtualized docs at lines 248-258, 375-396, 277-307), `src/utils/editor/block-nav.ts`, `src/utils/editor/cursor-mapper.ts` (these already work on the doc model, not DOM — verify they still return correct positions; the scroll *to* those positions must force-reveal the target band first), `viewport-virtualize.ts` (expose `revealRange(from,to)`).

Approach: backlink (`findBlockPosById`), search line (`mdLineToPmBlockStart`), heading (`findHeadingPosByText`) all compute doc positions independent of rendering — keep that — but the subsequent `scrollIntoView`/`domAtPos` (`use-tab-switching.ts:386-391`) must first `revealRange` so the target block is laid out before scrolling. Restore per-tab `scrollTopCache` (`use-tab-switching.ts:100,153,249`) using the height map so the offset is meaningful under virtualization.

Exit: AC-3, AC-4, AC-7 pass; backlink/search/heading navigation to an off-screen block lands correctly (e2e).

### Phase 3 — Expensive NodeViews + folding + decoration plugins

Files touched: `lazy-visible.ts`, `code-block-node-view.ts`, `mermaid-block-view.tsx`, `math-block-view.tsx`, `fold.ts`, `find-replace.ts`, `block-id-decoration.ts`, `prompt-highlight.ts`, `ghost-text.ts`, `ai-diff.ts`, `authorship.ts`, `prompt-lint.ts`.

Approach:
- Ensure NodeView lazy-mount (`onFirstVisible`) still fires (buffer ≥ viewport; observer root margin already 200px, `lazy-visible.ts:41`). Preserve CodeMirror `EditorState` across hide/reveal; never unmount the focused NodeView.
- Folding (`fold.ts`) composes with virtualization: folded ranges hide content via `Decoration.node({class:'fold-hidden'})` (`fold.ts:345-349`); virtualization hides via a different mechanism. Ensure a block can't be both fold-hidden and a virtualization placeholder in a conflicting way; fold anchors (`anchorsToPositions`, `fold.ts:55`) resolve against the doc (fine). Verify `foldAll`/`unfoldAll` height recompute.
- Whole-doc decoration walkers: `find-replace.findMatches` (`find-replace.ts:188` `doc.descendants`) and `buildDecorations` (`find-replace.ts:134`) create inline decorations at *all* match positions — correct against the doc, but matches in virtualized-out blocks have no DOM; ensure find-next `scrollIntoView` reveals first (reuse Phase 2 `revealRange`). Confirm `block-id-decoration.ts` / `prompt-highlight.ts` incremental `changedRanges` paths (`block-id-decoration.ts:319`, `prompt-highlight.ts:172`) don't assume DOM presence.

Exit: FR-5, FR-6 pass; find-in-doc highlight scroll works; code/mermaid/math render correctly after scroll; folding correct; AC-8 roundtrip green.

### Phase 4 — Hardening: keep-alive compose, source-mode, IME, undo/redo, selection across boundary

Files touched: `use-tab-switching.ts`, `use-large-doc-keepalive.ts`, source-mode hook, `viewport-virtualize.ts`.

Approach: confirm virtualization plugin lives on the keep-alive editor instance (separate Schema, `use-large-doc-keepalive.ts:1-7`) and is torn down on eviction (`use-large-doc-keepalive.ts:113,128`); source-mode toggle disables virtualization (source view is a textarea, not PM); IME/composition never hides the composing block; undo/redo and selection spanning a virtualized boundary force-reveal endpoints. Final perf re-measure on fixture (§9).

Exit: all ACs pass; FR-7 verified; full test suite + cargo green.

---

## 5. Risk Register (per-subsystem, §7 mapped, with mitigation)

| # | Subsystem / risk | Likelihood | Impact | Mitigation |
|---|------------------|-----------|--------|------------|
| R1 | `posAtCoords`/`domAtPos` & click when target block unrendered | High | Critical | Keep doc complete (Option A); click pre-reveal shim reveals band before coordinate query; Phase 0 gate measures this first. |
| R2 | Scroll: per-tab `scrollTopCache` + backlink/search/heading nav to unrendered target (`use-tab-switching.ts:248-258,375-396`) | High | High | Doc-position computations (`block-nav.ts`, `cursor-mapper.ts`) are render-independent — keep; add `revealRange` before `scrollIntoView`; height-map-aware scroll restore. Phase 2. |
| R3 | Folding composition: fold-hidden vs virtualized-out, anchor remap (`fold.ts:55,345`) | Medium | High | Distinct mechanisms; ensure a placeholder block isn't double-hidden; recompute heights on fold/unfold; anchors resolve against doc (safe). Phase 3. |
| R4 | Decoration plugins relying on positions across unrendered ranges (`find-replace.ts:134`, `block-id-decoration.ts`, `prompt-highlight.ts`) | Medium | Medium | Decorations are positional (doc-based) and survive; only their DOM materialization is windowed. find-next/highlight reuse `revealRange`. Verify incremental `changedRanges` paths don't read DOM. Phase 3. |
| R5 | Expensive NodeViews mount/unmount on scroll (CodeMirror state, Mermaid `mermaid.render` cost `mermaid-block-view.tsx:660`, KaTeX) + `onFirstVisible` never firing (`lazy-visible.ts`) | High | High | Buffer ≥ viewport; preserve CodeMirror `EditorState` by block key; never unmount focused NodeView; keep wrappers in a layable subtree so IntersectionObserver fires. Phase 3. |
| R6 | Compose with keep-alive dual-editor + per-editor Schema + source-mode + progressive loader | Medium | High | Plugin on keep-alive instance; activate only after `finishLoad` and only for large docs; torn down on eviction; disabled in source mode. Phase 1+4. |
| R7 | find-in-doc highlight scroll, undo/redo, selection across boundary, IME/composition | Medium | High | `revealRange` for find-next; force-reveal selection/undo endpoints; never hide composing block. Phase 4. |
| R8 | Stable scroll: virtualizing changes doc height → must preserve offset (estimated/measured heights, `contain-intrinsic-size`) | High | High | Estimate from node type+content; measure-and-cache on reveal; scroll-anchor delta correction; AC-7 e2e. Phase 0 + 1. |
| R9 | Measurement blindness: `instrumentEditor` hooks only shared editor (`App.tsx:303`), keep-alive `txBreakdown`=0 | Certain (current) | Critical (invalidates metrics) | §9 prerequisite in Phase 0 — instrument active editor. |
| R10 | Re-introducing a `content-visibility` family that already burned us twice (`5c82ab6`, `be1be5f`) | Medium | Critical | Use `hidden` (script-gated), not `auto`; Phase 0 gate kills it if click regresses; Option A1 placeholder NodeView as escape hatch. |

---

## 6. Kill-Switch / Feature-Flag Strategy

- Add a runtime flag `virtualizeLargeDocs` (default **OFF** until Phase 4 sign-off) in settings store (`src/stores/settings/store.ts`) plus an env/DEV override (`import.meta.env` or `window.__baramFlags`) so QA can toggle without rebuild.
- The `viewport-virtualize` plugin is only added to the extension set when the flag is ON; with it OFF, ProseMirror renders all blocks exactly as in C3 — `contain: layout paint` (`editor.css:1337`) remains the steady state. This makes AC-9 (flag-off = byte-identical) the literal behavior of not registering the plugin.
- The click pre-reveal shim and height map are no-ops when the plugin is absent.
- Settings UI toggle under the existing performance/advanced section; document that disabling restores C3 behavior. Telemetry/log line on activation (mirrors `[Baram Perf]` keep-alive logs, `use-large-doc-keepalive.ts:109`).

---

## 7. Hard Constraints / Regression Risks (the 8) — coverage map

1. posAtCoords/domAtPos & click when target unrendered → R1, Phase 0 gate + Phase 2.
2. Scroll: scrollTopCache + backlink/search/heading nav → R2, Phase 2.
3. Folding composition / anchor remap → R3, Phase 3.
4. Decorations across unrendered ranges → R4, Phase 3.
5. Expensive NodeViews mount/unmount → R5, Phase 3.
6. Keep-alive dual editor + Schema + source mode + progressive loader → R6, Phase 1+4.
7. find highlight scroll, undo/redo, selection across boundary, IME → R7, Phase 4.
8. Stable scroll / doc height → R8, Phase 0+1.

---

## 8. Measurement Strategy

### 8.1 Prerequisite fix (blocks all metrics) — §9 / Phase 0 step 1

`instrumentEditor` (`perf-trace.ts:305`) currently guards with a module-level `editorInstrumented` boolean (`perf-trace.ts:297,308`) and is called once on the **shared** `editor` (`App.tsx:303`). For large docs the active editor is the **keep-alive** editor (`App.tsx:256` `activeEditor = activeKeepaliveEditor ?? editor`), which is never instrumented → its `txBreakdown` reads 0. Fix:
- Make `instrumentEditor` idempotent *per editor instance* (track instrumented instances in a `WeakSet`, drop the single global boolean) so it can patch each editor's `view.dispatch`/`emit`/`config.fields` once.
- In `App.tsx`, re-call `instrumentEditor(activeEditor)` whenever `activeKeepaliveEditor` changes (effect dep on `activeEditor`).
- Keep `inputLatency`/`stalls`/`longTasks` window-global (they already are, `perf-trace.ts:212-239`) — they measure the main thread regardless of editor instance, so they were always valid; only `txBreakdown` was blind.

### 8.2 Before/after protocol (on `CONTEXT.md` fixture, WKWebView DEV)

1. Open fixture; wait for `finishLoad`.
2. `window.__baramPerf.reset()`.
3. Type 200 chars mid-document (scripted), then `inputLatency()` → record p50/p99/max, `stalls()`, `longTasks()`, `txBreakdown()`.
4. Timed click into an off-screen region (scroll to ~70%, click a paragraph) → record click-to-cursor ms.
5. `document.querySelectorAll('.tiptap > *').length` → DOM count (AC-6).
6. Record both flag-OFF (baseline = C3) and flag-ON (virtualized) into the impl note table.

Targets: AC-1..AC-6 in §1.2.

---

## 9. Expanded Test Plan

### 9.1 Unit (Vitest — `npm test`, never `npx jest`)
- `block-heights.ts`: estimate-by-type, measure-cache update, scroll-anchor delta correction (pure functions).
- `viewport-virtualize.ts`: visible-range computation from scrollTop + height map; window+buffer math; `revealRange` expands the decoration set; flag-off produces empty decoration set (AC-9 unit-level).
- `perf-trace.ts`: `instrumentEditor` idempotent per-instance via WeakSet; two editors both get non-zero `txBreakdown` (regression test for R9).
- Folding compose: a placeholder block + fold range don't produce conflicting decorations (`fold.ts` interaction).

### 9.2 Integration (Vitest + jsdom, pipeline)
- Roundtrip on fixture: MD→PM→MD byte-identical with flag ON and OFF (AC-8).
- `block-nav`/`cursor-mapper` return identical positions with virtualization plugin present vs absent (render-independence proof for R2/R4).
- find-replace `findMatches` returns identical matches regardless of virtualization (R4).
- NOTE: jsdom lacks real layout/IntersectionObserver — these test position/model correctness, NOT layout perf. Layout perf is e2e/manual only (see MEMORY.md jsdom polyfill gotcha for `elementFromPoint`).

### 9.3 E2E (Playwright — `tests/e2e/`)
- `large-doc-virtualization.spec.ts`: open fixture; assert DOM top-level count ≤ ~80 after scroll (AC-6); type and assert no content loss / roundtrip; scroll up+down to anchor and assert offset drift ≤ 4 px (AC-7).
- Navigation: backlink/search/heading jump to an off-screen block lands with correct cursor + visible target (FR-3, AC-4).
- Click-to-cursor on off-screen-then-revealed block ≤ 500 ms timing assertion (AC-4).
- NodeView: scroll to a region with code+mermaid+math+table (fixture has 441-row table, 103 mermaid); assert they render after scroll and CodeMirror cursor/scroll preserved across hide/reveal (FR-6, R5).
- IME/composition smoke (composing block never hidden).
- Kill-switch: flag OFF → existing large-doc e2e behavior unchanged (AC-9).

### 9.4 Observability
- `[Baram Perf] virtualize` log on activation/window-resize (mirrors keep-alive logging `use-large-doc-keepalive.ts:109`).
- `window.__baramPerf` extended with `virtualize()` → `{ rendered, total, windowFrom, windowTo, heightCacheSize }` for live inspection.
- Dev-only `SLOW TX` warning already exists (`perf-trace.ts:407`); ensure it fires on the active editor post-§9.
- Impl note records before/after metrics table per §8.2 as the completion evidence (verifier gate).

---

## 10. ADR

**Decision:** Implement block-level virtualization as a ProseMirror-native, flag-gated viewport-window plugin (Option A: A2 decoration `content-visibility:hidden`+`contain-intrinsic-size` primary, A1 placeholder NodeView fallback) that keeps the document model complete and windows only the rendered DOM. Commit only after a Phase 0 spike proves the click path (`posAtCoords` ≤ 500 ms) on WKWebView with the `CONTEXT.md` fixture. Fix `instrumentEditor` to cover the active keep-alive editor as a hard prerequisite.

**Drivers:** (1) WebKit layout cost ∝ rendered DOM node count and coordinate queries force synchronous layout; (2) ProseMirror expects its DOM to mirror the doc — keeping the doc authoritative preserves posAtCoords/selection/undo; (3) large §7 blast radius demands localized, observable failure modes and a trivial kill switch.

**Alternatives considered:** Option B (external windowing / segment views) — rejected: loses a single authoritative `EditorView`, multiplies the dual-editor coherence cost (cf. cross-schema bug `use-tab-switching.ts:482-493`) across all 8 subsystems, lowest reversibility. Option C (`content-visibility:auto` + `contain-intrinsic-size` + gating) — demoted to time-boxed fallback: it is the twice-reverted approach (`5c82ab6`, `be1be5f`) whose `auto` relayout-on-coordinate-query failure is structural; kept only if the spike shows A cannot pass AC-4.

**Why chosen:** Option A is the only approach that simultaneously reduces WebKit layout cost AND preserves ProseMirror's authoritative coordinate/selection machinery AND offers a byte-identical kill switch — maximizing perf upside while bounding regression risk and remaining reversible.

**Consequences:** (+) typing/scroll cost drops toward viewport-bounded; posAtCoords/selection/undo keep working via PM; kill switch = don't register plugin. (−) height estimation must be maintained for scroll stability; NodeView lazy-mount and CodeMirror state preservation need care; the `content-visibility` family risk re-enters and must be gated by the Phase 0 click measurement. New maintenance surface: `viewport-virtualize.ts`, `block-heights.ts`, per-editor instrumentation.

**Follow-ups / open questions:** (1) Resolve §2.5 unknown in Phase 0 — does WKWebView skip off-screen `content-visibility:hidden`/placeholder subtrees during `posAtCoords`? (2) Should virtualization extend to the shared editor for mid-size docs (< 500 blocks) or stay keep-alive-only? (3) Interaction of virtualization window with the M10 table virtual-scroll (`editor.css:1323`, nested `content-visibility:auto` on table rows) — nested virtualization needs a Phase 3 check. (4) Whether `contain-intrinsic-size` should be measured-once-cached vs continuously updated for blocks edited while off-screen.

---

## 11. Open Questions (persist to `.omc/plans/open-questions.md`)

- [ ] Phase 0 spike result: does A2 (`content-visibility:hidden`) pass AC-4 click on WKWebView, or must we use A1 placeholder NodeView? — gates the entire architecture.
- [ ] Should mid-size docs (< `LARGE_DOC_BLOCK_THRESHOLD` = 500) also virtualize, or remain non-virtualized to avoid overhead? — affects flag scope.
- [ ] Nested virtualization with M10 table row virtual-scroll (`editor.css:1323-1327`) — conflict or compose?
- [ ] Default flag state at GA (OFF until proven, but when do we flip ON by default for large docs?).
- [ ] **Accessibility:** removing ~3,400 blocks from the DOM breaks VoiceOver/rotor "read whole document." Decision needed: reveal-all when an AT is detected, `aria` scaffolding, or document-and-accept with a kill-switch note. (Critic finding 3.)
- [ ] **Native Cmd+F (WKWebView find-in-page)** searches only rendered DOM → silently misses off-screen text. Decision: supersede with in-app Cmd+F, or reveal-all on native-find trigger. (Critic finding 2.)
- [ ] **Cmd+A select-all / copy-of-large-selection** spanning virtualized-out blocks — reveal-all (suspend) before any DOM-reading copy/export-selection path. (Critic finding 2.)

---

## 12. Consensus Review (RALPLAN-DR) — Verdicts & Authoritative Amendments

> These amendments are AUTHORITATIVE: where they conflict with the body above, the amendment wins. Applied 2026-06-13 from the Architect + Critic consensus pass.

**Architect verdict: SOUND-WITH-CHANGES.** Spine correct and code-grounded; B/C invalidations verified (confirmed C1 `909fa2d` used `content-visibility:auto`+`contain-intrinsic-size`, so "failure is structural to `auto`" is verified, not assumed). Four required edits (A1–A4 below).

**Critic verdict: APPROVE-WITH-개선.** Quality gate PASS on principle↔option consistency, fair alternatives, risk clarity, verification concreteness, deliberate-mode requirements, and (verified) the §9 instrumentation sequencing is airtight (`instrumentEditor` confirmed to hook only the shared `editor`, never `activeKeepaliveEditor`). FAIL items folded in below.

**Disposition (both reviewers):** Phase 0 (the §9 instrumentation fix + the spike) may BEGIN as specified. The **Phase 0 → Phase 1 commitment gate is BLOCKED** until amendments AM-1..AM-7 land and AC-6/AC-7/AC-9 are re-spec'd.

### Amendments

- **AM-1 (re-spec AC-6 — gameable metric).** AC-6 "DOM top-level count ≤ ~80" only proves a low node count for the A1 placeholder variant; under A2 the off-screen blocks REMAIN in the DOM as `content-visibility:hidden` boxes, so the count is meaningless and the real failure axis is *layout cost*. **AC-6 PRIMARY now = un-shimmed forced-reflow time** (see AM-5): a forced reflow (`view.dom.getBoundingClientRect()` / `posAtCoords` at viewport-center after marking layout dirty) at a fixed scroll state must be ≤ ~16 ms with the window active. Element count is kept only as a SECONDARY signal for the A1 variant.

- **AM-2 (re-spec AC-7 + re-phase scroll-restore).** AC-7 "≤ 4 px scroll drift" is unachievable with pixel-based restore over variable-height blocks (441-row table, 103 Mermaid, KaTeX). **Re-spec AC-7 against an ANCHOR-BLOCK INDEX**: after fast scroll up+down, the same anchor block returns to the same viewport-relative position (±0 blocks; sub-block px drift bounded by one block height), not a raw-pixel budget. **Move scroll-restore from Phase 2 to Phase 1** — `use-tab-switching.ts:256` raw-pixel `scrollTop` restore is a STEADY-STATE path hit on *every* keep-alive tab switch, not just navigation, so it must be virtualization-aware from the first virtualized phase.

- **AM-3 (re-spec AC-9 + add AC-11 — gameable metric + BLOCKER export gap).** AC-9 "flag-OFF byte-identical to C3" is trivially true by construction (flag-OFF = don't register the plugin) and proves nothing about the ON path. **Add AC-9b: with the flag ON and the document fully revealed (`revealAll()`), export + MD→PM→MD roundtrip are byte-identical to flag-OFF.** **Add AC-11: HTML/PDF export and print of the virtualized fixture are byte-identical to the flag-OFF export.** Rationale (BLOCKER, verified by both reviewers): `src/utils/export/export-html.ts:29-39` `captureEditorHTML` clones the LIVE `editor.view.dom` (`cloneNode(true)`) and reads `getComputedStyle` on live code-block nodes; callers `src/utils/export/export.ts:21` (HTML) and `:42` (PDF/print). Under virtualization this exports EMPTY placeholders for every off-screen block — silent data loss in a saved file. This is the exact silent-corruption Driver 3 claims to avoid.

- **AM-4 (NEW FR-9 + `withVirtualizationSuspended()`).** FR-9: every consumer that reads the *rendered DOM* rather than the doc model MUST fully render the document first. Wrap each in `withVirtualizationSuspended(fn)` / `revealAll()` (reuses the §6 kill switch: temporarily disable the window, render all blocks, run, restore). Consumers (grep-verified, currently zero handling): HTML/PDF export (`export-html.ts:29-39`, `export.ts:21,42`), print, `Cmd+A` select-all, copy-of-large-selection, and a decision on native `Cmd+F`. Add the touched files to Phase 3/4 "Files touched."

- **AM-5 (Phase 0 spike rigor — de-circularize + broaden + fix scroll state).** The §4 Phase 0 exit gate is replaced by: measure a FORCED REFLOW (not just a click) at a FIXED scroll state (scroll to ~70%, force layout flush, then measure), recording THREE numbers — (a) flag OFF, (b) flag ON + pre-reveal shim, (c) flag ON + shim DISABLED. **GO requires case (c), the UN-SHIMMED reflow, to be acceptable** (≤ ~16 ms), because PM issues internal geometry queries (DOMObserver, selection sync, `scrollIntoView` on dispatch, composition end) that the shim cannot bracket — and the C1 Enter-revert (`5c82ab6`) is direct evidence that PM-internal behavior, not app calls, is what bites. The "click" surface is NOT just `posAtCoords` (3 sites) — it is the geometry-read surface across ~10 sites (`Outline.tsx:42`, `use-editor-effects.ts:109/158`, `FindReplaceBar.tsx:127`, `use-tab-switching.ts:386`, code-block/footnote/math-inline views). The spike MUST include a **click-into-a-virtualized-441-row-table probe** (M10 table rows already use the burned `content-visibility:auto`, `editor.css:1323-1326`; nesting A2 around them may reproduce the 5 s stall).

- **AM-6 (Phase 0 NO-GO rollback — concrete, and C is NOT resurrected).** If A2 fails the un-shimmed gate, PIVOT to A1 (placeholder NodeView, genuinely empty far box). If BOTH A1 and A2 fail AC-4/AC-6 un-shimmed on WKWebView, **ABANDON C4 and keep C3** (flag stays OFF). Option C (`content-visibility:auto` + gating) is explicitly NOT resurrected as the fallback — it is the twice-reverted structurally-failing path; the §10 ADR is corrected accordingly (the real escape hatch is A1, then abandon-to-C3). Abandon checklist: record the three measured reflow numbers in the impl note, keep the flag OFF, file the WKWebView limitation, close C4.

- **AM-7 (A2/A1 same-axis + near/far hybrid + select-all).** A2 (`content-visibility:hidden`, structurally stable DOM → selection/DOMObserver-safe but a layout box still exists) and A1 (placeholder swap, genuinely empty box → cheap layout but structural DOM churn risking the DOMObserver/selection corruption this codebase repeatedly hits — cf. MEMORY.md "NodeSelection click-away", "SyntaxReveal cursor mapping") trade the SAME axis in OPPOSITE directions. Adopt a **near/far hybrid**: A2 in the near buffer band (selection-reachable, churn-sensitive), A1 genuine-empty placeholder for far-off-screen blocks (> ~3× viewport, never holds selection). The spike measures the crossover. **Detect full-document select-all and SUSPEND (reveal-all) rather than window it.**

### New risks (append to §5)

- **R11 — Export/print/copy read the live rendered DOM** (`export-html.ts:29-39`, `export.ts:21,42`). Likelihood Certain-if-unhandled / Impact Critical (silent data loss in saved files). Mitigation: AM-4 `withVirtualizationSuspended()`. Pre-mortem scenario #4.
- **R12 — Accessibility / screen-reader regression.** VoiceOver/rotor cannot perceive ~3,400 off-screen blocks. Likelihood High / Impact High for AT users. Mitigation: open question + minimum (reveal-all on AT detection or documented limitation); MUST be a named §10 ADR consequence, not silent.
- **R13 — Native `Cmd+F` (WKWebView find-in-page)** searches only rendered DOM → silently misses off-screen text. Mitigation: AM-4 decision (supersede with in-app find, or reveal-all on native-find trigger).

### Pre-mortem scenario #4 (append to §3)

**"The exported/printed file is half empty."** We ship virtualization; a user exports a large doc to HTML/PDF or prints it; `captureEditorHTML` clones the live DOM containing `content-visibility:hidden`/placeholder boxes; off-screen blocks export as empty. Silent data loss in a persisted artifact — worst class of bug. **Mitigation:** AM-4 — every DOM-reading consumer calls `withVirtualizationSuspended()` to fully render before reading; AC-11 e2e asserts export byte-identity vs flag-OFF.

### ADR corrections (§10)

- **Fallback chain corrected:** A2 → A1 → abandon-to-C3. Option C is NOT the fallback (it is structurally failing and twice-reverted).
- **Consequences add:** (−) HTML/PDF/print export and Cmd+A/native-Cmd+F must suspend virtualization (new `withVirtualizationSuspended()` surface); (−) accessibility/screen-reader perception of off-screen content is lost unless mitigated — a named limitation requiring an AT-reveal path or documented acceptance.

### Changelog

- Applied Architect (sound-with-changes): AM-1/AM-2/AM-4/AM-5/AM-7 + ADR fallback correction.
- Applied Critic (approve-with-개선): AM-3 (AC-9b + AC-11 export), AM-4 (FR-9 select-all/print/native-find), R11/R12/R13, pre-mortem #4, AC-6 forced-reflow re-spec, AM-6 NO-GO rollback, AM-7 select-all suspend, accessibility open question.
- Both reviewers verified §9 instrumentation sequencing is airtight and the B/C invalidations are code-grounded. Phase 0 approved to begin; Phase 0→1 gate blocked pending AM-1..AM-7.

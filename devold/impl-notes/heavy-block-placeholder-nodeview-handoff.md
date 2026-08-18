# Heavy-Block Placeholder NodeView — Session Handoff

§perf-large-file · branch `feature/heavy-block-placeholder-nodeview` (off main @ #141 merge)
Status: SPIKE DONE (2026-06-24) — **both cheap load levers REFUTED.** See conclusion below; the rest of this doc is the (now-refuted) original plan, kept for context.

---

## CONCLUSION (2026-06-24): spike done — placeholder AND band-reduction both REFUTED

Ran the recommended diagnostic spike (throwaway custom table NodeView + an in-app measure harness, GUI/WKWebView on CONTEXT.md ≈402 tables / ~3000 blocks). Measured `__baramPerf.txBreakdown().transactions.totalMs`:

| config | what it isolates | totalMs |
|---|---|---|
| original (real tables, BUFFER_PX=1200) | true baseline | **39.5s** |
| atom (tables → trivial `hr`, realistic 360px height) | construction removed, band normal | **37.2s** (≈ baseline, ~6%) |
| atom (tables → `hr`, ~16px short) | construction removed, band inflated | 172s |
| stub (contentDOM-less div, short) | — | 132s |
| buffer=0 (real tables, band = viewport only) | band shrunk during load | **64s (WORSE)** |

**Findings (do NOT re-derive / re-attempt):**
1. **Deferring heavy-block construction is NOT the lever.** Replacing all 402 tables with trivial `hr` but keeping realistic height (atom 360px) = 37.2s ≈ baseline 39.5s. Construction is only ~6% of load. So a placeholder NodeView (the whole premise of this branch) cannot meaningfully cut load. **NO-GO.**
2. **Shrinking the windowing band is NOT the lever either.** `buffer=0` (band = viewport, 3140 blocks hidden) = 64s, *worse* than baseline (display:none-toggle / huge-spacer churn). Short placeholders inflate the band → 172s. original's natural band (BUFFER_PX=1200) is already a sweet spot; moving either way is worse. **NO-GO.**
3. plugin/event apply time is ~30ms total in every config — the ~38s is entirely PM's per-chunk DOM reconcile + layout over ~3000 blocks.
4. The ~38s floor is **intrinsic to ProseMirror rendering the whole doc**. Confirmed the design thesis: only **CodeMirror-6-style true viewport virtualization** (don't render the whole doc) can move it — a large architectural effort. Remaining options: accept the floor, or scope the CM6 path.

**Throwaway spike code on this branch** (revert when closing; the measure harness is reusable for any future load work): `table.ts` addNodeView + `TableView` import; `src/utils/editor/spike-runner.ts` (measure harness + table-swap + buffer report); `use-tab-switching.ts` (load-start reset, finishLoad snapshot, table-swap call); `viewport-virtualize.ts` `bufferPx()` + 2 call sites. All DEV + localStorage gated (`baramSpikeTableMode` / `baramSpikeManual` / `baramSpikeBuffer`), off by default — tests + typecheck green. Memory: [[project-placeholder-nodeview]].

---

## Goal

Cut the large-doc **load floor** (~38s of transaction time opening `CONTEXT.md`, ≈3,000 heavy blocks) by **deferring heavy-block DOM *construction*** — not just layout (PR #141 Phase 0) or content (PR #141 Phase 2). This is the "branch b" / placeholder-NodeView path: off-screen heavy blocks render a cheap sized box and build their real DOM only when scrolled near.

This is the one remaining lever for load. It must NOT regress PR #141's shipped wins (steady-state windowing + math-lazy KaTeX).

## Why this is the only load lever (established — do NOT re-derive)

- **Load is construction-dominated.** GUI A/B in PR #141 (CONTEXT.md, WKWebView): windowing ON `tx.totalMs=39,607` ≈ OFF `42,990`. `display:none` hides blocks *after* PM constructs them; content-lazy (math/mermaid/code via `onFirstVisible`) defers expensive *content* (KaTeX/SVG/CM) but PM still constructs the node + DOM at chunk-insert time. So neither cuts load.
- **Why Obsidian opens CONTEXT.md instantly:** it uses **CodeMirror 6**, which natively virtualizes the viewport — only visible lines are real DOM; the rest is a cheap text model. Baram uses **ProseMirror**, which renders the *whole* doc as a DOM tree (one NodeView per block). A placeholder NodeView is the closest PM can get to CM6's just-in-time rendering, while keeping the full doc in the PM model (so find/links/outline still work).
- Three chunking-based load attempts were already refuted (see [[large-doc-edit-latency-root-cause]]): the total construction work is ~constant across chunk configs; the heavy DOM is the floor.

## RECOMMENDED FIRST STEP — diagnostic spike (evidence before the big build)

The full placeholder system is large + risky (custom NodeViews, selection/contentDOM, re-mount, column-resize interplay). Before building it, **confirm which heavy type dominates the ~38s construction**, so the risky work is spent where it pays.

Cheap throwaway hack on this branch:
1. During progressive load, render **tables as a stub** — e.g. in `collectBlocks`/table NodeView path, skip building the prosemirror-tables `TableView` content (render an empty sized `<div>` placeholder) for tables not yet visible. (Throwaway — does not need to be correct/editable; just measures.)
2. Measure `window.__baramPerf.txBreakdown().transactions.totalMs` on CONTEXT.md in WKWebView (`tauri dev`), reset→open→settle→read. Baseline to beat: **~38s** (PR #141 Phase 2 = 37,784).
3. Decide:
   - **tx drops a lot** → table construction dominates → build the real placeholder NodeView for tables first.
   - **tx ~flat** → bottleneck is PM doc-update/layout in general, not table construction → placeholder won't help much; reconsider scope (possibly a CM-based view for huge files, or accept the floor).

Then revert the hack and proceed via the normal flow.

## Approach (if the spike says go)

A custom NodeView for the heavy type that:
- renders a **sized placeholder** (`<div>` with an estimated height) when off-screen,
- builds the **real content** (TableView / KaTeX / etc.) on `onFirstVisible`, and
- (optionally) **releases** back to placeholder when far off-screen (memory; the mermaid/code "far-exit release" Phase 3 idea — also unbuilt).

Start with the type the spike fingers (likely **tables** — heaviest to construct: many cell DOM nodes). Math is an atom (no contentDOM) → easier; tables have editable contentDOM → hardest.

## Key code pointers (current state, post-#141)

- **Windowing engine** — `src/extensions/plugins/viewport-virtualize.ts`: `collectBlocks()` (now windows tables via `isTableWrapper` = `.tableWrapper`|`<table>`), `VirtualizeController` (band/spacers/reveal), geometry in `viewport-virtualize-geometry.ts` (`HeightMap`, `ESTIMATE_PX=28`). `LIGHT_VIRTUALIZED_TYPES` get a generic NodeView; tables get an ad-hoc `display:none` handle; other heavy = `windowable:false`.
- **Tables** — `src/extensions/nodes/table.ts`: `BaramTable = Table.extend(...).configure({ resizable:true })` → vanilla prosemirror-tables `TableView` (`div.tableWrapper`), **no custom `addNodeView()`**. branch-b adds a custom table NodeView (placeholder-until-visible). ⚠ `resizable:true` makes `columnResizing` provide its OWN `table` nodeView via plugin props — a custom `addNodeView()` must either subclass/replicate `TableView` (colgroup + resize) or coexist with it. This is the main risk.
- **lazy-visible** — `src/extensions/nodes/views/lazy-visible.ts`: `onFirstVisible(el, cb)`, shared `IntersectionObserver` (rootMargin 200px), idle mount queue, **mount-once (no release)**. Used by mermaid (`mermaid-block-view.tsx`), code (`views/code-block-node-view.ts`), and math (`math-inline-view.tsx`/`math-block-view.tsx`, #141). `_resetForTest()` for tests.
- **Progressive load** — `src/utils/editor/progressive-load.ts`: `appendChunksProgressively`, `PROGRESSIVE_LOAD_META`, adaptive chunk sizing (REST 150 / MIN 25 / 50ms budget), input-pressure deferral (`INPUT_QUIET_MS=100`).
- **Load orchestration** — `src/hooks/use-tab-switching.ts` (`finishLoad`, `setTabLoading`), `src/hooks/use-source-mode.ts`.
- **Perf harness (GUI-only, DEV)** — `src/utils/editor/perf-trace.ts`: `window.__baramPerf` (`txBreakdown()`, `stalls()`, `inputLatency()`, `reset()`); `window.__virt.debugState()` (windowing: `hidden`/`band`/`totalHeight`).
- **Controller test harness** — `src/extensions/plugins/__tests__/viewport-virtualize-controller.test.ts` (mount real editor, stub `offsetHeight`/`clientHeight`). React-NodeView lazy tests — `src/extensions/nodes/views/__tests__/math-lazy.test.tsx` (RTL `<EditorContent>` + per-editor DOM assert + katex mock; needs `document.body` mount + leading paragraph so a sole atom isn't auto-NodeSelected + `afterEach` idle-queue drain).

## Risks / gotchas

- **Table NodeView vs `columnResizing`** (above) — the highest risk; prototype this interplay early.
- **contentDOM / selection** — an off-screen editable block as a placeholder (no contentDOM): editing must reveal+build first. Reveal helpers exist: `revealBlock`/`revealElement`/`revealBlockInActiveEditor`, `withVirtualizationSuspended` (export). Find/nav already call them.
- **Re-mount correctness** — PM destroys+recreates NodeViews on any reconfigure/`registerPlugin` (see [[pm-plugin-view-recreate-controller-revive]]); build-on-visible must be idempotent and survive that.
- **Cross-schema insert** — nodes built with one editor's schema inserted into another fail PM validation (see [[pm-doccreate-vs-trinsert-validation]]).
- **Height estimation** — placeholder must reserve a realistic height or the scrollbar jumps (tables vary; `ESTIMATE_PX=28` is far too small). `HeightMap` keys by `data-block-id` else index.
- **Don't regress #141** — keep windowing steady-state + math-lazy intact.

## Workflow + conventions

- Process: `superpowers:brainstorming` → run the diagnostic spike → `superpowers:writing-plans` → TDD (`superpowers:test-driven-development`) → human GUI gates per phase.
- Tests: `npx vitest run` (NOT jest). GUI perf is human-measured in WKWebView (`tauri dev`); `CONTEXT.md` is the untracked perf fixture at repo root — **never commit it**.
- Commits: English, lowercase subject, tag `§perf-large-file`. Conversational replies in Korean; git/PR text in English.
- OMC: delegate heavy code edits to `executor`/`deep-executor`; explore via `Explore` agents (note: in the prior session Explore agents sometimes returned empty meta-summaries — instruct them to paste findings in their FINAL message, or read files directly).

## Background

- Shipped predecessor: PR #141 (this saga's windowing + math-lazy), PR #140 (edit-latency). Design spec: `dev/superpowers/specs/2026-06-23-heavy-block-windowing-design.md`.
- Memory: [[project-placeholder-nodeview]] (this project), [[project-heavy-block-windowing]] (#141, done), [[large-doc-edit-latency-root-cause]] (#140 + load floor analysis), [[content-visibility-wkwebview-virtualization]], [[pm-plugin-view-recreate-controller-revive]].

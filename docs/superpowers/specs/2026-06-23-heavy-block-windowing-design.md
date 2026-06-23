# Heavy-Block Windowing — Design

Branch: `feature/heavy-block-windowing` · §perf-large-file
Status: design approved. Follow-up to PR #140 (edit-latency, merged).

---

## Context

PR #140 fixed large-doc **edit latency** (click→cursor ~1s→fast; per-keystroke 1223→252ms) by gating the @tiptap Placeholder off on the large keep-alive editor and skipping windowing reconcile on text-only edits. It left one thing unsolved: the **~28s background progressive-load** on large docs. The perf fixture `CONTEXT.md` (≈ 3,000 top-level blocks) contains roughly **342 tables + 317 inline KaTeX + 94 mermaid + 66 code** blocks.

Root cause established last saga: the C4 windowing engine (`src/extensions/plugins/viewport-virtualize.ts`) windows only **light** top-level blocks (paragraph / heading / list / blockquote / horizontalRule / definitionList / callout) via `display:none` + pseudo-element spacers. **Heavy blocks are never windowed** — `collectBlocks()` drops every unregistered child of `.tiptap` into a no-op fallback:

```ts
out.push(light ?? { dom: el, setHidden: () => {}, windowable: false });
```

So all 342 tables + KaTeX + mermaid render and lay out eagerly. `HEAVY_VIRTUALIZED_TYPES` is exported but unused. Three load-fix attempts via chunking (React-portal reduction, windowing-skip-during-load, bigger chunks) were all refuted; the heavy DOM is the floor. The only remaining lever is **windowing the heavy blocks** — which is what this design does.

**Goal**: cut the ~28s load AND improve steady-state scroll/memory on large docs. Steady-state is weighted slightly higher than load.

---

## Approach (Section 1 — approved)

**Approach B — hybrid by block nature** (chosen over A=uniform-controller, C=load-only). Each heavy type gets the mechanism that matches how it renders:

- **Tables** → `display:none` windowing (skips off-screen layout).
- **Math inline + block** → lazy-visible KaTeX deferral (defer construction until visible).
- **Mermaid + Code** → already lazy-deferred; add far-exit release for memory.

**Execution model**: a phase loop, **GUI-gated per phase**. Code + vitest + lint + typecheck + commit are autonomous; the success criterion (WKWebView layout / scroll / load) is **human-measured** — jsdom cannot verify layout, scroll, or reflow. Each phase ends at a copy-paste measurement gate the user runs in `tauri dev`.

### Decisions locked

- **Table mechanism = `collectBlocks` direct-toggle** (no custom NodeView). Tables have no lazy-visible IntersectionObserver, so `display:none` on the existing prosemirror-tables `TableView` wrapper is safe and reversible. Smallest diff, lowest risk, correct shape for the Phase 0 spike. A custom NodeView (for a stable height key / explicit lifecycle) is a Phase-1 escalation **only if the spike proves it necessary**.
- **Phase 0 contingency = decide at the gate.** `collectBlocks` direct-toggle AND a custom NodeView both skip only *layout*, never DOM *construction*. Whether load is layout- or construction-dominated is **unverified** (mis-attributed three times last saga). Do NOT pre-commit. This spec documents both fallback branches; the Phase 0 measurement decides.

---

## Section 2 — Per-Block Windowing Mechanism

Reuse the C4 engine unchanged (`VirtualizeController`, `HeightMap`, `computeBand`/`computeDelta`, `--vtop`/`--vbot` spacers). Only the **windowable boundary** — which blocks the controller hides — is extended, per block nature.

### 2.1 Tables → `display:none` (Phase 0–1)

- **Mechanism**: in `collectBlocks()` (`viewport-virtualize.ts:340`), replace the catch-all fallback *for table wrappers only* with a windowable handle that toggles `display` directly on the existing DOM:
  ```ts
  const light = this.handles.get(el);
  if (light) { out.push(light); continue; }
  if (isTableWrapper(el)) {
    out.push({ dom: el, setHidden: h => { el.style.display = h ? "none" : ""; }, windowable: true });
  } else {
    out.push({ dom: el, setHidden: () => {}, windowable: false });
  }
  ```
  `isTableWrapper(el)` = `el.classList.contains("tableWrapper") || el.tagName === "TABLE"` (prosemirror-tables `resizable:true` wraps the table in `div.tableWrapper`; bare `<table>` is the no-resize fallback).
- **Why safe**: the original reason heavy blocks were `windowable:false` is that `display:none` removes a lazy-visible block's observed box so its content never mounts. **Tables have no IntersectionObserver** — `BaramTable` (`src/extensions/nodes/table.ts`) is the vanilla `@tiptap/extension-table` with `resizable:true` and **no custom `addNodeView()`**; it builds its cell contentDOM eagerly. So `display:none` only skips layout and is reversible. No custom NodeView, no column-resize interaction.
- **Spacer**: `applySpacers()` already reserves height for any handle with `windowable !== false`, so windowed tables are counted automatically. `measureBand()` reads `offsetHeight` of in-band tables into the HeightMap.
- **Height estimate**: `ESTIMATE_PX = 28` is far too small for an unmeasured (off-screen) table → scroll / scrollbar jumps as tables are measured on reveal. **Phase 1**: per-type estimate (table ≈ 200px) so the off-screen spacer is roughly right before measurement. (Acceptable in Phase 0: appended tables are below the fold during load, so jumps aren't visible — the spike only asks "does load drop?".)
- **Ad-hoc handle is stateless** (recreated each `collectBlocks`): fine — `applyBand` writes `display` idempotently; no per-table `hidden` closure is needed.

### 2.2 Math inline + block → lazy-visible KaTeX deferral (Phase 2)

- **Current**: `MathInlineView` (`math-inline-view.tsx`) and `MathBlockView` (`math-block-view.tsx`) call `katex.render(...)` in a mount `useEffect` **eagerly, for every instance** — this is the KaTeX share of load cost. Neither uses lazy-visible. Both are React NodeViews; both nodes are atoms.
- **Change**: adopt the mermaid pattern verbatim — `const [isVisible,setIsVisible]=useState(false); useEffect(()=>onFirstVisible(wrapperEl,()=>setIsVisible(true)),[])` and gate the render effect on `isVisible`. KaTeX builds only when the node nears the viewport.
- **Composition with table/light windowing**: inline math lives inside a paragraph (a *light, already-windowed* block). When that paragraph is `display:none`'d off-screen, the math's IntersectionObserver never intersects → KaTeX deferred; on scroll-back the paragraph shows, the observer fires → KaTeX renders. Self-healing, no extra wiring. Math **block** stays a rendered placeholder (it is its own top-level block) — `windowable:false` is fine; only its KaTeX construction is deferred.
- **Selected/edit path** must bypass the gate (force `isVisible` when `selected`) so clicking a never-yet-rendered math node still shows the editor — mirror mermaid/code's synchronous interaction bypass.

### 2.3 Mermaid + Code → far-exit release (Phase 3, conditional, riskiest)

- **Current**: both use `onFirstVisible` (mount-once). `MermaidBlockView` sets `isVisible=true` and never reverts (`mermaid-block-view.tsx:50-55`); `code-block-node-view.ts` calls `ensureCM()` once. No release when scrolled far away → mounted SVGs / CodeMirror instances accumulate (memory).
- **Change**: when a block exits a far margin (well beyond the windowing buffer), release its heavy content (unmount CodeMirror / drop mermaid SVG, revert to placeholder) and re-arm `onFirstVisible`. **Never release a block that is focused / selected / being edited / dirty** — preserve editing state. This is last because it is the highest-risk (re-mount correctness, selection/undo, IO re-arming).

### 2.4 Pre-existing overlap to resolve

`table-virtual-scroll.ts` (`createVirtualScrollPlugin`) runs `applyVirtualScrollToLargeTables(view)` on **every** view update — `querySelectorAll("table")` + per-table `querySelectorAll("tr")`, applying `content-visibility:auto` to rows of ≥50-row tables. For a windowed (`display:none`) table this row-level work is redundant, and the per-update DOM walk is a latent cost on a 342-table doc. **Phase 1**: gate it to skip hidden tables and/or run only on structural change. Keep scope tight — it's orthogonal to the core mechanism.

---

## Section 3 — Interactions & Edge Cases

- **Reveal-before-nav (already wired)**: `revealBlockInActiveEditor` is called by `Outline.tsx`, `QuickSwitcher.tsx`, `FindReplaceBar.tsx`; `revealElementInActiveEditor` by `BookmarkPanel.tsx`; export uses `withVirtualizationSuspended`. `revealBlock(pos)` resolves a top-level **index** and reveals a band around it — so it already covers tables once they're windowable. **No new wiring expected; verify each path lands correctly in a hidden table.**
- **Edit-entry into a hidden table**: a hidden table is replaced by spacer height, so the user can't click it directly. Programmatic / find selection routes through reveal. Verify find-match and Outline/QuickSwitcher jumps into off-screen tables.
- **Selection preservation**: confirm the controller does not `setHidden(true)` the block currently holding the selection/cursor while editing (light blocks ship this today; re-verify for tables, which hold contentEditable cells).
- **Export / Source-mode**: `withVirtualizationSuspended` reveals all then re-windows — tables must be revealed so export / source-mode capture full content. Verify.
- **Height-key stability**: `keyOf` uses `data-block-id` else `#index`. `BlockIdDecoration` assigns block-ids to **paragraph/heading only**, so tables key by index — but most light blocks also key by index today and load is tail-append (indices stable), so this is the existing, working norm. Structural edits *above* a table could mis-attribute a cached height → Phase 1 adds a stable key only if scroll-jump testing shows it matters.
- **Scroll stability** is the real steady-state risk for tables (large variable heights). Addressed by 2.1's per-type estimate + measure-on-show + HeightMap cache.

---

## Section 4 — Verification Strategy & GUI Gate Protocol

### Automated (each phase, autonomous): `npx vitest run` + typecheck + lint

- Controller integration tests (`viewport-virtualize-controller.test.ts` pattern — mount a real Tiptap editor, stub `offsetHeight`/`clientHeight`): a table wrapper is windowable (gets `display:none` off-band), `applySpacers` includes table height, `revealBlock` reveals a table by index, `collectBlocks` keeps non-table heavy blocks `windowable:false`.
- Math unit: render effect does not call `katex.render` while `isVisible===false`; renders once visible; `selected` bypasses the gate.
- jsdom cannot measure layout — perf is GUI-only.

### Human GUI gate (WKWebView via `tauri dev`, `CONTEXT.md` fixture, per phase)

Probes: `window.__baramPerf` (`inputLatency()`, `stalls()`, `txBreakdown()`, `reset()`), load wall-clock, `window.__virt.debugState()` (`hidden` / `band` / `totalHeight`). One copy-paste measurement script per gate.

- **Phase 0 — spike, go/no-go**: tables-only `display:none`. Measure: **does total load drop?** (confirms layout- vs construction-dominated) · scroll stable (no freeze) · selection/edit normal · `__virt.hidden` > 0.
  - Branch (decide *here*, with data): load drops → proceed as planned. Load unchanged (construction-dominated) → choose (a) accept steady-state-only wins + lean on math lazy (Phase 2), or (b) escalate tables to a placeholder-NodeView that defers construction.
- **Phase 1 — harden tables**: per-type estimate + measure-on-show + cache; reveal/find/Outline/export/source-mode; vscroll-plugin overlap. Gate: no scroll jumps; nav lands correctly; export/source intact.
- **Phase 2 — math lazy KaTeX**. Gate: load's KaTeX share drops; math renders on scroll; click-to-edit on an unrendered node works.
- **Phase 3 — far-release (conditional on Phase 0–2 results)**. Gate: idle/steady memory drops; re-mount correct; focused/edited blocks never released.

---

## Critical Files

- `src/extensions/plugins/viewport-virtualize.ts` — `collectBlocks()` table branch (2.1), per-type estimate (Phase 1). Engine otherwise unchanged.
- `src/extensions/plugins/viewport-virtualize-geometry.ts` — HeightMap; touch only if a table-aware estimate needs a per-key default.
- `src/extensions/nodes/math-inline-view.tsx`, `math-block-view.tsx` — add `onFirstVisible` gate (Phase 2), mirroring `mermaid-block-view.tsx:50-55`.
- `src/extensions/nodes/views/lazy-visible.ts` — add release/re-arm for far-exit (Phase 3).
- `src/extensions/nodes/mermaid-block-view.tsx`, `views/code-block-node-view.ts` — wire release (Phase 3).
- `src/extensions/nodes/plugins/table-virtual-scroll.ts` — gate redundant work for windowed tables (Phase 1, optional).
- Tests: `src/extensions/plugins/__tests__/viewport-virtualize-controller.test.ts` + math view tests.

## Process

1. Implement Phase 0 (collectBlocks table branch + a controller test) → autonomous green (vitest/lint/typecheck) → commit → **stop at the GUI gate** and hand the user the measurement script.
2. Proceed phase by phase; each phase: code → autonomous green → commit → GUI gate → user reports → next phase or branch.

Conventions: `npx vitest run`; commit subject English lowercase tagging `§perf-large-file`; `CONTEXT.md` is the untracked perf fixture (never commit). Conversational replies Korean.

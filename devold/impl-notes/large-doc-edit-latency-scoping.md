# Large-Doc Heavy-Block Edit-Entry Latency — Scoping (2026-06-22)

> Fresh-session starting point. Branch: `feature/large-doc-edit-latency` (off main after the C4 windowing merge, PR #132).
> This is a SEPARATE, pre-existing problem from windowing — do not reopen the windowing engine.

## Symptom

On the large keep-alive editor (`CONTEXT.md`, ~3,500 top-level blocks), clicking a **math** or **mermaid** block to enter edit mode takes **~1 second**. Smaller docs are instant.

## Key fact: NOT a windowing regression

Reproduces with the windowing kill-switch (`virtualizeLargeDocs`, Settings → Editor → "대용량 문서 가상화") **both ON and OFF**. So the cost is inherent to editing heavy blocks in a large document, independent of the C4 windowing engine. (math/mermaid edit-entry DOES work — it's just slow; an earlier "mermaid doesn't enter at all" report was transient.)

## Edit-entry path (both blocks)

`handlePreviewClick` → `editor.commands.setNodeSelection(getPos())` →
`selected` prop flips true → NodeView re-renders into editing mode.

- math: `src/extensions/nodes/math-block-view.tsx` (`handlePreviewClick` ~L149). NOT lazy-visible gated.
- mermaid: `src/extensions/nodes/mermaid-block-view.tsx` (`handlePreviewClick` ~L232). Content gated on `isVisible` via `onFirstVisible` (lazy-visible IO); the `selected`-render effect (~L103) re-runs `renderMermaid` with a `selected ? 300ms` debounce.

## Suspects (rank by measurement, do NOT guess — see [[feedback_debug_thoroughly]])

1. **`setNodeSelection` transaction cost on a 3,500-block doc.** A NodeSelection tx runs every plugin's `apply` over its whole-doc DecorationSet. Measured during typing (windowing on): `fold$` 129ms / `listAtomFix$` 122ms / `blockIdDecoration$` 57ms total over 245 txs, **max 7ms each** — the "decoration long-tail." A NodeSelection may hit these harder. This is the same long-tail flagged out-of-scope in the C4 handoff.
2. **Heavy NodeView re-render on `selected` change.** mermaid re-renders its SVG (300ms timer + `renderMermaid`); math re-renders KaTeX (should be <50ms — so math's ~1s is suspicious and points more at #1).
3. **`selectionUpdate` listeners.** Typing showed `selectionUpdate` 135ms / 192 calls ≈ 0.7ms each; a NodeSelection may trigger a heavier listener (e.g. a panel/toolbar reading the selected node).

## First step (the ONE decisive measurement)

`npm run tauri dev` → open CONTEXT.md → DevTools console:
```js
__baramPerf.reset();
// click a math block, then a mermaid block, to enter edit mode
const b = __baramPerf.txBreakdown();
console.log("transactions:", JSON.stringify(b.transactions)); // PM dispatch total/count/max
console.log("plugins:", JSON.stringify(b.plugins));           // which plugin .apply dominates
console.log("events:", JSON.stringify(b.events));             // selectionUpdate etc.
console.log("inputLatency:", JSON.stringify(__baramPerf.inputLatency()));
```
- If `plugins` shows fold/listAtomFix/blockId dominating the NodeSelection tx → the fix is **viewport-windowing those DecorationSets** (only decorate the visible band; recompute on scroll). This also kills the residual p99 typing hitch.
- If `transactions` dispatch is small but the gap to a wall-clock ~1s is large → the cost is the heavy NodeView's React re-render → optimize the `selected` render (avoid full re-render / re-`renderMermaid`).
- Note: `transactions.maxMs` is inflated by load outliers; correlate with a manual click, not the mean.

## Tools / facts

- `window.__baramPerf` (DEV): `inputLatency()`, `txBreakdown()` ({events, plugins, transactions}), `reset()`. WKWebView has NO `longtask` PerformanceObserver.
- `window.__virt.debugState()` (DEV) — windowing controller introspection (band/hidden/heightmap).
- `window.__baramEditor` (DEV) — the active editor for synthetic dispatch benches.
- Two editors: shared `editor` + large-doc keep-alive editor (`createKeepaliveEditor`, separate Schema, threshold 500 blocks). CONTEXT.md uses the keep-alive editor.
- The C4 windowing engine (display:none + pseudo-spacers + scroll-driven band) is in `src/extensions/plugins/viewport-virtualize*.ts`. Heavy blocks are NOT windowed (they own a lazy-visible IO). See [[pm-plugin-view-recreate-controller-revive]].

## Conventions

Commit msgs English, lowercase subject (commitlint), tag the relevant section. Conversational replies Korean. pre-commit: prettier + eslint `--max-warnings=0` (perfectionist sorting). Vitest only (`npx vitest run`). `CONTEXT.md` (repo root, untracked) is the perf fixture — never commit it. GUI verification is human-run (jsdom can't exercise layout); a vitest controller-integration test pattern with stubbed heights exists in `viewport-virtualize-controller.test.ts`.

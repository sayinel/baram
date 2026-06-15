# C4 Large-File Perf (Block Virtualization) — Session Handoff (2026-06-15)

> Resume point for a fresh session. Branch: `feature/large-file-perf`.
> Plan: [`docs/plans/2026-06-13-large-file-perf-c4-virtualization-plan.md`](../plans/2026-06-13-large-file-perf-c4-virtualization-plan.md).
> Prior handoff (C3, truncation): [`large-file-perf-c3-handoff.md`](large-file-perf-c3-handoff.md).
> Goal the user wants: **Obsidian-level** large-file editing (CONTEXT.md ≈ 3,500 top-level blocks / ~21k lines) — typing/scroll/click/math-edit all "real-time", no bottleneck.

---

## TL;DR — where we are

- The **truncation bug is fixed and shipped** (`d0d655b`, GUI-confirmed) — large files now fully open. That was the original blocker.
- **Block virtualization (C4)** is in progress behind a DEV flag (`window.__baramFlags.virtualize`). It is **ALWAYS-ON when enabled, OFF by default**. Current mechanism (see `src/extensions/plugins/viewport-virtualize.ts`):
  - **paragraph + heading**: a generic NodeView (`makeNodeView`, renders via the node's own `toDOM` so it is a faithful passthrough when the flag is off) whose dom gets `content-visibility:hidden` when off-screen.
  - **heavy blocks** (codeBlock, mermaidBlock, mathBlock, queryBlock, table): the controller toggles `content-visibility` directly on their DOM (found via `view.nodeDOM()` doc-walk) — they own React NodeViews so we can't wrap them.
  - A per-editor `VirtualizeController`: keeps off-screen blocks hidden at all times, maintains the window from a **position cache** (no layout read per keystroke), delta-toggles only blocks crossing the viewport boundary, driven by the plugin's `view.update()` (every tx) + a scroll listener. `flag-off → reveal all` (passthrough).
- **Measured progress (CONTEXT.md, WKWebView dev, via `window.__baramPerf`):** typing 467ms (baseline) → ~26ms avg (always-on). Scroll "much smoother". math/mermaid edit-entry "faster but still slow".

## CURRENT BLOCKER / NEXT STEP (start here)

**Symptom (last test):** typing "hello hello hello" logged `SLOW TX ~170–300ms docChanged=true plugins=fold$:38–56,listAtomFix$:6–9` on EVERY keystroke.

**Two things to resolve, in order:**

1. **CONFIRM THE FLAG STATE FIRST (unresolved).** It is unknown whether `window.__baramFlags.virtualize` was ON during that last test (it resets on reload). Of the ~170ms, only fold(~40) + listAtomFix(~7) are plugins → ~120ms is layout. **If the flag was OFF, that ~120ms is the un-virtualized baseline layout and would vanish with the flag ON.** So step 1 in the new session: open CONTEXT.md, `window.__baramFlags = { virtualize: true }`, scroll once to warm the cache, then `__baramPerf.reset()` → type → read `__baramPerf.txBreakdown().transactions` (avg = totalMs/count). Determine whether the ~120ms layout is gone with the flag ON.

2. **fold's ~40ms/keystroke is a CONFIRMED real bottleneck virtualization does NOT fix.** Root cause: `fold` (`src/extensions/plugins/fold.ts`) creates a gutter-arrow **widget Decoration for EVERY foldable** (1,391 headings in the fixture). On every keystroke `fold.apply` must `DecorationSet.map(...)` that ~1,391-widget set (~40ms) — this happens on BOTH the rebuild path AND the map-only path. The earlier "rebuild only on structural change" opt (`e4e6c61`) did NOT help because the cost is the per-keystroke MAP of the huge set, not the rebuild.
   - **Proposed fix (next lever):** render fold arrows via **CSS** (a `::before`/class on the heading + `data-fold-pos` attr + a delegated click handler) instead of ~1,391 widget decorations → fold's DecorationSet then holds only folded-heading decos (ellipsis + hidden-range nodes, i.e. only when something is actually folded) → per-keystroke `fold.apply` drops toward ~0. Risk: arrow positioning, click hit-area, folded-state visuals, and the existing fold tests (`src/extensions/__tests__/fold.test.ts`, `incremental-decos.test.ts`).
   - Alternative: window the arrow decorations (only visible headings) by coupling fold to the virtualization controller's viewport — more invasive, rejected for now in favour of CSS.

**The long-tail reality (tell the user):** virtualization fixes the *layout* cost, but multiple plugins each maintain a whole-document-sized DecorationSet that is mapped every keystroke — `fold` (~40ms, the big one), `listAtomFix` (~7ms), `block-id`, etc. Reaching Obsidian-level means addressing each (CSS rendering or viewport-windowing of their decorations). Each fix is bounded but there are several. This is why every fix has revealed the next bottleneck.

## What is committed this session (all green: 2460 pass / 6 skip, tsc clean, eslint --max-warnings=0 clean)

| Commit | What |
|---|---|
| `d0d655b` | **C3 truncation fix** — keep-alive editor has its own Schema; re-convert mdast with `targetEditor.schema` in use-tab-switching. SHIPPED, GUI-confirmed. |
| `3057613` | C4 plan + consensus review (architect+critic). |
| `007a39a` | perf: instrument the ACTIVE (keep-alive) editor (was only shared editor → txBreakdown read 0 on large docs). |
| `b91f332` | perf: per-plugin breakdown survives `EditorState.create` config replacement (re-patch on dispatch). |
| `a2aedfc`..`f9b6047` | Phase-0 spikes (imperative + decoration content-visibility) — all FAILED sustained typing; documented dead-ends, then paused + removed. |
| `51c1add`..`64d7e88` | A1 NodeView approach: prototype → narrow to paragraph+heading (container types broke math/mermaid) → cache positions → always-on → heavy blocks. **This is the current live code.** |
| `1c6aa5d` | DX: suppress SLOW TX warning for progressive-load chunks (PROGRESSIVE_LOAD_META) so the console isn't flooded during load. |
| `e4e6c61` | perf: fold rebuilds only on structural change (heading content edit = map-only). Did NOT fix the fold map cost (see blocker #2). |
| `dc8ac52` | test: harden code-block-lazy (vi.waitFor instead of setTimeout(50)) — was flaky under parallel load. |

## Dead-ends — do NOT retry (proven this session)

- **Imperative `el.style.contentVisibility` on DEFAULT-rendered blocks (v3/v4/v5):** PM re-renders those blocks when other plugins' decorations shift below the caret → clobbers the inline style → falls back to slow. (NodeView blocks are safe — PM doesn't re-render an off-screen NodeView.)
- **`Decoration.node` content-visibility (v1/v2/v6):** ~3,400 decorations remap/re-apply per keystroke → froze typing or 608ms (worse than baseline). PM re-applies node decorations to the DOM per keystroke.
- **Typing-only gating (hide only while typing):** made typing fast but scroll/click/math-edit still paid full layout (they're non-typing). → switched to always-on.
- **Generic NodeView for CONTAINER types (lists/blockquote):** broke math/mermaid edit-entry (confirmed by narrowing to paragraph+heading, which fixed it). Containers are NOT virtualized yet — needs a safe per-type approach. paragraph+heading+heavy ≈ 81% coverage.
- WKWebView does NOT support the `longtask` PerformanceObserver (always 0) — use `__baramPerf.stalls()` / `txBreakdown()`, not `longTasks()`.

## Architecture facts the new session needs

- **Two editor instances:** the shared `editor` (`useEditor` in App.tsx) and a **keep-alive editor** (`createKeepaliveEditor`, separate Schema) used for large docs (≥ `LARGE_DOC_BLOCK_THRESHOLD` = 500). They have DIFFERENT Schema objects — never insert nodes built with one editor's schema into the other (that was the truncation bug). See [[pm-doccreate-vs-trinsert-validation]] memory.
- The virtualization plugin is registered in `createBaramExtensions()` (`src/extensions/index.ts`, `ViewportVirtualize` after `Fold`), so BOTH editors get it. flag-off it's an inert passthrough (paragraph/heading NodeViews render via toDOM; controller does nothing).
- Heavy NodeViews lazy-mount via `lazy-visible.ts` (IntersectionObserver). content-visibility:hidden keeps the DOM + observer box, so reveal-on-scroll still works (verify this in GUI — the "heavy block re-render on reveal" path is the untested risk).
- `__baramPerf` API (DEV, window): `inputLatency()`, `stalls()`, `longTasks()` (0 on WKWebView), `txBreakdown()` ({events, plugins, transactions}), `reset()`.
- SLOW TX warning (`perf-trace.ts`) fires for >100ms dispatches, now skipped for PROGRESSIVE_LOAD_META (load) chunks; the `plugins=` field shows which plugin's apply was expensive.

## Remaining productionization (after fold + flag confirm)

- **Settings kill-switch:** replace `window.__baramFlags.virtualize` with a real settings-store flag (`virtualizeLargeDocs`), default off → opt-in. Consider gating activation on large docs only (the keep-alive editor) so normal docs are untouched.
- **Containers (lists/blockquote):** a safe way to virtualize them (they broke with the generic NodeView). ~19% of the fixture.
- **export/print:** `src/utils/export/export-html.ts` clones live `editor.view.dom`. With always-on virtualization + content-visibility:hidden, the DOM content IS still present (content-visibility only skips rendering), so export likely works — but VERIFY (plan §12 AM-4 `withVirtualizationSuspended`).
- **click/nav to off-screen blocks:** clicking only hits visible blocks (fine); backlink/search nav does `setSelection` + `scrollIntoView` → scroll event → controller reveals the new window. Verify nav-to-far-block reveals correctly.
- **Open time (~2s) is a SEPARATE lever** (rendering all mermaid/table/katex at load), not addressed by virtualization.

## How to resume in the new session

```
cd /Users/donghoon.yoo/work/projects/baram
git log --oneline -1          # expect dc8ac52
git status --short            # expect only "?? CONTEXT.md"
npx vitest run                # expect 2460 passed | 6 skipped
npx tsc --noEmit              # clean
```

Then GUI (user runs `npm run tauri dev`, opens CONTEXT.md, DevTools console):
1. **Confirm flag-on perf** (blocker #1): `window.__baramFlags = { virtualize: true }` → scroll once → `__baramPerf.reset()` → type a long burst → `const t=__baramPerf.txBreakdown().transactions; console.log(t.totalMs/t.count)`. Note whether the ~120ms layout part is gone (flag-on) vs the fold ~40ms.
2. **Implement the fold CSS-arrow refactor** (blocker #2) to kill the ~40ms/keystroke, then re-measure.
3. Continue down the plugin long-tail (listAtomFix, block-id) as needed, then productionize (settings flag, containers).

## Conventions (unchanged)

- Commit msgs English, `§perf-large-file` tag + Cx.y, subject lowercase (commitlint rejects capitalized subjects). Conversational replies Korean.
- pre-commit: prettier --check + eslint --max-warnings=0 (perfectionist import/member sorting) — run `eslint --fix` / `prettier --write` and retry on failure.
- Vitest only (`npx vitest run`), never jest. `CONTEXT.md` (repo root, untracked, the perf fixture) — do NOT commit it.
- Keep doing tight self-driven edits + verify; OMC executor/sub-agents in this repo return empty final messages (extract via the agent's output transcript) — see [[feedback_executor_scope_overrun]].

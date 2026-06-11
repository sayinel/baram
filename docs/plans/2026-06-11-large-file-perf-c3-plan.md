# C3 Steady-State Large-Document Performance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With a large document open (fixture: CONTEXT.md, 3,594 top-level blocks), make the editor feel normal in steady state: tab switch to/from the document < 50 ms, keystroke latency p99 < 33 ms, scrolling without CodeMirror mount bursts, and the post-open fill window must never block user input > 50 ms.

**Architecture:** Four independent levers, ordered cheapest-first with a measurement gate after each: (C3.0) instrument the symptoms so every later task has a before/after number and the unexplained `editorStateCache` miss is root-caused; (C3b) replace per-keystroke whole-doc decoration rebuilds with mapped + changed-range-local updates; (C3c) serialize lazy CodeMirror mounts through the existing idle scheduler; (C3d) make progressive-load appends yield to user input; (C3a, largest) keep a dedicated always-mounted Editor instance for large documents and switch tabs by toggling visibility — zero DOM rebuild, undo history preserved.

**Tech Stack:** TypeScript, Tiptap/ProseMirror (DecorationSet.map, tr.mapping, PluginKey state), React 19, Zustand, Vitest.

**Design sources:**
- [`docs/impl-notes/large-file-perf-baseline.md`](../impl-notes/large-file-perf-baseline.md) — "Post-C2 GUI verification (2026-06-11)" (symptoms + gate decision)
- C2 plan: [`docs/plans/2026-06-10-large-file-perf-c2-plan.md`](2026-06-10-large-file-perf-c2-plan.md) (progressive-load machinery this plan builds on)

**Decision record (C3a strategy, user-approved 2026-06-11):** Hybrid DOM keep-alive was chosen over progressive cached restore. Rationale: a progressive cached restore loses undo history (the entire purpose of `editorStateCache`) and re-runs a multi-second fill on every return; DOM keep-alive costs memory (bounded: LRU cap 1 large editor) but makes switch cost ~0 and preserves editor state verbatim. Precedent: the app already runs two Editor instances in §89 standalone-file mode (`src/components/layout/FileEditorLayout.tsx:45-54`), so dual instances are not novel — but they have never coexisted in the SAME layout, which is why Task C3.4 (prerequisite isolation) exists.

---

## Background (measured/verified facts this plan relies on)

- **First open is solved (C2):** `updateState(first chunk) = 11 ms` (was 2025 ms). Remaining symptoms are steady-state. Source: baseline doc 2026-06-11 section.
- **Cached tab restore is a whole-DOM rebuild:** `src/hooks/use-tab-switching.ts:283-286` calls `editor.view.updateState(cachedState)` with the full doc synchronously; switching away likewise tears down the full DOM. C2 only made the *uncached* path progressive.
- **8 plugins walk the whole doc on docChanged** (explore report 2026-06-11):
  | Plugin | Local? | Incremental viable? | Blocker |
  |---|---|---|---|
  | `list-atom-fix.ts` (~83 lines) | yes | ✅ map-only sufficient | none |
  | `prompt-highlight.ts:40` | yes (stateless regex) | ✅ | none |
  | `prompt-lint.ts:107` | yes (stateless lint) | ✅ | none |
  | `find-replace.ts:188` | yes (stateless search) | ✅ | none |
  | `fold.ts` listItems (192-228) | yes (`hasNestedList` per item) | ✅ | none |
  | `fold.ts` headings (154-189) | no | ❌ | "next heading with level ≤" sibling scan |
  | `block-id-decoration.ts` | no | ❌ as-is | `isDuplicateBlockId()` (123-142) cross-block collision walk |
  | `writing-flow.ts` (72,79) | no | leave | already amortized (every 20 tx) |
- **Lazy CM mounts are unthrottled:** `code-block-node-view.ts:143` fires `ensureCM()` immediately on visibility; each mount = dynamic language import + synchronous `new CMView(...)` (~10-100 ms). One `IntersectionObserver` per element, `rootMargin: "200px 0px"` (`src/extensions/nodes/views/lazy-visible.ts`). ~296 code blocks in the fixture → scroll bursts.
- **Progressive append ignores input pressure:** `appendChunksProgressively` (`src/utils/editor/progressive-load.ts`) appends a fixed 150-block chunk per `scheduleIdle` tick; each chunk is ~85-300 ms of synchronous DOM work (~24 chunks for the fixture).
- **Dual-editor blockers (explore report 2026-06-11):**
  - Module-level mutable state shared across instances: `mermaidIdCounter` (`mermaid-block-view.tsx`), `_cachedDoc` + `_footnoteOrder` (`footnote-ref-view.tsx`), `cachedTagIndex`/`cacheTimestamp` (`tag-suggest.ts`), `lastSuggestionTime` (tag-suggest). KaTeX lazy singleton + PluginKeys are safe.
  - 13 global DOM queries that assume one editor: `.tiptap` (`use-settings-effects.ts:85`), `.editor-area-scroll` (`use-zoom.ts:29`, `use-tab-switching.ts:126,298`, others), `.tiptap.ProseMirror` (`BookmarkPanel.tsx:178`), `elementFromPoint` users (`use-external-drop.ts`, table coords, BlockHandle, TableToolbar).
  - Editor distribution: created in `App.tsx:218-234` (`useEditor`), handed to 13 hooks + 10 components via props/`EditorContext`; `<EditorContent>` is a bare child of `.editor-area-scroll` — two siblings with a display toggle are structurally plausible.
- **Unexplained:** the user's tab-return hit the uncached path (convert 1 ms log) when the cache should have been warm. Root cause unknown — C3.0 must instrument `editorStateCache` set/get/delete to resolve it before C3a work begins.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/utils/editor/perf-trace.ts` | `tracePhase()`, input-latency sampler, cache-event logger (dev-only, behind `import.meta.env.DEV`) | Create (C3.0) |
| `src/utils/editor/changed-ranges.ts` | `changedRanges(tr): {from,to}[]` from `tr.mapping.maps` + invert-mapped extents | Create (C3.1) |
| `src/utils/editor/__tests__/changed-ranges.test.ts` | unit tests | Create (C3.1) |
| `src/extensions/plugins/list-atom-fix.ts` | map-only on local edits; rebuild only changed ranges | Modify (C3.1) |
| `src/extensions/plugins/prompt-highlight.ts`, `prompt-lint.ts`, `find-replace.ts` | changed-range-local recompute | Modify (C3.1) |
| `src/extensions/plugins/block-id-decoration.ts` | incremental id-count Map (drop `isDuplicateBlockId` whole-doc walk) | Modify (C3.1) |
| `src/extensions/plugins/fold.ts` | listItems incremental; headings rebuild kept but memoized per-tx batch | Modify (C3.1) |
| `src/extensions/nodes/views/lazy-visible.ts` | shared IntersectionObserver + `mountQueue` (serialize via `scheduleIdle`) | Modify (C3.2) |
| `src/utils/editor/progressive-load.ts` | input-pressure deferral + adaptive chunk halving | Modify (C3.3) |
| `src/utils/editor/__tests__/progressive-load.test.ts` | extend for new scheduler behavior | Modify (C3.3) |
| `src/extensions/nodes/mermaid-block-view.tsx`, `footnote-ref-view.tsx`, `src/extensions/plugins/tag-suggest.ts` | per-editor state isolation (WeakMap keyed by editor/view) | Modify (C3.4) |
| 13 global-DOM-query sites (list in Background) | de-globalize: resolve via `editor.view.dom.closest("[data-editor-scroll]")` / props | Modify (C3.4) |
| `src/components/editor/LargeDocEditorHost.tsx` (or extend EditorArea) | persistent second `<EditorContent>` + visibility toggle + LRU lifecycle | Create (C3.5) |
| `src/hooks/use-large-doc-keepalive.ts` | threshold detection, editor pool (cap 1), routing in tab-switch | Create (C3.5) |
| `src/hooks/use-tab-switching.ts` | route large-doc tabs to keep-alive editor; skip cache/teardown for them | Modify (C3.5) |
| `docs/impl-notes/large-file-perf-baseline.md` | record all measurements | Modify (C3.0/C3.6) |

**Constants:** `LARGE_DOC_BLOCK_THRESHOLD = 500` (top-level blocks; tab uses keep-alive editor at/above it), `KEEPALIVE_LRU_CAP = 1`, `INPUT_QUIET_MS = 100`, `CHUNK_TIME_BUDGET_MS = 50`. All in one place (`src/utils/editor/perf-constants.ts` or colocated with their consumer — implementer's choice, but no magic numbers inline).

---

## Task C3.0: Instrumentation + cache-miss root cause (gate for everything else)

**Files:** create `src/utils/editor/perf-trace.ts`; touch `use-tab-switching.ts` (log points only); baseline doc.

- [ ] **Step 1:** Create `perf-trace.ts` (dev-only, no-ops in prod build):
  - `tracePhase(label, fn)` — wraps existing `timePhase` pattern, logs `[Baram Perf] <label>: X ms`.
  - Input-latency sampler: a `keydown` listener + `requestAnimationFrame` pair measuring event→paint time; ring buffer of last 200 samples; `window.__baramPerf.inputLatency()` returns `{p50, p99, max}`.
  - Long-task observer: `PerformanceObserver({type:"longtask"})` counting tasks > 50 ms; exposed via `window.__baramPerf.longTasks()`.
- [ ] **Step 2:** Add log lines (behind DEV) to `use-tab-switching.ts`: every `editorStateCache` `.set/.get(hit|miss)/.delete`, with tabId + doc.childCount; wrap the cached-branch `updateState` and outgoing teardown in `tracePhase("tabSwitch:restore"/"tabSwitch:teardown")`.
- [ ] **Step 3:** Unit-test what is testable (ring buffer math, no-op in non-DEV); do NOT fabricate jsdom tests for PerformanceObserver.
- [ ] **Step 4 (human):** `npm run tauri dev`, open CONTEXT.md, then: (a) type 20 chars mid-document, (b) scroll top→bottom, (c) switch away and back twice. Record: inputLatency p50/p99, longTask count during scroll, `tabSwitch:restore`/`teardown` ms, and the full cache event log.
- [ ] **Step 5:** From the cache log, root-cause the 2026-06-11 uncached tab-return (expected outcomes: tab close/reopen → working as designed; mid-fill switch → by-design reload; anything else → file a fix task before proceeding). Record verdict + all numbers in the baseline doc under "C3.0 measurements".
- [ ] **Step 6:** Commit `perf(§perf-large-file C3.0): add steady-state instrumentation`.

**Gate:** numbers exist for every later task's before/after; cache-miss verdict recorded.

## Task C3.1: incremental decoration maintenance (C3b — editing latency)

**Files:** create `changed-ranges.ts` (+test); modify the six plugins listed in File Structure.

- [ ] **Step 1 (TDD):** `changedRanges(tr)` — derive changed `{from,to}` ranges in the NEW doc from `tr.mapping.maps` (each StepMap's `forEach((oldStart,oldEnd,newStart,newEnd))`), merged when overlapping. Tests: single text insert → one small range; two steps → merged/separate as appropriate; no doc change → `[]`.
- [ ] **Step 2:** `list-atom-fix.ts` — on docChanged: `old.map(tr.mapping, tr.doc)`, then for each changed range, remove decos inside it and re-run the per-item check via `doc.nodesBetween(range)` only. Existing whole-doc build stays for the empty→nonempty init branch and the final progressive chunk.
- [ ] **Step 3:** `prompt-highlight.ts`, `prompt-lint.ts`, `find-replace.ts` — same pattern: map, then recompute matches only inside changed ranges (expand each range to enclosing textblock boundaries before regex/lint so patterns spanning the edit are caught). find-replace: a search-term change (its own plugin meta) still triggers full recompute — only docChanged-without-meta becomes incremental.
- [ ] **Step 4:** `block-id-decoration.ts` — replace `isDuplicateBlockId()`'s whole-doc walk with an id→count `Map` maintained in plugin state: built once on init/final-chunk, updated from changed ranges (decrement ids removed, increment ids added). Duplicate flag for an id = `count > 1`. Verify the focused/editing decoration logic (`focusedBlockPos`/`editingBlockPos`) still works — those are selection-driven, not doc-walk-driven.
- [ ] **Step 5:** `fold.ts` — listItems: incremental per changed range (`hasNestedList` is local). Headings: keep the sibling-structure rebuild BUT only when a changed range touches a heading node or a top-level boundary (check via `nodesBetween` over changed ranges for `heading` type); pure inline edits inside a paragraph skip it. Folded-range mapping (`foldedPositions`) keeps its existing logic.
- [ ] **Step 6:** Tests: for each modified plugin, add a regression test asserting decorations after an incremental edit equal a from-scratch rebuild on the same doc (property: `incremental(doc, edit) ≡ rebuild(apply(doc, edit))`) for: text insert, block insert, block delete, edit inside list item, heading level change (fold).
- [ ] **Step 7:** Run full suite + tsc. Commit `perf(§perf-large-file C3.1): incremental decoration maintenance on changed ranges`.
- [ ] **Step 8 (human gate):** re-measure inputLatency on CONTEXT.md; target p99 < 33 ms (stretch 16 ms per §8.4). Record in baseline doc.

## Task C3.2: scroll-burst CodeMirror mount throttling (C3c)

**Files:** `src/extensions/nodes/views/lazy-visible.ts` (+ its consumers stay unchanged — same API).

- [ ] **Step 1:** Refactor `onFirstVisible` to use ONE shared `IntersectionObserver` (module-level, lazily created) with an element→callback Map — drops ~296 observer instances.
- [ ] **Step 2:** Add a mount queue: when intersection fires, push the callback into a queue drained by `scheduleIdle` (reuse from `progressive-load.ts`), max ONE callback per tick. Elements still in viewport keep priority (drain order: most recently intersected first, so the block the user is looking at mounts before ones scrolled past).
- [ ] **Step 3:** Bypass the queue for direct interaction: `selectNode()`/`setSelection()` paths in `code-block-node-view.ts:196,207` already call `ensureCM()` directly — verify they skip the queue (clicking a placeholder must mount immediately).
- [ ] **Step 4:** Tests: extend the existing `MockIntersectionObserver` setup — N elements intersect in one burst → callbacks run one per scheduled tick (inject a manual scheduler), interaction bypass runs synchronously, disposer removes from queue.
- [ ] **Step 5:** Full suite + tsc. Commit `perf(§perf-large-file C3.2): serialize lazy CodeMirror mounts through idle queue`.
- [ ] **Step 6 (human gate):** scroll CONTEXT.md top→bottom; longTasks > 50 ms should drop vs C3.0 baseline; no visible blank-placeholder stalls (rootMargin 200px still prefetches). Record.

## Task C3.3: input-pressure-aware progressive fill (C3d)

**Files:** `progressive-load.ts` (+ existing test file).

- [ ] **Step 1:** Track last user input: module-level `notePressure()` wired from a `keydown`/`wheel`/`pointerdown` listener installed once by the appender while active (removed on completion/cancel).
- [ ] **Step 2:** In `step()`: if `now - lastInput < INPUT_QUIET_MS`, reschedule without appending (no chunk work while the user is actively typing/scrolling).
- [ ] **Step 3:** Adaptive chunk size: measure each append's wall time; if > `CHUNK_TIME_BUDGET_MS`, halve the next chunk (floor 25 blocks); if < budget/2, restore toward `REST_CHUNK_BLOCKS`. (Chunks array becomes a cursor over the flat block list instead of pre-split — refactor `appendChunksProgressively` to take `blocks: PMNode[]` + sizes; update C2 call site in `use-tab-switching.ts`.)
- [ ] **Step 4:** Tests (manual scheduler + fake clock via injected `now()` — Date.now is fine in src, just make it injectable for tests): input within quiet window defers; adaptive halving sequence; cancel still clean; completion still fires exactly once.
- [ ] **Step 5:** Full suite + tsc. Commit `perf(§perf-large-file C3.3): yield progressive fill to user input, adaptive chunk size`.
- [ ] **Step 6 (human gate):** open CONTEXT.md and type immediately during fill — no perceptible input stall; fill completes (verify doc end present). Record fill total time (acceptable to grow vs C2; responsiveness wins).

## Task C3.4: dual-editor prerequisites (state isolation + DOM query de-globalization)

Independently safe refactors — behavior must be identical with one editor. Do this BEFORE C3.5.

- [ ] **Step 1:** Isolate the six module-level mutable states per editor/view: `mermaidIdCounter` → per-view counter or `crypto.randomUUID()` suffix; `_cachedDoc`/`_footnoteOrder` (footnote-ref-view) → WeakMap keyed by the view's `editor` (or root doc node); `cachedTagIndex`/`cacheTimestamp`/`lastSuggestionTime` (tag-suggest) → WeakMap keyed by EditorView. PluginKeys/KaTeX singleton stay as-is (verified safe).
- [ ] **Step 2:** De-globalize the 13 DOM queries: each site resolves its container from the editor it already holds — `editor.view.dom.closest("[data-editor-scroll]")` for scroll containers; `editor.view.dom` instead of `.querySelector(".tiptap")`. Sites without an editor in scope (BookmarkPanel) get it from `EditorContext`. Full list in Background; verify each with the explore report's file:line.
- [ ] **Step 3:** Confirm `.editor-area-scroll` queries in `use-tab-switching.ts:126,298` and `use-zoom.ts:29` work when TWO scroll hosts exist (the active one is the one whose host is not `display:none` — add `[data-editor-active]` attr toggled by the layout, query scoped to it).
- [ ] **Step 4:** Tests where feasible (tag-suggest cache isolation: two mock views get independent caches; footnote order with two docs). Full suite + tsc — zero behavior change expected.
- [ ] **Step 5:** Commit `refactor(§perf-large-file C3.4): isolate per-editor state and scope DOM queries for dual-editor support`.

## Task C3.5: hybrid DOM keep-alive for large documents (C3a)

**Files:** create `LargeDocEditorHost` + `use-large-doc-keepalive.ts`; modify `use-tab-switching.ts`, EditorArea layout, `App.tsx` wiring.

- [ ] **Step 1 (read first):** Read `App.tsx:218-234` (editor creation + hook wiring) and the EditorArea JSX around `<EditorContent>`; confirm overlay components (FloatingToolbar, BlockHandle, …) receive `editor` by prop.
- [ ] **Step 2:** `use-large-doc-keepalive.ts`: owns a pool (cap `KEEPALIVE_LRU_CAP = 1`) of `{tabId, editor}`; `isLargeDoc = doc.childCount ≥ LARGE_DOC_BLOCK_THRESHOLD` decided when a load completes (C2 `finishLoad` knows the final childCount); acquiring a slot beyond cap destroys the LRU editor (full teardown is acceptable — it happens on eviction, not on every switch); tab close destroys its keep-alive editor (hook into the same path that calls `clearOriginalDoc`).
- [ ] **Step 3:** Layout: render the keep-alive `<EditorContent>` as a sibling of the shared one inside the scroll area; exactly one visible (`display` toggle + `[data-editor-active]`). Overlays render against the ACTIVE editor (lift "activeEditor" selection to the layout: `const activeEditor = keepAlive.activeFor(activeTabId) ?? sharedEditor`).
- [ ] **Step 4:** `use-tab-switching.ts` routing: for a tab with a keep-alive editor — switching TO it: toggle visibility, restore scroll (scrollTopCache still applies), NO updateState, NO progressive load; switching AWAY: toggle only — no editorStateCache write, no `prosemirrorToMarkdown` outgoing save (the live editor IS the state; auto-save/dirty continue running against it via its own hooks). First open of a doc that turns out large: progressive-load into the SHARED editor as today, then at `finishLoad` if `childCount ≥ threshold` → promote: move the EditorState into a freshly created keep-alive editor via one `updateState` (one-time cost, already paid in the open flow) — or simpler: create the keep-alive editor up front when `chunkBlocks` reports total ≥ threshold and load progressively directly into it. Implementer picks the simpler-to-verify variant and states which.
- [ ] **Step 5:** Hooks audit: `use-auto-save`, `use-editor-effects`, ghost text, find-replace must operate on the ACTIVE editor. Where hooks take `editor` as a param from App.tsx, pass `activeEditor`. Verify hooks re-bind correctly when activeEditor identity changes (deps arrays).
- [ ] **Step 6:** Source-mode interaction (gap found in plan review): `use-source-mode.ts` swaps to a whole-file CodeMirror editor and, on toggle-back, rebuilds the FULL PM doc + `updateState` — for a keep-alive tab this (a) must target the keep-alive editor, not the shared one, and (b) reintroduces the 2 s whole-DOM rebuild through this path. Handle both: route the toggle against `activeEditor`, and on source→WYSIWYG for a doc ≥ threshold, load via the C2 progressive path into the keep-alive editor (cursor mapping via the existing `cursor-mapper` flow is deferred to `finishLoad`, same as fold restore). Verify toggle round-trip on CONTEXT.md in C3.6.
- [ ] **Step 7:** Memory guard: on keep-alive creation log `[Baram Perf] keepalive: +1 editor (N blocks)`; eviction logs too. Settings escape hatch NOT included (YAGNI) — threshold constant only.
- [ ] **Step 8:** Tests: keep-alive pool unit tests (threshold, LRU eviction destroys, close destroys); routing decision function extracted pure and tested (`resolveTabEditor(tab, pool) → "shared" | "keepalive"`). Hook-level mounting stays out of scope (jsdom impractical — same rationale as C2.4, do not fabricate).
- [ ] **Step 9:** Full suite + tsc. Commit `perf(§perf-large-file C3.5): keep large-document editor DOM alive across tab switches`.

## Task C3.6: GUI verification + baseline update (human-run)

- [ ] **Step 1 (human):** With CONTEXT.md open: tab switch away/back ×5 — `tabSwitch` traces < 50 ms, content instant, undo history survives (make an edit, switch away/back, Cmd+Z undoes it).
- [ ] **Step 2 (human):** Keystroke p50/p99 via `__baramPerf.inputLatency()` after 50 keystrokes mid-doc — p99 < 33 ms.
- [ ] **Step 3 (human):** Scroll top→bottom: longTasks count vs C3.0 baseline; code blocks mount progressively without freezes.
- [ ] **Step 4 (human):** Open during fill: type immediately — responsive; switch away mid-fill and back — no truncated content, no false dirty.
- [ ] **Step 5 (human):** Memory: macOS Activity Monitor / Tauri devtools heap with CONTEXT.md kept alive + 3 small tabs — record; flag if idle > 150 MB.
- [ ] **Step 6:** Record all numbers in baseline doc "Post-C3 GUI verification"; PASS/FAIL per acceptance criterion. Commit `docs(§perf-large-file C3): record steady-state verification`.

---

## Acceptance Criteria (testable)

1. Tab switch to/from a kept-alive large doc: `tabSwitch` trace < 50 ms (was ~2,000 ms class). Undo history preserved across switches.
2. Keystroke latency in CONTEXT.md: p99 < 33 ms over 50 mid-document keystrokes (stretch: 16 ms per §8.4).
3. Scroll top→bottom of CONTEXT.md: zero blank-stall > 100 ms; long tasks (> 50 ms) reduced vs C3.0 baseline by ≥ 50%.
4. Typing within 100 ms of an in-flight append defers the append (unit-tested) and no input stall is perceptible (human-verified).
5. `editorStateCache` miss of 2026-06-11 root-caused with a recorded verdict (C3.0).
6. Full vitest suite green (2374+), tsc clean, after every task. Roundtrip preservation untouched (no pipeline changes in this plan).
7. Idle memory with one kept-alive large doc < 150 MB (recorded; if exceeded, follow-up to lower `KEEPALIVE_LRU_CAP` block threshold or add settings control).

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Incremental decoration drift (incremental ≠ rebuild) | Property tests in C3.1 Step 6 compare incremental output to from-scratch rebuild per edit type; any mismatch fails CI. |
| Dual-editor leaks shared mutable state in an extension we missed | C3.4 grep is exhaustive per explore report; C3.6 Step 1 includes footnote/mermaid/tag behaviors in BOTH editors. If a conflict appears, the keep-alive feature is behind one routing function — trivially disabled by returning "shared". |
| Hooks misbind when activeEditor identity changes | C3.5 Step 5 audits dep arrays; symptoms (auto-save against wrong editor) are caught by the false-dirty / save checks in C3.6 Step 4. |
| Memory blowup from kept-alive DOM | LRU cap 1, eviction destroys, measurement in C3.6 Step 5 with a hard flag threshold. |
| Mount queue starves a code block the user clicked | Interaction bypass (C3.2 Step 3) mounts synchronously on select/focus. |
| Source-mode toggle on a keep-alive tab rebuilds whole DOM / targets wrong editor | C3.5 Step 6 routes the toggle to `activeEditor` and reuses the C2 progressive path on toggle-back; round-trip verified on the fixture in C3.6. |
| Adaptive chunking interacts badly with C2 cancel paths | C3.3 reuses the same handle/cancel contract; existing C2 cancel tests must stay green; new tests cover cancel mid-adaptive-sequence. |

## Verification Steps (per task + final)

- After every task: `npm test` (full), `npx tsc --noEmit`.
- Human measurement gates: C3.0 Step 4-5, C3.1 Step 8, C3.2 Step 6, C3.3 Step 6, C3.6 (full pass).
- Final: baseline doc updated with before/after table for all four symptoms.

## Self-Review

- Every symptom from the 2026-06-11 verification maps to a task: tab switch → C3.5, editing → C3.1, scroll → C3.2, post-open window → C3.3, cache mystery → C3.0. ✓
- Order is risk-ascending with measurement gates; the largest change (C3.5) has its prerequisites isolated in C3.4 so it can be deferred/dropped without losing C3.1-C3.3 wins. ✓
- All claims above cite file:line from this session's verified reads or the two explore reports (2026-06-11). The three plugins NOT made incremental (fold.headings full case, writing-flow, ghost-link) have explicit reasons (sibling scan / amortized / dictionary-scoped) — revisit only if C3.1's gate measurement misses target. ✓
- No TBDs. The single deliberately-open implementation choice (C3.5 Step 4 promote-vs-direct-load) is bounded with a "state which" requirement. ✓

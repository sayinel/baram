# Large-File Perf — Phase 0 Baseline

> Fixture: `CONTEXT.md` (~21,309 lines, ~296 code blocks, ~4,368 table rows)
> Measured: 2026-06-09

## Measurements

| Phase | CONTEXT.md (~21k) | Source | Status |
|-------|-------------------|--------|--------|
| App ready (warm) | **209 ms** | app `[Baram Perf] App ready` | ✅ measured |
| parse (Worker, md→mdast) | **~832–853 ms** | vitest `perf-benchmark.test.ts` split timing | ✅ measured (off main thread) |
| convert (mdast→PM, main) | **~10 ms (vitest) / 30 ms (app, full schema)** | vitest split + app `[Baram Perf] convert` | ✅ measured — trivial |
| **updateState (DOM create)** | **2025 ms** ← THE FREEZE | app `[Baram Perf] updateState(DOM)`, WITH Phase 1 (lazy CM + content-visibility) applied | ✅ measured |
| Scroll FPS (after Phase 1) | (pending user confirm) | observation | ⏳ |
| Tab switch (cached) | (pending) | observation | ⏳ |

Block count produced by convert: **3,594** top-level blocks.

### How to capture the pending (GUI) numbers

1. `npm run tauri dev`, open `CONTEXT.md`, open the WebView devtools console.
2. Read the logged lines:
   - `[Baram Perf] convert(mdast→PM): X ms` (should confirm ~10ms)
   - `[Baram Perf] updateState(DOM): Y ms` ← the key number (DOM + 296 CodeMirror mounts)
3. To isolate CodeMirror cost: temporarily comment out `this.initCM(lang);` at `src/extensions/nodes/views/code-block-node-view.ts:133`, re-open, record the new `updateState(DOM)` value; the delta ≈ CodeMirror-init cost. **Revert before Phase 1b.**
4. Scroll FPS: DevTools Performance panel (or rendering FPS meter) while scrolling top→bottom.
5. Tab switch: open a second large tab, switch back and forth, eyeball/log the delay.

## Gate decisions

- **Dominant JS cost:** `parse` (832ms) dwarfs `convert` (10ms). BUT `parse` already runs in a **Web Worker** (B1) — it does **not** block the main thread / freeze the UI. `convert` is on the main thread but is trivial (~10ms).
  - ⇒ The open **freeze** the user reports is almost certainly **NOT** main-thread JS conversion. It is `updateState` (DOM creation) + ~296 CodeMirror instantiations. Confirm with the pending GUI `updateState(DOM)` number.

- **Phase 2 (async conversion) needed?** → **Strong preliminary: NO.** convert=10ms means chunk+yield / Worker-fromJSON would buy ~10ms. Phase 2 is very likely droppable. Re-confirm after Phase 1 GUI re-measure. (If GUI shows convert ≫ benchmark due to the full 47-extension schema, revisit.)

- **Phase 2 technique (chunk+yield vs Worker fromJSON):** N/A unless the above flips.

- **20k `T_settled < 1s` (C2 escalation)?** → Decide after the GUI `updateState(DOM)` floor is known.
  - Note: even though `parse` is off-main-thread, its **832ms wall-clock** alone nearly consumes a 1s `T_interactive` budget for 20k lines. If `T_interactive < 1s` proves hard after Phase 1, a streaming/chunked **parse** (not convert) becomes the relevant lever — a different Phase 2 framing than the design doc assumed. Record GUI wall-clock to first-paint to judge.

## Post-Phase-1 GUI measurement (2026-06-10) — DECISIVE

Measured on `feature/large-file-perf` (Phase 1 fully applied): **`updateState(DOM) = 2025 ms`**.

- `convert = 30 ms` ⇒ original **"Phase 2 = async conversion" is confirmed UNNECESSARY** (convert is trivial).
- The 2025 ms is **synchronous whole-document DOM materialization** inside `editor.view.updateState` — ProseMirror building DOM for ~21k lines at once (4,368 table rows + all paragraphs/lists + 296 code-block chrome with ~25-option `<select>`s). convert (the PM node tree) is 30 ms; updateState is ~67× that — the gap is pure DOM creation/reconcile.
- **Phase 1 did NOT reduce this number** and could not: `content-visibility` skips off-screen *paint/layout* (helps scroll), `lazy CodeMirror` avoids the off-screen CM-view storm (memory + post-open jank). Neither shrinks the one-shot DOM build.
- Heavy decoration plugins ruled out as load-time cost: `syntax-reveal` returns `DecorationSet.empty` when nothing is expanded (cursor-local, not whole-doc); `block-id-decoration` / `list-atom-fix` defer to first transaction.

### Gate decision (now resolved)
- **20k `T_settled < 1s` and `T_freeze < 100ms` are NOT achievable with Phase 1 alone.** The DOM-materialization floor is ~2s.
- ⇒ **C2 escalation triggered:** the only fix for the open freeze is **progressive / windowed document rendering** — render the first viewport immediately (small, fast `updateState`), then append the remaining blocks in async chunks after first paint (the `mdastBlocksToPmNodes` "progressive loading" C2 helper already exists for this). Higher-risk than the original medium-risk scope; requires user opt-in.
- Smaller complementary wins (defer code-block header chrome ~hundreds of ms; A2 prompt-highlight/lint Skills guards) do NOT reach the target alone and become marginal once C2 bounds the per-chunk DOM.

### What Phase 1 delivered (not wasted)
- Scroll/tab stutter (the second reported symptom): targeted by content-visibility — **pending user confirmation of scroll feel**.
- Off-screen CodeMirror memory/jank storm: eliminated by lazy CM (296 → only-visible instances).

## Post-C2 GUI verification (2026-06-11)

Measured on `feature/large-file-perf` with C2 progressive rendering applied (commits 23bfd15..ec8d85e). Fixture: CONTEXT.md (3,594 top-level blocks).

| Check | Result | Status |
|-------|--------|--------|
| convert(mdast→PM), first open | 33 ms | ✅ |
| **updateState(first chunk), first open** | **11 ms** (was 2025 ms) | ✅ target < 100ms |
| False dirty marker after open | none | ✅ |
| Steady-state scroll while doc open | sluggish | ❌ |
| Editing latency while doc open | sluggish | ❌ |
| Tab switch away/back | slow; return ran the UNCACHED path (convert 1 ms, updateState(first chunk) 173 ms) | ❌ |

### Analysis

- **C2 goal achieved:** the open freeze is eliminated — first paint dropped 2025 ms → 11 ms (~184×).
- **Remaining bottlenecks are steady-state, not open-time:**
  1. **Cached tab-switch is still a whole-DOM rebuild.** The cached-state restore path (`use-tab-switching.ts` cached branch) calls `editor.view.updateState(cachedState)` with the FULL 3,594-block doc — the same ~2 s-class synchronous DOM materialization C2 removed from the open path. Switching AWAY from the large doc also tears down the whole DOM synchronously. C2 only made the *uncached* path progressive.
  2. **Per-edit whole-doc plugin passes.** `block-id-decoration` (collectBlockIdEntries), `list-atom-fix`, and `fold` each walk the entire doc on every `docChanged` transaction during normal editing (the C2 gating applies only while the progressive-load meta is set). 3 × O(3,594 blocks) per keystroke.
  3. **Scroll-triggered lazy CodeMirror mounts.** ~296 code blocks instantiate CM on first visibility; fast scrolling mounts them in bursts.
  4. **Append window cost.** ~24 rest-chunks × ~85–300 ms synchronous DOM work each — the UI is degraded for several seconds after open while chunks fill in.
- **Regression found & fixed during verification:** the unmount cleanup added in ec8d85e cleared the per-tab loading flag *before* the next effect's outgoing-save guard read it (React runs old cleanup → new effect body), defeating the partial-doc save guard from f2cf188. Fixed by keeping the flag through cleanup.
- **Open question (needs instrumentation):** the user's tab-return hit the uncached path even though the load should have completed — either the tab was closed/reopened, the return happened mid-append (by-design reload), or an unidentified cache invalidation. Add set/get logging to `editorStateCache` in C3 measurement.

### Gate decision

- **C2 is complete and shippable for its scope** (open-path freeze). The remaining symptoms define a **C3 scope: steady-state large-doc performance** —
  - C3a: progressive (or DOM-preserving) **cached** tab restore + cheap teardown,
  - C3b: incremental decoration maintenance (replace whole-doc rebuilds with mapped + local updates),
  - C3c: scroll-burst CM mount throttling/pooling,
  - C3d: bound the post-open append window (bigger idle budget per tick or smaller chunks under input pressure).

## C3.0 measurements (2026-06-11, post-047bfa0)

Fixture: CONTEXT.md (3,531 blocks at measure time). All numbers from `__baramPerf` / `[Baram Perf]` logs in `npm run tauri dev` (WKWebView).

| Metric | Value | Note |
|---|---|---|
| Input latency (27 mid-doc keystrokes) | **p50 700 ms / p99 1378 ms / max 1378 ms** | target p99 < 33 ms → **~40× over** — dominant symptom |
| Scroll longTasks | count 0 | **WKWebView does not support `longtask` PerformanceObserver** — metric unusable on this platform; replace with rAF-gap stall detector (C3.2 Step 0) |
| Tab switch away (large→small) | serializeOutgoing **217 ms** + restore(9 blocks) **398 ms** | restore cost dominated by tearing down 3,531-block DOM |
| Tab switch back (small→large, cache HIT) | restore **1956 ms** | confirms C3a: cached restore = whole-DOM rebuild |
| editorStateCache | set/hit both directions ✓ | **2026-06-11 miss mystery RESOLVED**: not reproducible after the 0a424fd cleanup-ordering fix; attributed to that regression (or tab close/reopen). No further action. |

### C3.0 gate verdicts
- Cache-miss root cause: **closed** (see above).
- Before-numbers captured for C3.1 (input latency) and C3.5 (tabSwitch:restore 1956 ms / 398 ms, serializeOutgoing 217 ms).
- Scroll before-number NOT capturable via longtask on WKWebView → C3.2 must first add a rAF-gap stall metric (frames > 50 ms while scrolling), then capture before/after within C3.2's own gate.

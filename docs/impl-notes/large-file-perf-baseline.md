# Large-File Perf — Phase 0 Baseline

> Fixture: `CONTEXT.md` (~21,309 lines, ~296 code blocks, ~4,368 table rows)
> Measured: 2026-06-09

## Measurements

| Phase | CONTEXT.md (~21k) | Source | Status |
|-------|-------------------|--------|--------|
| parse (Worker, md→mdast) | **~832–853 ms** | vitest `perf-benchmark.test.ts` split timing | ✅ measured |
| convert (mdast→PM, main) | **~10–13 ms** | vitest split timing | ✅ measured |
| updateState (DOM create) | __ ms | app `[Baram Perf] updateState(DOM)` | ⏳ pending GUI |
| CodeMirror init (296×) | __ ms | delta of updateState w/ `initCM` disabled | ⏳ pending GUI |
| Scroll FPS (before fix) | __ | DevTools / observation | ⏳ pending GUI |
| Tab switch (cached) | __ ms | observation | ⏳ pending GUI |

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

## Implication for the plan

Phase 1 (content-visibility C1 + lazy CodeMirror/Mermaid 1b) is confirmed as the **primary** lever for the reported freeze + scroll/tab stutter. Phase 2 (async convert) is downgraded to "likely unnecessary, pending GUI confirmation."

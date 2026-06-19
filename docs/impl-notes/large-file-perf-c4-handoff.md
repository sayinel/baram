# C4 Large-File Perf (Block Virtualization) — Session Handoff (2026-06-15)

> Resume point for a fresh session. Branch: `feature/large-file-perf`.
> Plan: [`docs/plans/2026-06-13-large-file-perf-c4-virtualization-plan.md`](../plans/2026-06-13-large-file-perf-c4-virtualization-plan.md).
> Prior handoff (C3, truncation): [`large-file-perf-c3-handoff.md`](large-file-perf-c3-handoff.md).
> Goal the user wants: **Obsidian-level** large-file editing (CONTEXT.md ≈ 3,500 top-level blocks / ~21k lines) — typing/scroll/click/math-edit all "real-time", no bottleneck.

---

## TL;DR — where we are (updated 2026-06-19, current HEAD)

- The **truncation bug is fixed and shipped** (`d0d655b`, GUI-confirmed) — large files fully open.
- **This session's shipped, GUI-confirmed wins (all on the flag-OFF DEFAULT path):**
  - fold heading arrows → CSS pseudo-element (per-keystroke fold cost 40ms → 0.29ms) (`4bbd54c`, `117b6dd`).
  - auto-save per-keystroke whole-doc `doc.eq()` → O(1) `content.size` guard (`3d0b67b`).
  - a SECOND per-keystroke `doc.eq()` hiding in virtualize `view.update` → O(1) ref check (`c76cc6a`).
  - Outline per-keystroke whole-doc `extractHeadings` → 200ms debounced (`d7c56a4`).
- **Block virtualization (content-visibility) is REMOVED** (`3da17a5`). It was proven a DEAD END: a controlled bench showed content-visibility does NOT reduce typing cost (170ms → 178ms), only `display:none` does (→ 6ms). The bottleneck is **box-level FLOW layout of all ~3,264 top-level boxes** that PM forces every transaction; content-visibility keeps boxes in flow so it can't help. The `viewport-virtualize.ts` extension + DEV flag are gone (no inert NodeView wrappers on the default path).
- **The real remaining lever (NOT YET BUILT — separate future task): true windowing** = `display:none` off-screen blocks + `.tiptap::before/::after` pseudo-element spacers (`--vtop`/`--vbot`) to preserve scroll height. Validated design + rationale in the "UPDATE 2026-06-19b" section below. This is the only thing that can take the ~150ms typing floor toward single digits.
- **`window.__baramEditor`** (DEV-only) is still exposed for perf experiments (the synthetic dispatch bench).

### Net effect this session
The flag-OFF default path lost all per-keystroke whole-doc JS work (fold map, two doc.eq walks, Outline walk). The residual ~150ms typing floor on the 3,500-block fixture is browser box-flow layout, addressable only by the windowing engine above — deliberately deferred as its own task.

## UPDATE 2026-06-16 (GUI-confirmed — START HERE)

Three fixes shipped this session, each GUI-validated where possible:

1. **fold ~40ms/keystroke → CONFIRMED FIXED** (`4bbd54c`). GUI `txBreakdown`: `fold$` now **0.29ms avg** (was ~40ms). Heading arrows are CSS pseudo-elements; fold's DecorationSet is empty when nothing is folded (unit test locks this in). Folding works in the GUI.
2. **heading fold gutter click → FIXED** (`117b6dd`). The first cut used `posAtCoords`/`getBoundingClientRect`, which break under `.editor-area-scroll`'s CSS `zoom` ([[wkwebview-css-zoom-coords]]) — the gutter did nothing. Now coordinate-free: `pointer-events:auto` pseudo → `event.target` = heading, gutter detected via `event.offsetX < 0` (sign is zoom-invariant), position via `posAtDOM`. User confirms folding works.
3. **The per-keystroke whole-doc `doc.eq()` floor → CONFIRMED FIXED** (`3d0b67b`). GUI `inputLatency` p50 was **152ms (flag ON) vs 153ms (OFF)** — flag-independent ⇒ the cost was JS, not DOM. `txBreakdown` proved plugins ~0.7ms/tx. Root cause: the auto-save `update` listener → `shouldSkipDirty()` → `original.eq(currentDoc)` (ProseMirror `Node.eq` = deep walk of the whole ~3,500-block doc) EVERY keystroke. Fixed with an O(1) `content.size` pre-check (behaviour-identical). **GUI-confirmed:** post-fix `events` shows the `update` listener at **11ms total / 129 calls** (was the dominant floor).

4. **Block virtualization (flag ON) — TRIED, REVERTED, NOT VIABLE AS-IS** (`8d881e3` then reverted by `0c6541d`). GUI revealed `hidden(cv)=0` over 3,629 blocks with the flag ON — virtualization had **never actually engaged on the large keep-alive editor**, because the controller resolved its scroll container once in `start()` while that editor's DOM was still DETACHED (registers NodeViews before `<EditorContent>` mounts) → `scroller` null forever → `evaluate()` early-returned. `8d881e3` made it resolve lazily (`ensureScroller`) so it engaged for the FIRST time — and the app became unusable (scroll + typing both froze; user couldn't test). So the always-on content-visibility design does not survive contact with the real large doc: toggling content-visibility across thousands of blocks, compounded by the editor's CSS `zoom` breaking the `offsetTop`/`scrollTop` band math and `contain-intrinsic-size` (→ scrollHeight feedback), thrashes. **Reverted to keep the DEV flag a harmless no-op.** All the handoff's earlier "26ms always-on / smoother scroll" numbers were therefore NOT the large doc — they were the shared editor (small docs), where the scroller resolves normally.

**KEY LESSON:** on a large doc, a flag-independent typing floor (ON≈OFF) means the cost is JS in a per-keystroke listener, NOT DOM layout — virtualization can't help it. Audit every `editor.on("update"|"transaction", …)` for whole-doc work.

5. **Per-keystroke whole-doc audit — COMPLETE.** Every always-on `editor.on("update"|"transaction")` / `useEditorState` was checked for work that scales with doc size:
   - `use-auto-save` `doc.eq()` → FIXED (`3d0b67b`).
   - **Outline** `useEditorState`→`extractHeadings` (whole-doc `descendants`, ran every tx incl. selection/cursor moves when the panel is open) → FIXED (`d7c56a4`): switched to a 200ms-debounced `editor.on("update")` (the TOC-view idiom).
   - All others are bounded or safe: `use-ghost-text` (debounced, current-paragraph `textBetween` only), `use-inline-ai`/`use-editor-effects` (selection-range `textBetween`), `math-block-view` (shared-cached number → O(n) once/tx), `table-of-contents-view` (200ms debounced), `FileEditorLayout` dirty handler (O(1), and it's the §89 single-file path, not the CONTEXT.md tab). `prosemirrorToMarkdown(editor.state.doc)` (O(doc) full serialize) only runs on debounced save / explicit save / tab-switch / source-toggle — never per keystroke.
   - ⇒ **After `3d0b67b`+`d7c56a4` there is NO remaining JS per-keystroke whole-doc work in the hook/component layer.**

6. **A SECOND hidden per-keystroke `doc.eq()` — inside `view.dispatch`** (`c76cc6a`). The flag-OFF re-measure still showed **p50 150ms with PM dispatch the dominant cost** (`transactions` avg ~218ms/tx — inside `view.dispatch`, NOT browser layout). Since plugin `.apply` was ~0.7ms and the `update` emit 11ms, the cost was hiding in a plugin **`view().update()`** (which runs inside `view.dispatch`, and is NOT captured by the `field.apply` instrumentation). Culprit: `viewport-virtualize`'s `view.update()` ran `!view.state.doc.eq(prevState.doc)` — a deep whole-doc compare — on EVERY tx, even flag-OFF (always registered). Replaced with the O(1) reference check `view.state.doc !== prevState.doc` (the idiom `syntax-reveal.ts:590` already uses).

7. **`appendTransaction` audit (instrumentation blind-spot) — CLEAN.** `appendTransaction` is a separate plugin hook NOT captured by the per-plugin `field.apply` timing. Checked all four: `writing-flow` (whole-doc `descendants` but guarded `childCount > 1000` → skipped on CONTEXT.md), `table-col-resize` (whole-doc walk but guarded `if (!hasResizeMeta) return null` → only during a column drag), `image` (`findImagePos` is a click-handler helper with early-exit, not per-tx), `syntax-reveal` (cursor-bounded `textBetween`/`slice` only). None walk the whole doc per keystroke.
   - ⇒ **The per-keystroke whole-doc audit is now COMPLETE across hooks, components, plugin `.apply`, plugin `view().update()`, and `appendTransaction`.** If a residual typing cost remains on flag-OFF after `c76cc6a`, it is genuinely PM DOM reconcile + browser layout/paint of the large contenteditable — the thing only a *viable* virtualization could cut.

**NET RESULT THIS SESSION:** the DEFAULT (flag-OFF) typing path is materially better — fold (40ms→0.29ms), the auto-save `doc.eq()` floor removed, and the Outline per-keystroke walk removed. Virtualization is parked: it needs a redesign before re-enabling.

**NEXT (start here) — ONE decisive measurement:**
1. **Quantify the default win + locate the residual.** Flag **OFF** was never re-measured after `3d0b67b`/`d7c56a4`. Close the Outline panel, open CONTEXT.md, then:
   ```js
   window.__baramFlags = {};          // flag OFF (shipping path)
   __baramPerf.reset();
   // type 30+ chars in a paragraph
   console.log("OFF p50:", JSON.stringify(__baramPerf.inputLatency()));
   const t = __baramPerf.txBreakdown().transactions;
   console.log("PM dispatch avg ms/tx:", (t.totalMs / t.count).toFixed(1), JSON.stringify(t));
   ```
   - `inputLatency.p50` = total keydown→paint. `transactions.totalMs/count` = PM dispatch only (state apply + DOM reconcile). The GAP between them = pure browser layout/paint.
   - **If p50 dropped to tens of ms:** done — the JS floors WERE the problem; ship flag-OFF, virtualization unneeded.
   - **If p50 is still ~150ms but PM-dispatch is small:** the wall is browser layout of the 3,629-block contenteditable → the ONLY remaining lever is a viable virtualization redesign (see below).

   **2026-06-18 update:** the 2nd flag-OFF re-measure (after `3d0b67b`, before `c76cc6a`) gave **p50 150ms, PM-dispatch avg 218ms/tx** — so PM-dispatch was STILL dominant, which led to finding & fixing the virtualize `view.update` `doc.eq()` (`c76cc6a`). **Re-measure AGAIN with `c76cc6a` in.** Watch `transactions.totalMs/count` specifically: if it falls from ~218ms toward single digits, dispatch was the doc.eq and the p50 should follow down. If PM-dispatch stays high, the cost is PM's own DOM reconcile/layout → virtualization redesign. (Note: the 218ms *average* is inflated by `maxMs 1262` load outliers; prefer the p50 of `inputLatency` and, if possible, eyeball the per-tx values during a steady burst.)
2. **Virtualization redesign (only if the OFF p50 is still too high to hit the <16ms goal):** the content-visibility-on-every-block approach is the wrong primitive here. Options to evaluate: (a) TRUE windowing — render only viewport blocks into the DOM, replace off-screen ranges with sized spacers (react-virtual-style), but this fights ProseMirror's single-doc DOM model (see plan §"rejected: segmented editors"); (b) make all virtualization measurements zoom-normalized (divide offset/scroll by `--editor-zoom`) AND switch `evaluateAll` from O(all-blocks)/frame to an incremental boundary walk (only toggle blocks entering/leaving the band); (c) drop CSS `zoom` for the editor in favour of `transform: scale` or font-size scaling so layout coords stay consistent. Each is substantial — do it as its own plan, and keep the flag OFF-by-default until a GUI burst proves scroll+typing stay smooth.

## UPDATE 2026-06-18b — fold-all test refuted the naive layout hypothesis; need a clean windowing probe

After `c76cc6a` (both `doc.eq`s gone, Outline debounced), flag-OFF typing p50 was STILL ~152–232ms and unmoved by any JS fix — pointing at DOM cost. To test "is it the rendered block count?", we ran a fold-all (which `display:none`s most blocks): rendered dropped **3636 → 108**, but typing got **WORSE: p50 232 → 1231ms** (p99 26841ms). So reducing rendered DOM did NOT help.

**BUT the fold-all test is contaminated:** folding ~1,391 headings makes `fold.ts buildDecorations` emit a `fold-hidden` node decoration for every child in every fold range + an ellipsis widget per heading → a huge folded `DecorationSet` that `fold.apply` maps every keystroke. The 1231ms is that fold-decoration cost, not "small DOM is slow". (Aside: this is a real separate issue — folding a huge doc is itself expensive — but not the current target.)

**So the layout-vs-not question is still OPEN** and needs a contamination-free probe. Two things plague the data: (1) fold decorations when folded, (2) huge measurement noise (p99 in the tens of seconds = GC/load spikes). The fix for both: a **synthetic dispatch benchmark** that removes human/keydown variance and fold, measuring `view.dispatch` median directly, full-DOM vs a manually `display:none`-windowed DOM (no fold, no controller):

```js
const ed = __baramEditor;
function bench(label, n = 50) {
  ed.commands.focus();
  ed.commands.setTextSelection(3);                       // inside the first block
  for (let i = 0; i < 5; i++)                             // warmup
    ed.view.dispatch(ed.state.tr.insertText("x", ed.state.selection.from));
  const t = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    ed.view.dispatch(ed.state.tr.insertText("x", ed.state.selection.from));
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  console.log(label, "median ms:", t[n >> 1].toFixed(1), "p90:", t[Math.floor(n * 0.9)].toFixed(1));
}
bench("FULL DOM");
const blocks = [...document.querySelectorAll('.editor-area-scroll .tiptap > *')];
blocks.forEach((b, i) => { if (i > 60) b.style.display = 'none'; });  // window to first ~60, no fold deco
bench("WINDOWED 60");
blocks.forEach((b) => { b.style.display = ''; });                     // restore
```
- **WINDOWED median ≪ FULL median** (e.g. 140→15ms) ⇒ `view.dispatch`/`updateState` cost IS driven by rendered DOM size ⇒ a clean windowing virtualization (`display:none`/unmount off-screen, NOT content-visibility, NOT fold) is the fix. Redesign it: hide off-screen top-level blocks with `display:none` + a sized spacer, toggled incrementally (only blocks crossing the band), zoom-normalized, no per-frame O(all) `evaluateAll`.
- **WINDOWED ≈ FULL** ⇒ dispatch cost is NOT DOM-size-driven ⇒ the floor is per-keystroke browser input/observer cost or a doc-spanning DecorationSet's VIEW reconciliation (block-id/list-atom-fix/prompt-highlight/syntax-reveal widgets across the whole doc, reconciled in `updateState` — the instrumentation blind spot). Next probe would disable those plugins one at a time.

## UPDATE 2026-06-18c — DECISIVE: typing cost scales with RENDERED block count (windowing validated)

Synthetic `view.dispatch` benchmark (50 single-char inserts, median — no keydown/fold/controller noise), CONTEXT.md, flag OFF:

| Condition | rendered top-level blocks | median `view.dispatch` |
|---|---|---|
| **FULL DOM** | 3,636 | **53 ms** |
| **WINDOWED** (`display:none` all but first 60) | 60 | **4 ms** |

⇒ **`view.dispatch` cost is ~linear in rendered block count.** PM's `updateState` forces a synchronous layout of the whole contenteditable (selection sync) on every transaction; with a huge DOM that's ~53ms, with a small DOM ~4ms. Also: `inputLatency` p50 was 152ms while dispatch is 53ms → the other ~100ms is browser input-handling + paint OUTSIDE dispatch, which a smaller DOM also shrinks. **So real windowing virtualization is THE fix, and it's now quantified: it can take the ~152ms floor toward single digits.**

This also explains the earlier content-visibility FREEZE: the primitive wasn't the problem — the CONTROLLER was. It ran `evaluateAll()` over all 3,629 block views on EVERY transaction (incl. every keystroke). The redesign must make **typing trigger ZERO virtualization work** (the visible window doesn't change when you type in place — only scrolling changes it).

**HARD CONSTRAINT for the redesign (why naive `display:none` is wrong for the real thing):** `display:none` removes a block's HEIGHT, so hiding 3,500 off-screen blocks collapses `scrollHeight` → the scrollbar and scroll position break. The bench used `display:none` only because it never scrolled. Real windowing must RESERVE the off-screen height — either `content-visibility:hidden` + `contain-intrinsic-size:<h>px` (current primitive; reserves space, scroll works) or explicit sized spacer elements. **Before building, confirm `content-visibility` ALSO yields the ~4ms dispatch** (re-run the bench using `b.style.contentVisibility='hidden';b.style.containIntrinsicSize='auto 20px'` instead of `display:none`). If yes → keep content-visibility, just fix the controller. If content-visibility does NOT drop dispatch (only `display:none` does) → the design must use sized spacers, which is a bigger lift.

**Redesign sketch (viewport-virtualize.ts controller):**
- Evaluate/toggle ONLY on scroll (rAF-throttled) and a debounced post-edit remeasure. A plain docChanged tx (typing in place) must NOT call `evaluateAll` — schedule a debounced remeasure of cached positions, return immediately.
- Toggle only the DELTA of blocks crossing the viewport band since the last evaluation (track the current window range; on scroll, only flip blocks that entered/left).
- Zoom-normalize all `offsetTop`/`scrollTop` math (`.editor-area-scroll` has CSS `zoom`): divide measured offsets by `--editor-zoom` (or read `getComputedStyle(scroller).zoom`).
- Resolve the scroller lazily (the keep-alive editor mounts detached — the reverted `8d881e3` `ensureScroller` idea was right; it only failed because the OLD controller then thrashed).
- Keep export safe: content-visibility keeps nodes in the DOM (export clone works); sized-spacer approach would need `withVirtualizationSuspended` (plan §12 AM-4).

## UPDATE 2026-06-18d — virtualize controller REBUILT (typing does zero work); GUI validation pending

Acted on the decisive finding: rebuilt `viewport-virtualize.ts`'s controller (`a43cb5c`). The earlier freeze was the controller running `evaluateAll()` over all ~3,629 block views on EVERY transaction (it's driven by the plugin's `view.update()`, which fires per tx). New design:
- **`onUpdate` (per tx): on docChanged, only set `positionsDirty` + schedule a DEBOUNCED reconcile. NO synchronous evaluate.** Typing in place doesn't move the visible window, so typing now costs ~0 virtualization work — this is the fix for the freeze.
- **`reconcile()` runs only on scroll (rAF-throttled) + after the post-edit debounce settles.** Re-measures if stale, then evaluates the band and toggles content-visibility on the delta.
- **`register()`** schedules a debounced reconcile (one pass after the load batch, not per block).
- **`ensureScroller()`** lazily resolves the scroll container (keep-alive editor mounts detached) — the reverted `8d881e3` idea, now safe because there's no per-keystroke thrash.
- Kept **content-visibility + contain-intrinsic-size** (reserves off-screen height → scroll stays correct; `display:none` would collapse `scrollHeight`).

DEV-flag-gated, OFF by default. Automated gates green (2465 pass / 6 skip, tsc/eslint clean) but jsdom can't exercise it (content-visibility/offsetTop/scroll). **GUI validation required before flipping default:**
```js
window.__baramFlags = { virtualize: true };
// scroll up & down once (triggers the first reconcile → hides off-screen)
// then run the synthetic bench from §UPDATE 2026-06-18b again:
//   bench("VIRT ON")   → median view.dispatch should be ~4–10ms (near the windowed number), NOT 53ms
const els=[...document.querySelectorAll('.editor-area-scroll .tiptap > *')];
console.log("hidden(cv):", els.filter(e=>e.style.contentVisibility==='hidden').length, "/", els.length);
```
PASS criteria, all required:
1. synthetic `bench` median ≈ single digits (windowing engaged), `hidden(cv)` is a few thousand (most blocks hidden);
2. **real typing** stays smooth (no freeze) — type a burst, scroll, type again;
3. **scroll** is smooth top-to-bottom and all content appears (no blank gaps that never fill);
4. click / Outline-nav / find-in-doc to an off-screen target reveals it;
5. no scrollbar jump / wrong document height.
If all pass → replace the `window.__baramFlags.virtualize` DEV gate with a real `virtualizeLargeDocs` setting (default off → opt-in), gated to the large keep-alive editor. If typing freezes again → the per-tx path is still doing work; if scroll leaves blank gaps → reconcile/measure timing or the band/`contain-intrinsic-size` is off.

## UPDATE 2026-06-19 — virtualize rewritten via IntersectionObserver (v3); GUI re-test pending

The scroll-only `offsetTop`/`scrollTop` band-math controller (v2) blanked the screen on scroll: under `.editor-area-scroll`'s CSS `zoom`, offsetTop (layout coords) and scrollTop are in mismatched spaces → every block judged off-screen → all hidden, never revealed. Rewrote the controller (`b93e94b`) around an **IntersectionObserver** — the proven `lazy-visible.ts` pattern, which computes intersection from real rendered geometry and is inherently zoom-correct (zero coordinate math):
- `root: null` (viewport) + `rootMargin: 1200px 0px` — same config lazy-visible uses successfully in this WKWebView.
- Observes each paragraph/heading NodeView dom + heavy block doms; IO callback toggles `content-visibility:hidden` + `contain-intrinsic-size` (reserves height → scroll height correct, box still observable so re-entry fires).
- **Typing fires no IO callbacks** (visible set unchanged) → zero typing cost. Scrolling fires only the delta crossing the buffer.
- Reserve height from `entry.boundingClientRect` (IO already computed it) — NOT `offsetHeight`, whose per-entry read would thrash read/write layout and re-freeze.
- `syncEnabled()` (on tx + scroll) picks up the DEV-flag toggle.

**GUI re-test (the v2 blank-screen should be gone):** flag ON → scroll the whole doc top-to-bottom (content must appear everywhere, no permanent blanks) → synthetic `bench` median should be single digits → `hidden(cv)` a few thousand → typing/scroll smooth. If content still blanks: check IO is created (`window.__baramFlags.virtualize` true at scroll time) and that `contain-intrinsic-size` heights aren't wildly off. Pass → productionize to a `virtualizeLargeDocs` setting (default off).

## UPDATE 2026-06-19b — DEFINITIVE: content-visibility is a DEAD END; only display:none (box removal) works

Controlled bench (same ~3,110 off-screen blocks, applied directly — not IO-dependent — flag OFF so no NodeView confound):

| Condition | median `view.dispatch` |
|---|---|
| baseline (none hidden) | 170 ms |
| **content-visibility:hidden + contain-intrinsic-size** | **178 ms (NO improvement — slightly worse)** |
| **display:none** | **6 ms (28×)** |

**Conclusion: `content-visibility` does NOT reduce the typing cost. Only `display:none` does.** The bottleneck is the **box-level flow layout of all ~3,264 top-level boxes** that PM's `updateState`/selection-sync forces every transaction. `content-visibility:hidden` only skips painting/contents of descendants — the element's BOX stays in the layout flow, so all 3,264 boxes are still positioned → ~170ms regardless. `display:none` removes the box from flow entirely → 6ms.

⇒ **The entire IntersectionObserver + content-visibility controller (the current `viewport-virtualize.ts` flag code, `b93e94b`) cannot ever hit the target — wrong primitive.** It correctly fixed the blank-screen and engages, but content-visibility is the wrong tool. It stays DEV-flag OFF (inert in prod) but should be considered superseded.

**The ONLY path to fast large-doc typing: true windowing that REMOVES off-screen boxes from layout flow (`display:none`) while preserving scroll height with SPACERS** (CodeMirror-6 model). Validated design:
- Generic NodeView per paragraph/heading already exists; `setHidden(true)` → `dom.style.display='none'` (not content-visibility).
- Reserve the removed height with `.tiptap::before { height: var(--vtop) }` / `.tiptap::after { height: var(--vbot) }` pseudo-elements (pseudo-elements aren't DOM nodes, so PM's reconciliation won't strip them — this sidesteps the "PM owns the children" problem that kills real spacer divs).
- `--vtop` = Σ cached heights of hidden blocks ABOVE the visible window; `--vbot` = Σ below. Requires a per-block height cache (measure offsetHeight while visible; stale off-screen heights only cause minor scroll drift, re-measured on scroll-to).
- Visible window from IO (zoom-correct) or a band; recompute --vtop/--vbot on scroll. Heavy React-NodeView blocks participate too.
- Edge cases to handle: selection/click/find/nav into a display:none block must reveal it first; height-cache invalidation on edit; export must reveal all (`withVirtualizationSuspended`).

This is a substantial, careful windowing engine (~150–250 lines, several GUI iterations expected), NOT a tweak. It is the real C4 deliverable.

## CURRENT BLOCKER / NEXT STEP (start here)

**Symptom (the test that produced this handoff):** typing "hello hello hello" logged `SLOW TX ~170–300ms docChanged=true plugins=fold$:38–56,listAtomFix$:6–9` on EVERY keystroke.

**Status of the two original blockers:**

1. **Flag state — RESOLVED.** The user confirmed `window.__baramFlags.virtualize` was **ON** during that test. So virtualization was active and the ~120ms of non-plugin time is layout that virtualization did **not** eliminate in that run. Most likely cause: the position cache was not warmed before the timed burst (typing started before any scroll/activation `measure()` had hidden off-screen blocks), OR the first keystroke paid the one-time `measure()` forced-layout. The next GUI test MUST warm first (scroll once → `__baramPerf.reset()` → THEN type) to get the steady-state number. If steady-state typing is still ~100ms+ of pure layout with the flag ON and warmed, that is a separate virtualization-engagement bug to chase (see `viewport-virtualize.ts` `measure()`/`evaluateAll()`).

2. **fold's ~40ms/keystroke — FIXED in code (commit `4bbd54c`), pending GUI re-measure.** Root cause was: `fold` created a gutter-arrow **widget Decoration for EVERY foldable** (1,391 headings), and `fold.apply` did `DecorationSet.map(...)` over that ~1,391-widget set every keystroke (~40ms) on both rebuild and map-only paths. **Fix shipped:** heading arrows are now rendered via a CSS pseudo-element (`.tiptap > hN::before`); an open heading contributes **zero** decorations, and only a *folded* heading gets a `.fold-collapsed` node-class decoration. So fold's DecorationSet is empty when nothing is folded → per-keystroke map → ~0. Gutter clicks are coordinate-detected (`posAtCoords` probe + heading rect check) in `fold.ts handleDOMEvents.mousedown`. List-item arrows kept their widgets (far fewer than headings). All automated gates green (2460 pass / 6 skip, tsc/eslint/stylelint clean).

**NEXT STEP — GUI re-measure (user must run; I cannot run the GUI):**
```
npm run tauri dev   → open CONTEXT.md → DevTools console:
window.__baramFlags = { virtualize: true };
// scroll the editor up & down once to WARM the position cache + hide off-screen blocks
__baramPerf.reset();
// type a long burst (e.g. hold a key / type a sentence) IN A HEADING and again in a paragraph
const t = __baramPerf.txBreakdown();
console.log("avg ms/tx:", t.transactions.totalMs / t.transactions.count);
console.log("per-plugin:", t.plugins);   // fold$ should now be ~0
```
Report: (a) avg ms/tx, (b) whether `fold$` is gone from the plugin breakdown, (c) any residual SLOW TX and its `plugins=` field. Also verify folding still WORKS visually: hover a heading → arrow appears in the gutter; click the gutter → content folds + arrow rotates to collapsed; click again → unfolds. **Verify this with the flag both ON and OFF** (the `.fold-collapsed` node-class decoration lands on a heading that is also wrapped by the virtualize generic NodeView — node-deco-on-NodeView is expected to work but is the one untested interaction).

**The long-tail reality (tell the user):** virtualization fixes the *layout* cost, but multiple plugins each maintain a whole-document-sized DecorationSet that is mapped every keystroke — `fold` (~40ms, now fixed), `listAtomFix` (~7ms), `block-id`, etc. Reaching Obsidian-level means addressing each (CSS rendering or viewport-windowing of their decorations) AND confirming virtualization actually engages on steady-state typing (blocker #1). Each fix is bounded but there are several. This is why every fix has revealed the next bottleneck.

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
| `e3e9dfd` | docs: this handoff (C4 session). |
| `4bbd54c` | **perf(C4): heading fold arrows → CSS pseudo-element, not per-heading widgets.** Kills the ~40ms/keystroke fold-map cost (blocker #2). GUI-confirmed: `fold$` 0.29ms avg. |
| `0c29acb` | test(C4): assert fold DecorationSet is empty when nothing folded (locks the invariant). |
| `117b6dd` | **fix(C4): heading fold gutter click made zoom-safe** — coord approach broke under CSS `zoom`; now `pointer-events:auto` pseudo + `offsetX<0` + `posAtDOM`. User-confirmed folding works. |
| `3d0b67b` | **perf(C4): guard per-keystroke baseline `doc.eq()` with O(1) `content.size` check.** The real flag-independent ~152ms typing floor (ON≈OFF) — auto-save `update` listener walked the whole doc every keystroke. Behaviour-identical guard. GUI-confirmed: `update` event now 11ms/129 calls. |
| `8d881e3` | fix(C4): lazily re-resolve virtualize scroller — made virtualization engage on the large doc for the first time (revealed `hidden(cv)=0` was a detached-scroller bug). **Reverted** — engaging it froze the app. |
| `0c6541d` | **perf(C4): revert `8d881e3`** — large-doc content-visibility virtualization is not viable as-is (scroll+typing froze; content-visibility thrash × CSS `zoom` band-math). DEV flag back to a harmless no-op. Virtualization parked for redesign. |
| `d7c56a4` | **perf(C4): debounce Outline heading extraction.** `useEditorState`→`extractHeadings` ran a whole-doc walk every tx (incl. cursor moves) when the Outline panel was open → now 200ms-debounced `update` listener. |
| `c76cc6a` | **perf(C4): drop 2nd per-keystroke `doc.eq()` in virtualize `view.update`.** It ran inside `view.dispatch` (so it showed as PM-dispatch time, survived the auto-save fix) on every tx even flag-OFF → O(1) `!==` reference check. Completes the per-keystroke whole-doc audit (hooks + components + plugin apply + view.update + appendTransaction all clean). |
| `fb50651` | chore(C4): expose active editor on `window.__baramEditor` in DEV (drives the synthetic bench / windowing experiments). |
| `a43cb5c` | **perf(C4): rebuild virtualize controller — typing does ZERO work, evaluate on scroll only.** Fixes the freeze (was `evaluateAll` over all blocks every tx). content-visibility retained. DEV-flag OFF; GUI validation pending. |

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
1. **Re-measure with the fold fix in** (see "NEXT STEP — GUI re-measure" above). Confirm `fold$` is gone from the per-plugin breakdown and read the new steady-state avg ms/tx (warm the cache first).
2. **If residual layout remains with the flag ON + warmed** → chase blocker #1 (virtualization not engaging on steady-state typing): instrument `viewport-virtualize.ts` `measure()`/`evaluateAll()`, confirm off-screen NodeViews actually carry `content-visibility:hidden` during a typing burst.
3. Continue down the plugin long-tail (listAtomFix ~7ms, block-id) as the breakdown dictates, then productionize (settings flag instead of `__baramFlags`, containers, export/print verify).

## Conventions (unchanged)

- Commit msgs English, `§perf-large-file` tag + Cx.y, subject lowercase (commitlint rejects capitalized subjects). Conversational replies Korean.
- pre-commit: prettier --check + eslint --max-warnings=0 (perfectionist import/member sorting) — run `eslint --fix` / `prettier --write` and retry on failure.
- Vitest only (`npx vitest run`), never jest. `CONTEXT.md` (repo root, untracked, the perf fixture) — do NOT commit it.
- Keep doing tight self-driven edits + verify; OMC executor/sub-agents in this repo return empty final messages (extract via the agent's output transcript) — see [[feedback_executor_scope_overrun]].

# C3 Large-File Perf — Session Handoff (2026-06-13)

> Resume point for a fresh session. Branch: `feature/large-file-perf`. Plan: [`dev/plans/2026-06-11-large-file-perf-c3-plan.md`](../plans/2026-06-11-large-file-perf-c3-plan.md). Baseline/measurements: [`large-file-perf-baseline.md`](large-file-perf-baseline.md).

## RESOLVED BLOCKER — large-file truncation (2026-06-13)

**Symptom (user-reported in GUI):** Opening `CONTEXT.md` (~3,500 top-level blocks) renders only the FIRST CHUNK — the document is truncated, the progressive fill never completes.

**Status:** ROOT CAUSE CONFIRMED + FIXED. Verified by a deterministic repro test + full suite. Two earlier hypotheses were investigated and DISPROVED before the real cause was found — do not revisit them:
1. StrictMode/cancellation (handoff's original lead) — disproved by GUI instrumentation: the `[activeTabId]` effect ran exactly once, no cancel/evict fired, the appender itself threw.
2. Illegal top-level non-block node + a `sanitizeTopLevelNodes` pipeline guard — disproved: re-test still truncated AND emitted no warning, and a probe found 0 non-block top-level nodes. That fix was fully reverted.

**Actual root cause — cross-schema node insertion.** The keep-alive editor (large-doc path, C3.5) is a SEPARATE `Editor` instance created by `createKeepaliveEditor()`, so it has its OWN `Schema` instance — `editor.schema !== keepAliveEditor.schema`, and their `NodeType`s are distinct objects. `use-tab-switching.ts` built the PM nodes with `mdastBlocksToPmNodes(mdast, editor.schema)` (the SHARED editor's schema) but then created the first-chunk doc and ran the appender on the keep-alive editor. ProseMirror compares `NodeType` by **identity**, so the keep-alive editor's `doc.contentMatchAt()` treats every shared-schema node as not-a-block and throws `Called contentMatchAt on a node with invalid content`. The first chunk still renders because `doc.create()`/`updateState()` skip validation; the appender's first `tr.insert()` validates and throws → fill dies → truncation. Small docs use the shared editor only (same schema) → never hit it.

**The GUI console evidence that cracked it (instrumented run):** `EFFECT run #2` (exactly once) → `THEN allNodes=3561 … isLargeDoc=true` → `keepalive: +1 editor` → `updateState(first chunk)` → `appender START` → `Error: Called contentMatchAt … at step → replace → replaceStep → canReplace → contentMatchAt`. No cancel, no evict, no `[WARN] illegal top-level node` — the appender threw on its first insert into the keep-alive editor.

**Fix:** `src/hooks/use-tab-switching.ts` — after choosing `targetEditor` (which may be the keep-alive editor), re-convert the mdast with `targetEditor.schema` before chunking when `targetEditor !== editor`: `const targetNodes = targetEditor === editor ? allNodes : mdastBlocksToPmNodes(mdast, targetEditor.schema)`. So every node's `NodeType` belongs to the editor it is inserted into. Cost: one extra `convert(mdast→PM)` (~50ms) only on the large-doc keep-alive open path; the shared-editor path is unchanged (reuses `allNodes`). Regression test: `src/utils/editor/__tests__/keepalive-cross-schema.test.ts` (distinct-schema identity; HAZARD = cross-schema `toThrow(/contentMatchAt/)`; FIX = same-schema appends fully).

**Follow-up / watch-outs:**
- The same cross-schema trap applies to ANY code that builds nodes with one editor's schema and inserts into another. The source-mode large-doc path (`use-source-mode.ts`) builds with its own `editor` (the active editor, which for a pooled tab IS the keep-alive editor) so it is consistent — but verify if that routing changes.
- Possible optimization (not done): decide `isLargeDoc` from a cheap pre-convert estimate so the keep-alive path converts only once instead of twice. Correctness-first chose the double-convert; revisit only if the ~50ms shows up in C3.6 measurements.

## What C3 has delivered (all committed, all reviewed APPROVED, full suite 2453 pass + tsc clean at HEAD 7816ac6)

| Task | Commits | Outcome |
|---|---|---|
| C3.0 instrumentation | 047bfa0, cc48a36, 1d2bdac, 2696f26 | `__baramPerf` (inputLatency/longTasks/stalls/txBreakdown), cache-event logs. Cache-miss mystery closed. |
| C3.1 incremental decorations | 0109781, 13b801d | changedRanges helper; list-atom-fix/prompt-highlight/block-id/fold incremental. Plugin apply cost → ~0ms. |
| C3.1c layout containment | be1be5f | `content-visibility:auto` → `contain:layout paint` (was the click-5s cause). Paint-clip exclusions for headings/code-block/mermaid. |
| C3.1d decoration identity churn | 5bad611 | Stable widget keys / cached Decoration objects so unchanged blocks keep DOM identity (was the per-keystroke forced-layout cause). |
| C3 residuals | e428179 | block-id stale focus on undo; fold arrow pos resolved at click time (posAtDOM, NOT jsdom-testable — verify in GUI); C3.3 adaptive-halving + exactly-once tests. |
| C3.2 CM mount throttle | 70b051e | Shared IntersectionObserver + idle mount queue (1/tick, MRU, interaction bypass). |
| C3.3 input-pressure fill | 9ed775c | Appender defers within INPUT_QUIET_MS of input; adaptive chunk halving. |
| C3.4 dual-editor prereqs | 7b5bad5, bc40b6e | 6 module-level mutable states → WeakMap-per-editor; 13 global DOM queries scoped; `[data-editor-active]`. |
| C3.5 keep-alive editor | 052e0d7, 6c66564, 73521ea, 7816ac6 | Pool (cap 1, threshold 500), visibility-toggle tab switch, completeness flag, source-mode routing. Survived 4 adversarial review rounds. |

## Measured perf history (see baseline doc for full tables)

- C2: open freeze 2025ms → 11ms (first paint). ✓ shipped.
- C3 keystroke latency: 700ms (pre-C3) → 193ms (post-C3.1) → ~130-140ms (post-C3.1c/d) p50. **Still 4× over the 33ms target.** Confirmed via Safari Timeline: remaining cost is whole-viewport WebKit Layout per docChanged tx (JS≈0). C3.1c/d reduced churn but a per-keystroke layout floor remains — NOT yet at target.
- Click-to-cursor: was 4-6s; C3.1c containment helped in console experiment but committed build still showed ~4s in last GUI test (measure again post-blocker-fix).
- **IMPORTANT:** the truncation blocker means the last GUI numbers are unreliable. Re-run C3.6 measurement AFTER the truncation fix.

## Remaining work after the blocker

1. **Fix the truncation blocker** (above) — highest priority, blocks all GUI verification.
2. **C3.6 GUI verification** (task #12, human-run) — full measurement protocol is in the plan + was laid out in chat: open/click/type/tab-switch/scroll/source-mode/fold-arrow/visual checks. Record in baseline doc.
3. **Re-assess keystroke target** — if post-fix typing is still >33ms, the per-keystroke WebKit Layout floor on 3,531 blocks may need block-level virtualization (render only viewport blocks) — a C4-scale effort NOT in the current plan. Decide with the user whether 130ms is acceptable or escalate.
4. **C3 backlog** (task #13) — non-blocking cleanup: wire idCountMap to replace isDuplicateBlockId whole-doc walk; multi-step coordinate edge in block-id updateEntriesIncremental; dedupe boundary-expansion helpers; perf-trace teardown; syntax-reveal expand coalescing (move expand from view().update() view.dispatch into appendTransaction — 3-4 docChanged trs per boundary-crossing click); image.ts mousedown double-dispatch.

## Working method notes (important for the next session)

- **OMC executor agents in this repo overrun scope and return empty final messages.** They implemented C3.2-C3.5 when only C3.1d was assigned. ALWAYS `git log --oneline` after each dispatch and review every landed commit (spec + quality), not just the assigned one. Read real agent output from the transcript JSONL via `jq` on `tasks/<id>.output` when the final message is "done"/"네".
- Review pattern used: dispatch implementer → spec-review (general-purpose, adversarial "do not trust the report") → code-quality review (code-reviewer) → re-review fix commits. C3.5 needed 4 rounds; adversarial review caught 2 data-loss CRITICALs the implementer introduced while fixing others.
- Conventions: commit messages English with `§perf-large-file` tag + Cx.y; conversational replies Korean; pre-commit hook runs prettier + eslint --max-warnings=0 (perfectionist import/module sorting) — use `--fix` and retry on failure; Vitest only (`npx vitest run`), never jest.
- `CONTEXT.md` (repo root, untracked, ~21k lines / 3,531 blocks) is the perf fixture. Do not commit it.

## Verify-before-trust checklist for resume

```
git -C . log --oneline -1   # expect 7816ac6
npx vitest run              # expect 2453 passed | 6 skipped
npx tsc --noEmit            # expect clean
```

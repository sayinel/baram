# C3 Large-File Perf — Session Handoff (2026-06-13)

> Resume point for a fresh session. Branch: `feature/large-file-perf`. Plan: [`docs/plans/2026-06-11-large-file-perf-c3-plan.md`](../plans/2026-06-11-large-file-perf-c3-plan.md). Baseline/measurements: [`large-file-perf-baseline.md`](large-file-perf-baseline.md).

## CURRENT BLOCKER (start here)

**Symptom (user-reported in GUI, 2026-06-13):** Opening `CONTEXT.md` (3,531 top-level blocks) renders only the FIRST CHUNK — the document is truncated, the progressive fill never completes.

**Status:** UNDER INVESTIGATION, not yet fixed. No fix commit exists for this. Last action was tracing the code path; root cause NOT yet confirmed — do not assume, verify.

**What was being traced (evidence so far, all in `src/hooks/use-tab-switching.ts` keep-alive direct-load branch ~lines 460-575):**
- First open of a large doc (`allNodes.length >= LARGE_DOC_BLOCK_THRESHOLD = 500`) creates a keep-alive editor, `keepalive.acquire(tabId, targetEditor)`, `onActiveEditorChange(targetEditor)` — this triggers a React setState (`setActiveKeepaliveEditor`, `App.tsx:259-261`).
- THEN first chunk `updateState` runs inside a `setTimeout`, and the rest is scheduled via `appendChunksProgressively(targetEditor, restChunks, { onComplete: finishLoad })` (use-tab-switching.ts:563).
- The effect's cleanup (`use-tab-switching.ts:598-607`) runs `appendHandleRef.current?.handle.cancel()` + `progressiveLoadRef.current.cancelled = true` BEFORE the next effect body. The effect dep array is `[activeTabId]`.

**PRIME SUSPECT (hypothesis, UNVERIFIED):** `onActiveEditorChange(targetEditor)` at line 486 calls `setActiveKeepaliveEditor` → App re-renders. If that re-render causes the `[activeTabId]` effect to re-run (it should NOT, activeTabId is unchanged — but verify whether something else in the dep chain or a StrictMode double-invoke does), the cleanup fires `appendHandleRef.current?.handle.cancel()` and `progressiveLoadRef.current.cancelled = true`, killing the in-flight appender after only the first chunk. Note `main.tsx:35` wraps the app in `React.StrictMode` → effects run twice in dev; the SECOND mount's cleanup of the FIRST could cancel the appender. **This is the strongest lead — check StrictMode double-invoke interaction with the appender first.**
- Also check: `appendChunksProgressively` input-pressure deferral (`progressive-load.ts:165-169`) — `if (now() - lastInputTime < INPUT_QUIET_MS) reschedule`. If a `wheel`/`pointerdown`/`keydown` fires continuously (or `lastInputTime` is seeded wrong), the fill could defer forever. Less likely (would resume when input stops) but rule it out.
- Also check: `editor.isDestroyed` guard (`progressive-load.ts:153`) — if the keep-alive editor gets destroyed by an eviction/cleanup mid-fill, step() silently returns. Tie-in with the StrictMode suspicion.

**How to confirm:** add a temporary log in `appendChunksProgressively`'s `step()` (cancelled branch vs isDestroyed branch vs deferral branch) and in the effect cleanup; reproduce by opening CONTEXT.md; see which path stops the fill. Then fix narrowly.

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

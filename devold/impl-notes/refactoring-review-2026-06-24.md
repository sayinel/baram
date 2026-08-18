# Refactoring Review — 2026-06-24

Read-only review of whether refactoring is needed for **performance** + **maintainability**.
This is the handoff for a fresh session that will execute the refactoring (CSS first).

## Verdict

**Code health is high; no urgent refactor.** The one systematic signal is **file size** (CLAUDE.md caps: TS split at >500 lines, CSS ≤1,500 lines). This is a maintainability investment, not rot-driven.

Discipline metrics (measured 2026-06-24):
- useShallow violations: **0**
- dead code (knip): **none** (1 config hint only)
- TODO/FIXME/HACK markers: **3** total
- shared-util duplication: none (consolidated in the earlier `refactoring/ai` work)

**Performance axis:** no speculative perf refactor is warranted. Hot paths (windowing, progressive load, keep-alive, edit-latency) are already deeply optimized (PR #140/#141 + the 2026-06-24 load-floor spike). The ~38s large-file load floor is accepted as intrinsic to PM (see [[project-architecture-pm-commitment]]). Perf work should be **measurement-triggered**, not a speculative refactor.

## Targets (by priority)

### P0 — CSS over the 1,500-line cap (safest, highest ROI; START HERE)
- `src/styles/editor.css` — **2018** lines (35% over). Has 72 section comment blocks → clear split seams (e.g. editor-base / tables / math / code / callout / media). Split via `@import` from `src/styles/index.css` (the existing orchestrator).
- `src/styles/settings.css` — **1532** lines (just over). Split by settings tab/section.
- Approach: pure file split + `@import` re-wiring. No selector/value changes. Verify with `npm run audit:css-vars` + visual GUI check. Lowest risk because CSS has no logic.

### P1 — Largest TS/TSX files (>500; CLAUDE.md split threshold)
25 files exceed 500 lines. Worst offenders (split into cohesive submodules, keep public API stable, preserve `§` refs in comments/commits):
- `src/App.tsx` — 929. NOTE: it's a **composition root** wiring 32 custom hooks (logic already delegated), not a god-component. Extract grouped effect/handler clusters into hooks; lower risk than it looks.
- `src/components/sidebar/GraphView.tsx` — 895
- `src/extensions/plugins/block-id-decoration.ts` — 873
- `src/extensions/plugins/fold.ts` — 748
- `src/utils/journal/journal-prompts.ts` — 690 (likely data; may be fine to leave)
- `src/components/settings/tabs/VaultTab.tsx` — 688
- `src/extensions/nodes/mermaid-block-view.tsx` — 668
- `src/pipeline/md-to-pm.ts` — 637, `src/hooks/use-tab-switching.ts` — 632, `src/extensions/plugins/syntax-reveal.ts` — 631
- (…full list: 25 files >500. Re-scan: `find src -name '*.ts' -o -name '*.tsx' | grep -v __tests__ | xargs wc -l | sort -rn | awk '$1>500'`)

### P2 — Rust files >500
- `src-tauri/src/index/extractor.rs` — 861, `context/manager.rs` — 634, `index/mod.rs` — 601, `menu.rs` — 542, `snapshot/io.rs` — 522. Lower priority (backend, stable).

## Execution notes
- **Pure refactor only**: no behaviour change. Each split must keep tests green (`npm test`, 2493 pass baseline) + typecheck clean + `npm run lint`.
- Round-trip preservation is the top quality bar — pipeline files (`md-to-pm.ts`, `pm-to-md.ts`) need round-trip tests green after any split.
- Delegate multi-file edits to OMC `executor`; verify with `verifier`. Watch executor scope-overrun (review every landed commit — see memory [[feedback_executor_scope_overrun]]).
- Do P0 (CSS) first as a self-contained PR, then P1 file-by-file.

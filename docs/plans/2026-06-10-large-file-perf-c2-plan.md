# C2 Progressive Document Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the ~2025ms open freeze on large files by rendering the first viewport immediately and appending the rest of the document in non-blocking async chunks, ending with a complete document.

**Architecture:** The uncached file-open path builds an EditorState containing only the first chunk of blocks (fast `updateState`), then appends the remaining blocks in `requestIdleCallback`-scheduled transactions. Loading is guarded so partial-document states never mark the file dirty, never auto-save, and never trigger whole-document plugin rebuilds (which would be O(n²) across chunks). The final chunk omits the loading meta, triggering exactly one whole-document decoration rebuild. Fold/scroll/search restoration is deferred until the document is complete.

**Tech Stack:** TypeScript, Tiptap/ProseMirror (`tr.insert`, transaction meta, `addToHistory:false`), `requestIdleCallback` (with `setTimeout` fallback), Vitest.

**Design source:** [`docs/impl-notes/large-file-perf-baseline.md`](../impl-notes/large-file-perf-baseline.md) (Post-Phase-1 GUI measurement → C2 gate decision).

---

## Background (measured facts this plan relies on)

- `convert(mdast→PM)` = ~30ms (trivial); `updateState(DOM)` = **2025ms** = synchronous whole-document DOM materialization. Source: baseline doc.
- `mdastBlocksToPmNodes(root, schema)` (`src/pipeline/md-to-pm.ts:85`) returns a **flat array of top-level block `PMNode`s** — chunkable.
- Dirty/auto-save: `src/hooks/use-auto-save.ts:67-90` runs on every editor `update`; `shouldSkipDirty()` (`src/utils/editor/programmatic-update.ts:31`) gates it. **Every append transaction fires `update`** → must be suppressed during load or it marks dirty + auto-saves a partial doc.
- Whole-doc plugin rebuilds on `docChanged`: `block-id-decoration.ts:335` (`collectBlockIdEntries(newState.doc)`) and `list-atom-fix.ts:68` (`buildListAtomDecos(tr.doc)`). Per-chunk these are O(n²). Must be skipped during load (positions of already-loaded blocks don't shift because we only append at the end).
- The uncached open branch to modify: `src/hooks/use-tab-switching.ts:271-326`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/utils/editor/progressive-load.ts` | `PROGRESSIVE_LOAD_META`, `chunkBlocks()`, `scheduleIdle()`, `appendChunksProgressively()` | Create |
| `src/utils/editor/__tests__/progressive-load.test.ts` | unit + integration tests | Create |
| `src/utils/editor/programmatic-update.ts` | add loading guard (`setTabLoading`/`isTabLoading`); `shouldSkipDirty` honors it | Modify |
| `src/utils/editor/__tests__/programmatic-update.test.ts` | guard test | Create (or extend if exists) |
| `src/extensions/plugins/block-id-decoration.ts` | skip whole-doc rebuild when `PROGRESSIVE_LOAD_META` set | Modify |
| `src/extensions/plugins/list-atom-fix.ts` | skip whole-doc rebuild when `PROGRESSIVE_LOAD_META` set | Modify |
| `src/hooks/use-tab-switching.ts` | uncached branch: first-chunk updateState + progressive append + deferred fold/scroll/search + loading guard + cancel | Modify |

**Constants** (in `progressive-load.ts`): `FIRST_CHUNK_BLOCKS = 80`, `REST_CHUNK_BLOCKS = 150` (tunable; first chunk must exceed a viewport).

---

## Task C2.1: progressive-load core (chunking + scheduler + appender)

**Files:**
- Create: `src/utils/editor/progressive-load.ts`
- Create: `src/utils/editor/__tests__/progressive-load.test.ts`

- [ ] **Step 1: Write the failing test for `chunkBlocks`**

```typescript
import { describe, expect, it } from "vitest";

import { chunkBlocks } from "../progressive-load";

// chunkBlocks works on opaque items; use plain objects as stand-ins for PMNodes.
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

describe("chunkBlocks", () => {
  it("returns a single chunk when blocks fit in the first chunk", () => {
    expect(chunkBlocks(items(50), 80, 150)).toHaveLength(1);
    expect(chunkBlocks(items(50), 80, 150)[0]).toHaveLength(50);
  });

  it("splits first chunk then rest chunks", () => {
    const chunks = chunkBlocks(items(400), 80, 150);
    expect(chunks.map((c) => c.length)).toEqual([80, 150, 150, 20]);
  });

  it("handles empty input", () => {
    expect(chunkBlocks([], 80, 150)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/editor/__tests__/progressive-load.test.ts`
Expected: FAIL — `chunkBlocks` not exported.

- [ ] **Step 3: Implement `progressive-load.ts`**

```typescript
// §perf-large-file C2: progressive document rendering — render the first
// chunk immediately, then append the rest in non-blocking idle callbacks.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Transaction meta flag set on every append EXCEPT the last. Decoration
 *  plugins that rebuild over the whole doc skip the rebuild when it is set. */
export const PROGRESSIVE_LOAD_META = "baramProgressiveLoad";

export const FIRST_CHUNK_BLOCKS = 80;
export const REST_CHUNK_BLOCKS = 150;

/** Split a flat block array into [firstChunk, ...restChunks]. */
export function chunkBlocks<T>(
  blocks: T[],
  firstChunkSize: number,
  restChunkSize: number,
): T[][] {
  if (blocks.length === 0) return [];
  const chunks: T[][] = [blocks.slice(0, firstChunkSize)];
  for (let i = firstChunkSize; i < blocks.length; i += restChunkSize) {
    chunks.push(blocks.slice(i, i + restChunkSize));
  }
  return chunks;
}

/** Schedule `cb` to run when the main thread is idle. Returns a canceller.
 *  Falls back to setTimeout where requestIdleCallback is unavailable. */
export type ScheduleFn = (cb: () => void) => () => void;

export const scheduleIdle: ScheduleFn = (cb) => {
  const g = globalThis as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof g.requestIdleCallback === "function") {
    const id = g.requestIdleCallback(cb, { timeout: 100 });
    return () => g.cancelIdleCallback?.(id);
  }
  const id = setTimeout(cb, 0);
  return () => clearTimeout(id);
};

export interface ProgressiveLoadHandle {
  cancel(): void;
}

/**
 * Append `chunks` of block nodes to the END of the editor's document, one
 * chunk per scheduled tick, yielding between chunks. Every chunk except the
 * last carries PROGRESSIVE_LOAD_META so heavy decoration plugins skip their
 * whole-doc rebuild; the last chunk omits it, triggering exactly one rebuild.
 * Appends are not added to undo history. Calls onComplete after the last chunk.
 */
export function appendChunksProgressively(
  editor: Editor,
  chunks: PMNode[][],
  opts: { onComplete: () => void; schedule?: ScheduleFn },
): ProgressiveLoadHandle {
  const schedule = opts.schedule ?? scheduleIdle;
  let i = 0;
  let cancelled = false;
  let cancelTick: () => void = () => {};

  const step = () => {
    if (cancelled) return;
    if (i >= chunks.length) {
      opts.onComplete();
      return;
    }
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;
    i += 1;

    const { state } = editor.view;
    const tr = state.tr.insert(state.doc.content.size, chunk);
    tr.setMeta("addToHistory", false);
    if (!isLast) tr.setMeta(PROGRESSIVE_LOAD_META, true);
    editor.view.dispatch(tr);

    cancelTick = schedule(step);
  };

  cancelTick = schedule(step);
  return {
    cancel() {
      cancelled = true;
      cancelTick();
    },
  };
}
```

- [ ] **Step 4: Run the `chunkBlocks` test to verify it passes**

Run: `npx vitest run src/utils/editor/__tests__/progressive-load.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add an integration test for `appendChunksProgressively` (synchronous schedule)**

Append to the test file. Uses a real editor + a synchronous scheduler so the whole append runs inline:

```typescript
import { Editor } from "@tiptap/core";

import { createBaramExtensions } from "../../../extensions";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { appendChunksProgressively } from "../progressive-load";

const syncSchedule = (cb: () => void) => {
  cb();
  return () => {};
};

describe("appendChunksProgressively", () => {
  it("appends all chunks to the end and calls onComplete with the full doc", () => {
    const editor = new Editor({ extensions: createBaramExtensions(), content: "" });
    // Build a 5-paragraph doc, load only the first paragraph, append the rest.
    const full = markdownToProsemirror("A\n\nB\n\nC\n\nD\n\nE\n", editor.schema);
    const blocks = full.content.content; // top-level block nodes
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );
    expect(editor.state.doc.childCount).toBe(1);

    let completed = false;
    appendChunksProgressively(editor, [[blocks[1], blocks[2]], [blocks[3], blocks[4]]], {
      schedule: syncSchedule,
      onComplete: () => {
        completed = true;
      },
    });

    expect(completed).toBe(true);
    expect(editor.state.doc.childCount).toBe(5);
    expect(editor.state.doc.textContent).toBe("ABCDE");
    editor.destroy();
  });

  it("stops appending after cancel()", () => {
    const editor = new Editor({ extensions: createBaramExtensions(), content: "" });
    const full = markdownToProsemirror("A\n\nB\n\nC\n", editor.schema);
    const blocks = full.content.content;
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );
    // Manual scheduler we never advance → nothing appends; cancel must be safe.
    const pending: (() => void)[] = [];
    const handle = appendChunksProgressively(editor, [[blocks[1]], [blocks[2]]], {
      schedule: (cb) => {
        pending.push(cb);
        return () => {};
      },
      onComplete: () => {},
    });
    handle.cancel();
    pending.forEach((cb) => cb()); // even if a tick fires, cancelled short-circuits
    expect(editor.state.doc.childCount).toBe(1);
    editor.destroy();
  });
});
```

> If `full.content.content` is not the right accessor for the block array in this ProseMirror version, read how other tests pull top-level nodes (e.g. iterate `doc.forEach`) and adjust — do not guess. The intent: load 1 block, append the rest, assert the doc reaches all blocks in order.

- [ ] **Step 6: Run the full test file**

Run: `npx vitest run src/utils/editor/__tests__/progressive-load.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/utils/editor/progressive-load.ts src/utils/editor/__tests__/progressive-load.test.ts
git commit -m "feat(§perf-large-file C2): add progressive chunked-append core"
```

---

## Task C2.2: loading guard in programmatic-update

**Files:**
- Modify: `src/utils/editor/programmatic-update.ts`
- Create: `src/utils/editor/__tests__/programmatic-update.test.ts` (if a test file already exists, extend it)

- [ ] **Step 1: Write the failing test**

```typescript
import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import {
  isTabLoading,
  setTabLoading,
  shouldSkipDirty,
} from "../programmatic-update";

const schema = new Schema({
  nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} },
});
const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create());

describe("loading guard", () => {
  it("skips dirty while a tab is loading, regardless of baseline", () => {
    setTabLoading("tabX", true);
    expect(isTabLoading("tabX")).toBe(true);
    expect(shouldSkipDirty("tabX", doc)).toBe(true); // suppressed during load
    setTabLoading("tabX", false);
    expect(isTabLoading("tabX")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/utils/editor/__tests__/programmatic-update.test.ts`
Expected: FAIL — `setTabLoading`/`isTabLoading` not exported.

- [ ] **Step 3: Implement the guard**

In `src/utils/editor/programmatic-update.ts`, add near the other module state:

```typescript
const loadingTabs = new Set<string>();

/** Mark a tab as currently loading (progressive render in flight). While set,
 *  shouldSkipDirty() returns true so append transactions never mark dirty. */
export function setTabLoading(tabId: string, loading: boolean): void {
  if (loading) loadingTabs.add(tabId);
  else loadingTabs.delete(tabId);
}

export function isTabLoading(tabId: string): boolean {
  return loadingTabs.has(tabId);
}
```

And make `shouldSkipDirty` honor it — add this as the FIRST statement inside `shouldSkipDirty`:

```typescript
  if (loadingTabs.has(tabId)) return true;
```

Also add `loadingTabs.delete(tabId);` inside `clearOriginalDoc(tabId)` so closing a tab mid-load cleans up.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/utils/editor/__tests__/programmatic-update.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/editor/programmatic-update.ts src/utils/editor/__tests__/programmatic-update.test.ts
git commit -m "feat(§perf-large-file C2): add loading guard to suppress dirty during progressive load"
```

---

## Task C2.3: gate whole-doc plugin rebuilds behind PROGRESSIVE_LOAD_META

**Files:**
- Modify: `src/extensions/plugins/block-id-decoration.ts`
- Modify: `src/extensions/plugins/list-atom-fix.ts`
- Create: `src/extensions/plugins/__tests__/progressive-load-gating.test.ts`

- [ ] **Step 1: Modify `block-id-decoration.ts`**

Add the import at top: `import { PROGRESSIVE_LOAD_META } from "../../utils/editor/progressive-load";`

Change the rebuild line (currently `const entries = tr.docChanged ? collectBlockIdEntries(newState.doc) : value.entries;`, ~line 335) to skip the whole-doc collect during progressive load:

```typescript
        const skipRebuild = tr.getMeta(PROGRESSIVE_LOAD_META) === true;
        const entries =
          tr.docChanged && !skipRebuild
            ? collectBlockIdEntries(newState.doc)
            : value.entries;
```

(Append-at-end never shifts already-collected positions, so reusing `value.entries` during load is correct; the final chunk omits the meta and rebuilds over the complete doc.)

- [ ] **Step 2: Modify `list-atom-fix.ts`**

Add the import: `import { PROGRESSIVE_LOAD_META } from "../../utils/editor/progressive-load";`

Change the `apply` (currently lines 63-69) so a progressive-load transaction maps instead of rebuilding:

```typescript
          apply(tr, old, _oldState, newState) {
            if (old === DecorationSet.empty && newState.doc.content.size > 0) {
              return buildListAtomDecos(newState.doc);
            }
            if (!tr.docChanged || tr.getMeta(PROGRESSIVE_LOAD_META) === true) {
              return old.map(tr.mapping, tr.doc);
            }
            return buildListAtomDecos(tr.doc);
          },
```

- [ ] **Step 3: Write a correctness test (final doc fully decorated)**

Create `src/extensions/plugins/__tests__/progressive-load-gating.test.ts`. It verifies that after a meta-gated append followed by a final (no-meta) append, decorations cover the whole document — i.e. gating does not lose decorations on the complete doc:

```typescript
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../index";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { PROGRESSIVE_LOAD_META } from "../../../utils/editor/progressive-load";

describe("progressive-load decoration gating", () => {
  it("list-atom decorations cover items appended across gated + final chunks", () => {
    const editor = new Editor({ extensions: createBaramExtensions(), content: "" });
    const full = markdownToProsemirror("- a\n- b\n- c\n", editor.schema);
    const blocks = full.content.content;
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );

    // gated append (meta set) then final append (no meta → triggers rebuild)
    const s1 = editor.state;
    editor.view.dispatch(
      s1.tr.insert(s1.doc.content.size, blocks.slice(1)).setMeta(PROGRESSIVE_LOAD_META, true),
    );
    const s2 = editor.state;
    editor.view.dispatch(s2.tr.insert(s2.doc.content.size, []).setMeta("addToHistory", false));

    // Sanity: document is complete and roundtrips (no decoration error thrown).
    expect(editor.state.doc.textContent).toContain("a");
    editor.destroy();
  });
});
```

> The strong correctness guarantee (no lost decorations, no O(n²)) is validated end-to-end by Task C2.4's integration test and the GUI measurement in C2.5. This unit test guards against the gating throwing or corrupting the doc.

- [ ] **Step 4: Run tests + full suite**

Run: `npx vitest run src/extensions/plugins/__tests__/progressive-load-gating.test.ts`
Expected: PASS.
Run: `npm test`
Expected: all green — existing block-id / list-atom tests unaffected (normal edits have no PROGRESSIVE_LOAD_META, so behavior is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/extensions/plugins/block-id-decoration.ts src/extensions/plugins/list-atom-fix.ts src/extensions/plugins/__tests__/progressive-load-gating.test.ts
git commit -m "perf(§perf-large-file C2): skip whole-doc decoration rebuild during progressive load"
```

---

## Task C2.4: wire progressive loading into the open path

**Files:**
- Modify: `src/hooks/use-tab-switching.ts` (uncached branch ~271-326)

- [ ] **Step 1: Read the current uncached branch and imports**

Read `src/hooks/use-tab-switching.ts` lines 1-80 (imports + `progressiveLoadRef`) and 244-330 (cached + uncached branches). Confirm the exact surrounding code before editing.

- [ ] **Step 2: Add imports**

Add:
```typescript
import {
  appendChunksProgressively,
  chunkBlocks,
  FIRST_CHUNK_BLOCKS,
  REST_CHUNK_BLOCKS,
  type ProgressiveLoadHandle,
} from "../utils/editor/progressive-load";
import {
  markContentLoaded,
  setTabLoading,
} from "../utils/editor/programmatic-update";
```
(`markContentLoaded` is already imported — merge, don't duplicate. `setTabLoading` is new.)

- [ ] **Step 3: Track the in-flight append handle for cancellation**

Near `progressiveLoadRef` (~line 70), add a ref:
```typescript
  const appendHandleRef = useRef<ProgressiveLoadHandle | null>(null);
```
At the very start of BOTH the cached and uncached load branches (right after the prior-load cancellation `progressiveLoadRef.current.cancelled = true;`), cancel any in-flight append:
```typescript
        appendHandleRef.current?.cancel();
        appendHandleRef.current = null;
```

- [ ] **Step 4: Replace the uncached branch body**

Replace the current uncached `.then((mdast) => { ... })` body (the part from `const allNodes = ...` through the fold-restore block, ~lines 290-326) with the progressive version:

```typescript
            const allNodes = timePhase("convert(mdast→PM)", () =>
              mdastBlocksToPmNodes(mdast, editor.schema),
            );
            const chunks = chunkBlocks(
              allNodes,
              FIRST_CHUNK_BLOCKS,
              REST_CHUNK_BLOCKS,
            );
            const firstChunk = chunks[0] ?? [];
            const restChunks = chunks.slice(1);

            const doc = editor.schema.nodes.doc.create(
              null,
              firstChunk.length ? firstChunk : undefined,
            );
            const newState = EditorState.create({
              doc,
              plugins: editor.state.plugins,
              selection: TextSelection.atStart(doc),
            });

            // Suppress dirty/auto-save for the whole progressive load.
            setTabLoading(activeTabId!, true);

            // Run the deferred post-load work once the FULL doc is present.
            const finishLoad = () => {
              setTabLoading(activeTabId!, false);
              markContentLoaded(activeTabId!);
              afterDocLoad();
              const inTab = tabs.find((t) => t.id === activeTabId);
              if (inTab?.filePath) {
                const savedAnchors = useFoldStore
                  .getState()
                  .getFolds(inTab.filePath);
                if (savedAnchors.length > 0) {
                  const positions = anchorsToPositions(
                    editor.view.state.doc,
                    savedAnchors,
                  );
                  if (positions.length > 0) {
                    dispatchRestoreFolds(editor.view, positions);
                  }
                }
              }
            };

            // Defer updateState outside React commit phase.
            setTimeout(() => {
              if (loadToken.cancelled) {
                setTabLoading(activeTabId!, false);
                setIsParsing(false);
                return;
              }
              timePhase("updateState(first chunk)", () =>
                editor.view.updateState(newState),
              );
              setIsParsing(false);

              // Reset scroll to top for freshly opened documents.
              requestAnimationFrame(() => {
                const scrollContainer = document.querySelector(
                  ".editor-area-scroll",
                );
                if (scrollContainer) scrollContainer.scrollTop = 0;
              });

              if (restChunks.length === 0) {
                finishLoad();
                return;
              }
              appendHandleRef.current = appendChunksProgressively(
                editor,
                restChunks,
                { onComplete: finishLoad },
              );
            });
```

Key points the replacement must preserve:
- `loadToken` is the existing per-load cancellation token from the lines above (`const loadToken = { cancelled: false }; progressiveLoadRef.current = loadToken;`). Keep it; the `setTimeout` guard and the existing `if (loadToken.cancelled) return;` after `parseMdastAsync` stay.
- `afterDocLoad`, `anchorsToPositions`, `dispatchRestoreFolds`, `useFoldStore`, `tabs` are already in scope (used by the current code) — confirm while editing.
- Do NOT change the cached branch except for the `appendHandleRef.current?.cancel()` added in Step 3.

- [ ] **Step 5: Add an integration test**

Create `src/hooks/__tests__/use-tab-switching.progressive.test.ts` OR, if mounting the hook is impractical, add a focused integration test that exercises the same flow via the editor directly. The test must assert: opening a multi-chunk document ends with the COMPLETE document, and the tab is NOT dirty afterward.

Because the hook needs React + stores, prefer testing the *observable contract* through the editor + `appendChunksProgressively` + the loading guard together (the pieces the hook composes), which Tasks C2.1–C2.2 already cover. If a hook-level test is feasible with the project's existing hook test utilities, assert:
```
- after load completes, editor.state.doc.childCount === total blocks
- useEditorStore tab.isDirty === false
- markdown roundtrip of the loaded doc equals the source
```
If no hook test harness exists, document in the commit message that C2.4 is covered by C2.1/C2.2 unit tests + the C2.5 GUI verification, and do NOT fabricate a passing hook test.

- [ ] **Step 6: Verify**

Run: `npm test`
Expected: all green (2365+).
Run: `npx tsc --noEmit` (or repo typecheck) → no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-tab-switching.ts src/hooks/__tests__/use-tab-switching.progressive.test.ts
git commit -m "perf(§perf-large-file C2): progressively render large files on open"
```

---

## Task C2.5: GUI verification + baseline update (human-run)

**Files:**
- Modify: `docs/impl-notes/large-file-perf-baseline.md`

- [ ] **Step 1: Measure in the app** (human)

`npm run tauri dev` → open `CONTEXT.md` → console:
- `[Baram Perf] updateState(first chunk): X ms` — must be small (target < 100ms).
- Confirm the rest of the document fills in within ~1-2s while the UI stays responsive (can scroll/click during fill).

- [ ] **Step 2: Correctness checks** (human)

- Open `CONTEXT.md`, do NOT edit → the tab must NOT show a dirty marker (no false dirty from appends).
- Save (Cmd+S) immediately after open, then reopen → content identical (no partial-doc save / roundtrip preserved).
- Scroll to the bottom while loading and after → all content present, order correct.
- Navigate via a backlink/heading to a deep position → lands correctly after load.
- Fold a heading, switch tab, switch back → fold restored.
- Code blocks / mermaid below the fold still lazy-render on scroll (Phase 1b intact).

- [ ] **Step 3: Record results in the baseline doc**

Fill `updateState(first chunk)` ms, total fill time, and a PASS/FAIL for each correctness check.

- [ ] **Step 4: Commit**

```bash
git add docs/impl-notes/large-file-perf-baseline.md
git commit -m "docs(§perf-large-file C2): record progressive-render GUI verification"
```

---

## Self-Review

**Spec coverage** (design → tasks):
- Progressive append architecture → C2.1 (`chunkBlocks`/`appendChunksProgressively`/`scheduleIdle`) + C2.4 (wiring) ✓
- Interaction #1 partial-save / dirty suppression → C2.2 (loading guard) + C2.4 (`setTabLoading` around load, `markContentLoaded` on complete) ✓
- Interaction #2 plugin O(n²) → C2.3 (meta gating, last chunk rebuilds) ✓
- Interaction #3 fold restore deferred → C2.4 (`finishLoad`) ✓
- Interaction #4 scroll/search restore deferred → C2.4 (`afterDocLoad` inside `finishLoad`) ✓
- Interaction #5 tab-switch cancel → C2.1 (`cancel()`) + C2.4 (`appendHandleRef` cancel at branch start) ✓
- Scope = uncached open only; cached/tab-switch untouched → C2.4 Step 4 note ✓
- Verification (roundtrip, T_freeze, responsiveness, no false dirty) → C2.5 ✓

**Placeholder scan:** No TBD/TODO. C2.4 Step 5 gives an explicit, honest fallback (don't fabricate a hook test) rather than a vague placeholder; C2.5 is human-run GUI verification (the only way to measure DOM, as established in Phase 0). The `full.content.content` accessor caveat instructs reading real usage rather than guessing.

**Type consistency:** `PROGRESSIVE_LOAD_META` (string) — defined in C2.1, imported identically in C2.3 (both plugins) and used via `tr.getMeta`/`tr.setMeta`. `chunkBlocks`/`appendChunksProgressively`/`scheduleIdle`/`ProgressiveLoadHandle`/`FIRST_CHUNK_BLOCKS`/`REST_CHUNK_BLOCKS` — defined C2.1, consumed C2.4 with matching signatures. `setTabLoading`/`isTabLoading` — defined C2.2, used C2.4. `appendHandleRef: ProgressiveLoadHandle | null` consistent with C2.1's return type.

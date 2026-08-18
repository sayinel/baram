# Large-File Performance — Phase 0 & 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the open-time freeze and scroll/tab stutter on ~20k-line markdown files by (1) instrumenting where the cost actually is, (2) making off-screen rendering cheap, and (3) deferring heavy per-block NodeView instantiation (CodeMirror/Mermaid) until visible.

**Architecture:** Measurement-gated. Phase 0 adds split timing (parse / convert / DOM) in both vitest and the real app. Phase 1 is two low-risk, high-ROI rendering fixes: `content-visibility: auto` on top-level blocks (CSS only, no ProseMirror change) and lazy-mount of CodeMirror/Mermaid NodeViews via `IntersectionObserver`. The async-conversion work (Phase 2) is a **separate plan** finalized after Phase 0 produces numbers — the technique (chunk+yield vs Worker `fromJSON`) and the 20k `T_settled` target depend on that data.

**Tech Stack:** TypeScript, Tiptap/ProseMirror, CodeMirror 6, Mermaid (dynamic import), Vitest (jsdom), `IntersectionObserver`, CSS `content-visibility`.

**Design doc:** [`dev/plans/2026-06-09-large-file-perf-design.md`](./2026-06-09-large-file-perf-design.md)

---

## Scope of THIS plan

This plan covers **Phase 0 (measurement) + Phase 1 (rendering cost)** in full, bite-sized detail. These are immediately executable, non-gated, and alone address the user's #1 symptom (scroll/tab stutter + the CodeMirror-296 open freeze on `CONTEXT.md`).

**Phase 2 (async conversion), Phase 3 (tab/updateState), Phase 4 (plugin cleanup)** are intentionally NOT detailed here. They are measurement-gated: Phase 0's numbers decide Phase 2's technique and whether `T_settled < 1s` for 20k lines is pursued (possibly via C2/chunked rendering). They get their own plan after Phase 0. See the "Gated Follow-up Roadmap" section at the end for the decision criteria.

**Invariant for every task:** `npm test` (2356 pass / 5 skip) and `cargo test` (163 pass) stay green; markdown roundtrip is preserved.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/pipeline/__tests__/perf-benchmark.test.ts` | JS-cost benchmark (parse vs convert split, CONTEXT.md fixture) | Modify |
| `src/utils/perf.ts` | Add `markPhase()` perf-mark helpers for runtime instrumentation | Modify |
| `src/hooks/use-tab-switching.ts` | Wrap convert / updateState in perf marks; lazy-load wiring stays | Modify |
| `dev/impl-notes/large-file-perf-baseline.md` | Phase 0 baseline numbers (new results doc) | Create |
| `src/styles/editor.css` | `content-visibility: auto` on top-level blocks | Modify |
| `src/extensions/nodes/views/lazy-visible.ts` | Shared `onFirstVisible()` IntersectionObserver helper | Create |
| `src/extensions/nodes/views/__tests__/lazy-visible.test.ts` | Helper unit test | Create |
| `src/test-setup.ts` | `IntersectionObserver` mock for jsdom | Modify |
| `src/extensions/nodes/views/code-block-node-view.ts` | Defer `initCM()` until visible; placeholder; `ensureCM()` | Modify |
| `src/extensions/nodes/views/__tests__/code-block-lazy.test.ts` | Lazy CM instantiation test | Create |
| `src/extensions/nodes/mermaid-block-view.tsx` | Gate `renderMermaid()` behind first-visible | Modify |

---

## Phase 0 — Measurement Baseline (gate)

Phase 0 tasks are **measurement tasks**, not red-green-refactor. The deliverable is recorded numbers that gate later phases.

### Task 0.1: Split-timing benchmark with CONTEXT.md fixture

**Files:**
- Modify: `src/pipeline/__tests__/perf-benchmark.test.ts`

- [ ] **Step 1: Add a fixture loader + split-timing block**

Add the following imports at the top of the file (after existing imports on line 8):

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseMdast } from "../parse-mdast";
import { mdastBlocksToPmNodes } from "../md-to-pm";
```

Add a fixture helper after the `schema` definition (after line 112):

```typescript
/** Load CONTEXT.md (the 21k-line worst-case fixture) if present, else synthesize. */
function loadLargeFixture(): { label: string; md: string } {
  try {
    const md = readFileSync(resolve(process.cwd(), "CONTEXT.md"), "utf8");
    return { label: `CONTEXT.md (${md.split("\n").length} lines)`, md };
  } catch {
    return { label: "synthetic 20k", md: generateMarkdown(20000) };
  }
}
```

- [ ] **Step 2: Add the split-timing test**

Append this `perfDescribe` block at the end of the file:

```typescript
perfDescribe("Performance: Open split timing (parse vs convert)", () => {
  it("reports parse + convert split on the large fixture", () => {
    const { label, md } = loadLargeFixture();

    const t0 = performance.now();
    const mdast = parseMdast(md);
    const tParse = performance.now() - t0;

    const t1 = performance.now();
    const nodes = mdastBlocksToPmNodes(mdast, schema);
    const tConvert = performance.now() - t1;

    console.log(
      `[Perf] ${label}: parse=${tParse.toFixed(0)}ms convert=${tConvert.toFixed(0)}ms blocks=${nodes.length}`,
    );
    // Diagnostic only — no hard assert; this records the JS-cost split.
    expect(nodes.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run the benchmark and capture output**

Run: `ENABLE_PERF_BENCHMARKS=1 npx vitest run src/pipeline/__tests__/perf-benchmark.test.ts`
Expected: PASS, with a `[Perf] CONTEXT.md (...): parse=... convert=... blocks=...` line in the console.

- [ ] **Step 4: Confirm default suite still skips perf**

Run: `npx vitest run src/pipeline/__tests__/perf-benchmark.test.ts`
Expected: tests SKIPPED (no `ENABLE_PERF_BENCHMARKS`), suite green.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/__tests__/perf-benchmark.test.ts
git commit -m "test(§perf-large-file): add parse/convert split benchmark on CONTEXT.md fixture"
```

### Task 0.2: Runtime perf marks in the app open path

The vitest benchmark cannot measure DOM layout/paint or CodeMirror instantiation (jsdom has no layout). This task instruments the real app so the DOM floor is measurable in WKWebView dev.

**Files:**
- Modify: `src/utils/perf.ts`
- Modify: `src/hooks/use-tab-switching.ts:289-302`

- [ ] **Step 1: Add a phase-timing helper to perf.ts**

Append to `src/utils/perf.ts`:

```typescript
/** Dev-only: time a synchronous phase and log it. Returns the callback result. */
export function timePhase<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  logger.debug(`[Baram Perf] ${label}: ${elapsed.toFixed(0)}ms`);
  return result;
}
```

- [ ] **Step 2: Wrap convert + updateState in the uncached open path**

In `src/hooks/use-tab-switching.ts`, import the helper (add to the existing import from `../utils/perf` or create one):

```typescript
import { timePhase } from "../utils/perf";
```

Replace the body around lines 290-302 (the `mdastBlocksToPmNodes` → `updateState` sequence) so each phase is timed:

```typescript
            const allNodes = timePhase("convert(mdast→PM)", () =>
              mdastBlocksToPmNodes(mdast, editor.schema),
            );
            const doc = editor.schema.nodes.doc.create(null, allNodes);
            const newState = EditorState.create({
              doc,
              plugins: editor.state.plugins,
              selection: TextSelection.atStart(doc),
            });
            // Defer updateState outside React commit phase
            setTimeout(() => {
              timePhase("updateState(DOM)", () =>
                editor.view.updateState(newState),
              );
              markContentLoaded(activeTabId!);
              setIsParsing(false);
            });
```

- [ ] **Step 3: Verify the build + tests**

Run: `npm test -- src/hooks` (or `npx vitest run src/hooks`)
Expected: PASS — behavior unchanged, only added logging.

- [ ] **Step 4: Manual measurement (record baseline)**

Run the app in dev (`npm run tauri dev`), open `CONTEXT.md`, and read the console:
- `[Baram Perf] convert(mdast→PM): Xms`
- `[Baram Perf] updateState(DOM): Yms`

Record X (JS convert) and Y (DOM) in the baseline doc (Task 0.3). Also note `[Perf] CONTEXT.md parse=...` from Task 0.1.

- [ ] **Step 5: Commit**

```bash
git add src/utils/perf.ts src/hooks/use-tab-switching.ts
git commit -m "perf(§perf-large-file): instrument convert + updateState phases in open path"
```

### Task 0.3: Record baseline + gate decision

**Files:**
- Create: `dev/impl-notes/large-file-perf-baseline.md`

- [ ] **Step 1: Write the baseline doc**

Create `dev/impl-notes/large-file-perf-baseline.md` with the measured numbers:

```markdown
# Large-File Perf — Phase 0 Baseline

> Fixture: CONTEXT.md (~21k lines, ~296 code blocks, ~4368 table rows)
> Measured: <date>, dev build (WKWebView)

| Phase | CONTEXT.md (20k) |
|-------|------------------|
| parse (Worker, md→mdast) | __ ms |
| convert (mdast→PM, main) | __ ms |
| updateState (DOM create) | __ ms |
| CodeMirror init (296×) — see note | __ ms |
| Scroll FPS (before fix) | __ |
| Tab switch | __ ms |

## Gate decisions (record here)
- Dominant cost: parse / convert / DOM / CodeMirror? → ______
- Phase 2 needed after Phase 1? → decide after Phase 1 re-measure
- Phase 2 technique (chunk+yield vs Worker fromJSON): ______
- 20k `T_settled < 1s` pursued (C2)? ______
```

> Note on CodeMirror init: 296 `new CMView` calls are inside `updateState`'s NodeView mounts, so they are folded into the `updateState(DOM)` number. To isolate, temporarily comment out `this.initCM(lang)` in `code-block-node-view.ts:133`, re-measure `updateState`, and record the delta. Revert before Phase 1b.

- [ ] **Step 2: Commit**

```bash
git add dev/impl-notes/large-file-perf-baseline.md
git commit -m "docs(§perf-large-file): record Phase 0 baseline measurements"
```

---

## Phase 1a — content-visibility on top-level blocks (CSS only)

`content-visibility: auto` lets the browser skip layout/paint of off-screen blocks. This is the direct fix for scroll/tab stutter and cuts a large share of the open-time DOM cost. No ProseMirror code changes.

### Task 1a.1: Apply content-visibility to editor blocks

**Files:**
- Modify: `src/styles/editor.css`

- [ ] **Step 1: Add the block-level rule**

Add to `src/styles/editor.css` (near the existing virtual-scroll rule at line 1323):

```css
/* §perf-large-file C1: skip layout/paint of off-screen top-level blocks.
   `auto` intrinsic-size lets the browser remember each block's real height
   after first render, so scrollbar size stays stable. */
.tiptap > * {
  content-visibility: auto;
  contain-intrinsic-size: auto 2em;
}

/* Heavy blocks get a larger height estimate to reduce scrollbar jump. */
.tiptap > .code-block-wrapper,
.tiptap > .mermaid-block,
.tiptap > table {
  contain-intrinsic-size: auto 8em;
}
```

- [ ] **Step 2: Verify roundtrip + unit suite unaffected**

Run: `npm test`
Expected: 2356 pass / 5 skip — CSS does not change DOM structure or serialization.

- [ ] **Step 3: Manual verification (the risk surface)**

Run the app, open `CONTEXT.md`, and confirm each works (these are the known content-visibility risk areas):
1. Smooth scroll top→bottom — no long frame drops (compare to baseline FPS).
2. Cursor click on an off-screen-then-scrolled block lands correctly.
3. Backlink/heading navigation (`scrollIntoView` at `use-tab-switching.ts:219-224`) jumps to the right block.
4. Find/Replace (Cmd+F) highlights and scrolls to matches below the fold.
5. Tab switch on a large doc — no full-height jump.

If any of 2-4 break (ProseMirror `coordsAtPos`/`posAtCoords` on skipped content), narrow the rule to heavy blocks only (`.code-block-wrapper`, `.mermaid-block`, `table`) and drop the blanket `.tiptap > *`. Record the decision in the baseline doc.

- [ ] **Step 4: Re-measure open + scroll**

Repeat the Task 0.2 manual measurement. Record post-1a `updateState(DOM)` ms and scroll FPS in the baseline doc.

- [ ] **Step 5: Commit**

```bash
git add src/styles/editor.css dev/impl-notes/large-file-perf-baseline.md
git commit -m "perf(§perf-large-file C1): content-visibility auto on top-level editor blocks"
```

---

## Phase 1b — Lazy NodeView instantiation (CodeMirror + Mermaid)

`CONTEXT.md` has ~296 code blocks; `CodeBlockNodeView` calls `initCM()` in its constructor (`code-block-node-view.ts:133`), creating ~296 `CMView` instances during `updateState`. Defer instantiation until the block first scrolls into view.

### Task 1b.0: IntersectionObserver mock for jsdom

**Files:**
- Modify: `src/test-setup.ts`

- [ ] **Step 1: Add a controllable mock**

Append to `src/test-setup.ts`:

```typescript
// §perf-large-file: jsdom has no IntersectionObserver. Provide a mock whose
// instances are tracked so tests can trigger intersection manually.
class MockIntersectionObserver implements IntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [];
  private cb: IntersectionObserverCallback;
  elements = new Set<Element>();

  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    MockIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.elements.add(el);
  }
  unobserve(el: Element) {
    this.elements.delete(el);
  }
  disconnect() {
    this.elements.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  /** Test helper: fire intersection for all observed elements. */
  triggerIntersect(isIntersecting = true) {
    const entries = [...this.elements].map(
      (target) => ({ target, isIntersecting }) as IntersectionObserverEntry,
    );
    this.cb(entries, this);
  }
}
globalThis.IntersectionObserver =
  MockIntersectionObserver as unknown as typeof IntersectionObserver;
(globalThis as unknown as { MockIntersectionObserver: typeof MockIntersectionObserver }).MockIntersectionObserver =
  MockIntersectionObserver;
```

- [ ] **Step 2: Verify setup loads**

Run: `npx vitest run src/test-setup` (or any single existing test) — `Expected: PASS` (no setup errors).

- [ ] **Step 3: Commit**

```bash
git add src/test-setup.ts
git commit -m "test(§perf-large-file): mock IntersectionObserver in jsdom setup"
```

### Task 1b.1: `onFirstVisible` helper (TDD)

**Files:**
- Create: `src/extensions/nodes/views/lazy-visible.ts`
- Create: `src/extensions/nodes/views/__tests__/lazy-visible.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";

import { onFirstVisible } from "../lazy-visible";

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

describe("onFirstVisible", () => {
  it("runs the callback only after the element intersects, once", () => {
    const el = document.createElement("div");
    const cb = vi.fn();
    onFirstVisible(el, cb);

    expect(cb).not.toHaveBeenCalled();

    const io = MockIntersectionObserver.instances.at(-1)!;
    io.triggerIntersect(true);
    io.triggerIntersect(true);

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("runs immediately when IntersectionObserver is unavailable", () => {
    const saved = globalThis.IntersectionObserver;
    // @ts-expect-error force-undefined for graceful degradation path
    delete globalThis.IntersectionObserver;
    const cb = vi.fn();
    onFirstVisible(document.createElement("div"), cb);
    expect(cb).toHaveBeenCalledTimes(1);
    globalThis.IntersectionObserver = saved;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/extensions/nodes/views/__tests__/lazy-visible.test.ts`
Expected: FAIL with "Cannot find module '../lazy-visible'" (or `onFirstVisible is not a function`).

- [ ] **Step 3: Write the helper**

Create `src/extensions/nodes/views/lazy-visible.ts`:

```typescript
// §perf-large-file: run a callback the first time an element scrolls into view.
// Used to defer heavy NodeView work (CodeMirror, Mermaid) on large documents.

/**
 * Invokes `cb` once, the first time `el` is near the viewport.
 * Pre-fires 200px early to avoid blank flashes while scrolling.
 * Degrades to immediate invocation when IntersectionObserver is unavailable.
 * Returns a disposer that disconnects the observer.
 */
export function onFirstVisible(el: HTMLElement, cb: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    cb();
    return () => {};
  }
  let fired = false;
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !fired) {
          fired = true;
          io.disconnect();
          cb();
        }
      }
    },
    { rootMargin: "200px 0px" },
  );
  io.observe(el);
  return () => io.disconnect();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/extensions/nodes/views/__tests__/lazy-visible.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extensions/nodes/views/lazy-visible.ts src/extensions/nodes/views/__tests__/lazy-visible.test.ts
git commit -m "feat(§perf-large-file): add onFirstVisible lazy-mount helper"
```

### Task 1b.2: Defer CodeMirror init until visible

**Files:**
- Modify: `src/extensions/nodes/views/code-block-node-view.ts`
- Create: `src/extensions/nodes/views/__tests__/code-block-lazy.test.ts`

- [ ] **Step 1: Add the lazy fields + import**

Add the import near the top of `code-block-node-view.ts` (after line 32):

```typescript
import { onFirstVisible } from "./lazy-visible";
```

Add two private fields to the class (next to `cmView` at line 37):

```typescript
  private cmInitialized = false;
  private lazyDispose: (() => void) | null = null;
```

- [ ] **Step 2: Replace the eager init in the constructor**

In the constructor, replace line 133 (`this.initCM(lang);`) with a placeholder + deferral:

```typescript
    // §perf-large-file: defer CodeMirror creation until the block is near the
    // viewport. Show the raw code as a lightweight placeholder until then.
    const placeholder = document.createElement("pre");
    placeholder.classList.add("code-block-placeholder");
    placeholder.textContent = node.textContent;
    cmContainer.appendChild(placeholder);
    this.lazyDispose = onFirstVisible(wrapper, () => this.ensureCM(lang));
```

- [ ] **Step 3: Add `ensureCM()` and make `initCM` clear the placeholder**

Add this method to the class (e.g. before `initCM`):

```typescript
  /** Create CodeMirror if not already created (idempotent). */
  private ensureCM(language: string) {
    if (this.cmInitialized || this.destroyed) return;
    this.cmInitialized = true;
    if (this.lazyDispose) {
      this.lazyDispose();
      this.lazyDispose = null;
    }
    this.cmContainer.replaceChildren(); // drop the placeholder
    void this.initCM(language);
  }
```

- [ ] **Step 4: Force-init when the block becomes active**

CodeMirror must exist before edit/selection. Guard the entry points. In `selectNode()` (line 178) and `setSelection()` (line 189), add `this.ensureCM((this.node.attrs.language as string) || "")` as the first line. In `update()` (line 204), if `this.cmView` is null and content changed, call `ensureCM` before the sync block. In `destroy()` (line 160), dispose the observer:

```typescript
  destroy() {
    this.destroyed = true;
    if (this.lazyDispose) {
      this.lazyDispose();
      this.lazyDispose = null;
    }
    if (this.settingsUnsub) {
      this.settingsUnsub();
      this.settingsUnsub = null;
    }
    if (this.cmView) {
      this.cmView.destroy();
      this.cmView = null;
    }
  }
```

- [ ] **Step 5: Add the placeholder style**

In `src/styles/editor.css`, near the code-block styles, add:

```css
.code-block-placeholder {
  margin: 0;
  padding: 0.75em 1em;
  font-family: var(--font-mono, monospace);
  font-size: 0.9em;
  white-space: pre;
  overflow-x: auto;
  color: var(--color-text-muted);
}
```

- [ ] **Step 6: Write the lazy-instantiation test**

Create `src/extensions/nodes/views/__tests__/code-block-lazy.test.ts`. (This test mounts the editor with the real CodeBlock node and asserts no `.cm-editor` exists before intersection, and one appears after. Build the editor with the project's `createEditor` test helper from `src/pipeline` — see `src/extensions/CLAUDE.md` for the pattern — loading at minimum the `CodeBlock` extension, set content to a fenced code block, then:)

```typescript
import { describe, expect, it } from "vitest";

import { createEditor, parseMarkdown } from "../../../../pipeline";
import { CodeBlock } from "../../code-block";

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

describe("CodeBlock lazy CodeMirror", () => {
  it("does not create a CodeMirror view until the block is visible", async () => {
    const editor = createEditor([CodeBlock]);
    editor.commands.setContent(parseMarkdown("```ts\nconst x = 1;\n```"));

    const dom = editor.view.dom as HTMLElement;
    expect(dom.querySelector(".cm-editor")).toBeNull();
    expect(dom.querySelector(".code-block-placeholder")).not.toBeNull();

    MockIntersectionObserver.instances.at(-1)!.triggerIntersect(true);
    await Promise.resolve(); // initCM is async (awaits language ext)

    expect(dom.querySelector(".cm-editor")).not.toBeNull();
    editor.destroy();
  });
});
```

> If `createEditor`'s exact signature differs, read `src/pipeline/index.ts` and the existing extension tests in `src/extensions/__tests__/` for the canonical editor-construction pattern, and match it.

- [ ] **Step 7: Run the test + full suite**

Run: `npx vitest run src/extensions/nodes/views/__tests__/code-block-lazy.test.ts`
Expected: PASS.
Run: `npm test`
Expected: 2356+ pass / 5 skip (existing code-block roundtrip tests still green).

- [ ] **Step 8: Manual verification + re-measure**

Open `CONTEXT.md` in dev: confirm only on-screen code blocks become editable CodeMirror, scrolling upgrades placeholders smoothly, editing/clicking a code block still works. Re-measure `updateState(DOM)` — record the drop in the baseline doc.

- [ ] **Step 9: Commit**

```bash
git add src/extensions/nodes/views/code-block-node-view.ts src/extensions/nodes/views/__tests__/code-block-lazy.test.ts src/styles/editor.css dev/impl-notes/large-file-perf-baseline.md
git commit -m "perf(§perf-large-file): lazy-instantiate CodeMirror on first visibility"
```

### Task 1b.3: Defer Mermaid render until visible

`MermaidBlockView` (`mermaid-block-view.tsx`) is a React NodeView with a `wrapperRef` (line 36) and an effect that calls `renderMermaid` on mount (line ~76). Gate that first render behind visibility.

**Files:**
- Modify: `src/extensions/nodes/mermaid-block-view.tsx`

- [ ] **Step 1: Add a visible flag gated by IntersectionObserver**

Add state + an effect inside `MermaidBlockView` (near the other `useState`/`useEffect` hooks, after line 48):

```typescript
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setIsVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
```

- [ ] **Step 2: Guard the initial render effect**

In the mount effect that calls `renderMermaid` (line ~64-97), add `if (!isVisible) return;` at the top of the effect body and add `isVisible` to its dependency array. (The edit-driven re-render effect at line ~175 already fires only on code change and may stay as-is, but also gate it on `isVisible` so a never-visible block does zero Mermaid work.)

- [ ] **Step 3: Verify**

Run: `npm test -- mermaid` (or `npx vitest run` for the mermaid test file)
Expected: PASS — existing mermaid tests green. If a test asserts immediate render, it must trigger intersection via `MockIntersectionObserver` first; update that test accordingly.

- [ ] **Step 4: Manual check**

Open a doc with a Mermaid diagram below the fold; confirm it renders when scrolled to, not on open.

- [ ] **Step 5: Commit**

```bash
git add src/extensions/nodes/mermaid-block-view.tsx
git commit -m "perf(§perf-large-file): defer Mermaid render until block is visible"
```

---

## Phase 1 Verification Gate

- [ ] `npm test` → all green (2356+ pass / 5 skip).
- [ ] `cargo test` (in `src-tauri`) → 163 pass.
- [ ] Roundtrip suite green (no serialization regressions).
- [ ] Baseline doc updated with post-Phase-1 numbers: `updateState(DOM)` ms, scroll FPS, tab-switch ms for `CONTEXT.md`.
- [ ] Decision recorded: did Phase 1 alone hit `T_freeze<100ms` + `T_interactive<1s` for 20k? → if YES, Phase 2 may be deferred/dropped; if NO, proceed to the Phase 2 plan.

---

## Gated Follow-up Roadmap (separate plans, after Phase 0/1 numbers)

These are **not** detailed here by design — their tasks depend on measured data.

- **Phase 2 — Async conversion.** Trigger: Phase 1 re-measure still shows `convert(mdast→PM)` blocking past target. Technique chosen by Phase 0 split:
  - convert-dominant & moderate → **chunk + yield**: convert `mdastBlocksToPmNodes` in slices with `scheduler.postTask`/`requestIdleCallback`, single `updateState` after.
  - convert-dominant & severe → **Worker `fromJSON`**: build PM-node JSON in the Worker (refactor transformers to be schema-agnostic), main thread does `Node.fromJSON`. Higher risk.
- **Phase 3 — Tab/updateState.** Trigger: tab-switch still >100ms after Phase 1. Investigate lighter cached-state application at `use-tab-switching.ts:250`.
- **Phase 4 — Plugin cleanup (Phase A).** Lower priority (typing, not the user's symptom): `prompt-highlight`/`prompt-lint` Skills guard (A2), `find-replace` incremental (A3), `list-atom-fix`/`block-id-decoration` map-pattern completeness (A1).
- **C2 — Chunked/virtual document.** Only if Phase 0 shows the DOM-node-creation floor alone exceeds the `T_settled<1s` budget AND the user opts into the higher-risk target.

---

## Self-Review

**Spec coverage** (design doc → tasks):
- Phase 0 measurement (parse/convert/DOM/CM split) → Tasks 0.1–0.3 ✓
- C1 content-visibility → Task 1a.1 ✓
- 1b lazy NodeView (CodeMirror 296 + Mermaid) → Tasks 1b.0–1b.3 ✓
- 3-tier targets + invariant (tests green, roundtrip) → Phase 1 Verification Gate ✓
- Phase 2/3/4 + C2 + measurement-gated decisions → Gated Follow-up Roadmap ✓ (intentionally deferred per user's "measure-first" choice)

**Placeholder scan:** No "TBD/implement later". The Phase 2 technique branch is a documented measurement gate, not a placeholder; Task 1b.2 Step 6 references reading `createEditor`'s real signature rather than guessing it (anti-fabrication, per project rule).

**Type consistency:** `onFirstVisible(el, cb): () => void` used identically in helper, test, and `code-block-node-view.ts`. `ensureCM(language)` / `cmInitialized` / `lazyDispose` consistent across constructor, `ensureCM`, `destroy`, and the selection guards. `MockIntersectionObserver.triggerIntersect` matches the test usage. `parseMdast`/`mdastBlocksToPmNodes`/`markdownToProsemirror` signatures match `md-to-pm.ts`/`parse-mdast.ts`.

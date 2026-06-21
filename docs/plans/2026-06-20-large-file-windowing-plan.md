# Large-File Windowing Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Window a ~3,264-block document so only viewport blocks stay in layout flow, cutting per-keystroke `view.dispatch` from 53 ms toward single digits while preserving scroll height, export, search, and roundtrip.

**Architecture:** Off-screen top-level blocks get `display:none` (the only primitive that removes layout cost — content-visibility is a proven dead end). Light blocks are wrapped in a generic NodeView (PM won't clobber its `dom`); heavy blocks (code/math/mermaid/query/table) are toggled directly on their own React NodeView `dom`. A per-editor controller maintains a node-keyed height map, computes the visible band from `scrollTop` on scroll (rAF-throttled) — never on typing — toggles only the delta, and reserves off-screen height with `.tiptap::before/::after` pseudo-element spacers (`--vtop`/`--vbot`). Visible-window detection is scroll-driven band math (IntersectionObserver is incompatible with `display:none`).

**Tech Stack:** Tiptap/ProseMirror v2 (`@tiptap/core`, `@tiptap/pm/{model,state,view}`), React 19, Vitest, TypeScript strict. Design spec: [`docs/plans/2026-06-20-large-file-windowing-design.md`](./2026-06-20-large-file-windowing-design.md).

**Key constraints (from prior sessions — see C4 handoff):**
- jsdom CANNOT exercise layout/zoom/scroll/IO — those tasks are GUI-verified by the user (exact console snippets provided). Pure geometry IS unit-tested.
- `.editor-area-scroll` has CSS `zoom: var(--editor-zoom,1)` (`layout.css:124`) — `offsetTop`/`offsetHeight` are layout-space, `getBoundingClientRect()` is visual-space, `scrollTop`'s space is unknown until Task 1 resolves it. Wrong choice = blank screen (the historical failure mode).
- Two editors exist: the shared `editor` and the `createKeepaliveEditor()` large-doc editor (separate `Schema`, threshold 500 blocks). Windowing auto-engages on the keep-alive editor.
- `window.__baramEditor` (DEV) exposes the active editor; `__baramPerf` exposes `inputLatency()` / `txBreakdown()` / `reset()`. WKWebView has NO `longtask` PerformanceObserver.
- Commit subjects lowercase, English, tag `§perf-large-file C4`. pre-commit runs prettier + eslint `--max-warnings=0` (perfectionist import/member sorting) — run `eslint --fix` / `prettier --write` and retry on failure. Vitest only (`npx vitest run`), never jest. Never commit `CONTEXT.md`.

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `src/extensions/plugins/viewport-virtualize-geometry.ts` | PURE logic: `HeightMap`, `computeBand`, `computeSpacers`, `computeDelta`. No DOM. Fully unit-tested. | Create |
| `src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts` | Unit tests for the geometry module. | Create |
| `src/extensions/plugins/viewport-virtualize.ts` | DOM layer: generic NodeView factory, `VirtualizeController`, `ViewportVirtualize` extension, `revealBlock`, `withVirtualizationSuspended`. | Create |
| `src/styles/editor.css` | `.tiptap::before/::after` spacer rules. | Modify |
| `src/stores/settings/store.ts` (+ types) | `virtualizeLargeDocs` flag (default `true`) + migration. | Modify |
| `src/extensions/index.ts` | Register `ViewportVirtualize` in `createBaramExtensions()`. | Modify |
| `src/utils/export/export-html.ts` | Wrap clone in `withVirtualizationSuspended`. | Modify |
| Nav callers (search / backlink / outline / find-replace) | Call `revealBlock(pos)` before `scrollIntoView` to off-screen targets. | Modify |

> **Why split geometry out:** the math (height accumulation, band, spacer sums, delta) is the only part jsdom can fully test, and isolating it keeps `viewport-virtualize.ts` (DOM) under the ~300-line guideline. This mirrors how `syntax-reveal.ts` is split into focused siblings.

---

## Task 1: Step-0 coordinate spike (GUI, user-run — GATES all geometry)

**No code change.** Determines which coordinate space `scrollTop` lives in under CSS `zoom`, so the controller (Task 10) measures heights with the matching API. This is the single most failure-prone unknown; resolve it first.

- [ ] **Step 1: Run the editor and open the fixture**

```
npm run tauri dev   →  open CONTEXT.md  →  open DevTools console
```

- [ ] **Step 2: Run the coordinate probe**

```js
const sc = document.querySelector('.editor-area-scroll');
sc.scrollTop = 4000;                                  // scroll to a known offset
const zoom = parseFloat(getComputedStyle(sc).zoom) || 1;
const blocks = [...document.querySelectorAll('.editor-area-scroll .tiptap > *')];
// pick a block near the top of the current viewport
const probe = blocks.find(b => b.getBoundingClientRect().top > 0);
console.log('zoom', zoom);
console.log('scrollTop', sc.scrollTop);
console.log('offsetTop (layout)', probe.offsetTop);
console.log('rect.top (visual, vs scroller top)', probe.getBoundingClientRect().top - sc.getBoundingClientRect().top);
// Relationship test: does (offsetTop - scrollTop) match rect.top, or (offsetTop - scrollTop)*zoom?
console.log('offsetTop - scrollTop', probe.offsetTop - sc.scrollTop);
console.log('(offsetTop - scrollTop) * zoom', (probe.offsetTop - sc.scrollTop) * zoom);
```

- [ ] **Step 3: Record the decision in the C4 handoff**

Interpretation:
- If `rect.top ≈ (offsetTop − scrollTop)` (zoom factored out) → **`scrollTop` is in LAYOUT space** → the controller measures heights with `offsetHeight` and compares against `scrollTop` directly.
- If `rect.top ≈ (offsetTop − scrollTop) * zoom` → **`scrollTop` is in VISUAL space** → divide `offsetTop`/`offsetHeight` by `zoom` (or measure with `getBoundingClientRect().height`, which is already visual) before comparing to `scrollTop`.

Append the result to `docs/impl-notes/large-file-perf-c4-handoff.md` (a one-line "Step-0: scrollTop is LAYOUT/VISUAL space; measure with X" note). No commit needed if only the handoff changed; if you do edit the handoff, commit:

```bash
git add docs/impl-notes/large-file-perf-c4-handoff.md
git commit -m "docs(§perf-large-file C4): record step-0 scrollTop coordinate space"
```

> The geometry module (Tasks 3–5) is space-agnostic — it works on whatever numbers you feed it. Only the controller's `measure()` (Task 10) consumes this decision via a single `MEASURE_DIVIDES_BY_ZOOM` constant.

---

## Task 2: Spacer CSS

**Files:**
- Modify: `src/styles/editor.css`

- [ ] **Step 1: Add the pseudo-element spacer rules**

Add near the top-level `.tiptap` block in `src/styles/editor.css`:

```css
/* §perf-large-file C4: windowing spacers. Pseudo-elements (not DOM nodes) so
   ProseMirror's child reconciliation cannot strip them — a real spacer <div>
   would be removed because PM owns .tiptap's children. Height is 0 unless the
   virtualize controller sets --vtop / --vbot. */
.tiptap::before {
  content: "";
  display: block;
  height: var(--vtop, 0);
}
.tiptap::after {
  content: "";
  display: block;
  height: var(--vbot, 0);
}
```

- [ ] **Step 2: Verify no style regression**

Run: `npx stylelint "src/styles/editor.css"` (if configured) and `npm run dev`, open a SMALL doc — editor renders normally (vars unset → 0 height → no visual change).
Expected: no layout shift on small docs.

- [ ] **Step 3: Commit**

```bash
git add src/styles/editor.css
git commit -m "feat(§perf-large-file C4): add .tiptap windowing spacer pseudo-elements"
```

---

## Task 3: Geometry — `HeightMap` (TDD)

**Files:**
- Create: `src/extensions/plugins/viewport-virtualize-geometry.ts`
- Test: `src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts
import { describe, expect, it } from "vitest";

import { HeightMap } from "../viewport-virtualize-geometry";

describe("HeightMap", () => {
  it("estimates uniformly before measurement", () => {
    const hm = new HeightMap();
    hm.reset(["a", "b", "c"], 20);
    expect(hm.length).toBe(3);
    expect(hm.heightAt(1)).toBe(20);
    expect(hm.offsetAt(0)).toBe(0);
    expect(hm.offsetAt(2)).toBe(40);
    expect(hm.totalHeight).toBe(60);
  });

  it("uses measured heights and recomputes offsets", () => {
    const hm = new HeightMap();
    hm.reset(["a", "b", "c"], 20);
    hm.setHeight(0, 100);
    hm.setHeight(1, 50);
    expect(hm.offsetAt(0)).toBe(0);
    expect(hm.offsetAt(1)).toBe(100);
    expect(hm.offsetAt(2)).toBe(150);
    expect(hm.totalHeight).toBe(170); // 100 + 50 + 20(estimate)
  });

  it("binary-searches the block at a vertical offset", () => {
    const hm = new HeightMap();
    hm.reset(["a", "b", "c", "d"], 100); // offsets 0,100,200,300
    expect(hm.indexAtOffset(0)).toBe(0);
    expect(hm.indexAtOffset(99)).toBe(0);
    expect(hm.indexAtOffset(100)).toBe(1);
    expect(hm.indexAtOffset(250)).toBe(2);
    expect(hm.indexAtOffset(99999)).toBe(3); // clamps to last
  });

  it("preserves measured heights across syncKeys when keys persist", () => {
    const hm = new HeightMap();
    hm.reset(["a", "b", "c"], 20);
    hm.setHeight(1, 80); // measure "b"
    hm.syncKeys(["a", "x", "b", "c"], 20); // "x" inserted before "b"
    expect(hm.length).toBe(4);
    const bIndex = 2;
    expect(hm.heightAt(bIndex)).toBe(80); // "b" kept its measured height
    expect(hm.heightAt(1)).toBe(20); // "x" is a fresh estimate
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts`
Expected: FAIL — `HeightMap` not exported / module missing.

- [ ] **Step 3: Implement `HeightMap`**

```ts
// src/extensions/plugins/viewport-virtualize-geometry.ts
// §perf-large-file C4 — PURE geometry for windowing. No DOM access; fully
// unit-tested. The controller (viewport-virtualize.ts) feeds it measured
// heights and reads back offsets/band/spacers.

interface Entry {
  height: number;
  key: string;
  measured: boolean;
}

/** Node-keyed ordered height map with cumulative offsets + binary search. */
export class HeightMap {
  private dirty = true;
  private entries: Entry[] = [];
  private offsets: number[] = [];
  private total = 0;

  get length(): number {
    return this.entries.length;
  }

  get totalHeight(): number {
    this.rebuild();
    return this.total;
  }

  heightAt(index: number): number {
    return this.entries[index]?.height ?? 0;
  }

  /** First index whose [offset, offset+height) contains `y`; clamps to ends. */
  indexAtOffset(y: number): number {
    this.rebuild();
    const n = this.entries.length;
    if (n === 0) return 0;
    if (y <= 0) return 0;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsets[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  offsetAt(index: number): number {
    this.rebuild();
    return this.offsets[index] ?? this.total;
  }

  reset(keys: string[], estimate: number): void {
    this.entries = keys.map((key) => ({ height: estimate, key, measured: false }));
    this.dirty = true;
  }

  setHeight(index: number, height: number): void {
    const e = this.entries[index];
    if (!e) return;
    if (!e.measured || e.height !== height) {
      e.height = height;
      e.measured = true;
      this.dirty = true;
    }
  }

  /** Re-key after a structural edit, preserving measured heights by key. */
  syncKeys(keys: string[], estimate: number): void {
    const prev = new Map<string, Entry>();
    for (const e of this.entries) if (e.measured) prev.set(e.key, e);
    this.entries = keys.map((key) => {
      const old = prev.get(key);
      return old
        ? { height: old.height, key, measured: true }
        : { height: estimate, key, measured: false };
    });
    this.dirty = true;
  }

  private rebuild(): void {
    if (!this.dirty) return;
    const n = this.entries.length;
    this.offsets = new Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this.offsets[i] = acc;
      acc += this.entries[i].height;
    }
    this.total = acc;
    this.dirty = false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extensions/plugins/viewport-virtualize-geometry.ts src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts
git commit -m "feat(§perf-large-file C4): windowing HeightMap with node-keyed remap"
```

---

## Task 4: Geometry — `computeBand` (TDD)

**Files:**
- Modify: `src/extensions/plugins/viewport-virtualize-geometry.ts`
- Modify: `src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to the test file
import { computeBand, HeightMap } from "../viewport-virtualize-geometry";

describe("computeBand", () => {
  const hm = new HeightMap();
  hm.reset(["a", "b", "c", "d", "e", "f"], 100); // offsets 0,100,...,500; total 600

  it("returns the blocks intersecting [scrollTop-buffer, scrollTop+vh+buffer]", () => {
    // viewport 200..400, buffer 0 → blocks at offsets [200,300] → indices 2,3
    expect(computeBand(200, 200, 0, hm)).toEqual({ first: 2, last: 3 });
  });

  it("expands by buffer", () => {
    // viewport 200..400, buffer 100 → 100..500 → indices 1..4
    expect(computeBand(200, 200, 100, hm)).toEqual({ first: 1, last: 4 });
  });

  it("clamps at the top", () => {
    expect(computeBand(0, 150, 0, hm)).toEqual({ first: 0, last: 1 });
  });

  it("clamps at the bottom", () => {
    expect(computeBand(550, 200, 0, hm)).toEqual({ first: 5, last: 5 });
  });

  it("returns an empty band for an empty map", () => {
    const empty = new HeightMap();
    empty.reset([], 100);
    expect(computeBand(0, 200, 0, empty)).toEqual({ first: 0, last: -1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts`
Expected: FAIL — `computeBand` not exported.

- [ ] **Step 3: Implement `computeBand`**

```ts
// append to viewport-virtualize-geometry.ts
export interface Band {
  first: number;
  last: number;
}

/** Block index range intersecting the buffered viewport. last = -1 when empty. */
export function computeBand(
  scrollTop: number,
  viewportHeight: number,
  buffer: number,
  hm: HeightMap,
): Band {
  const n = hm.length;
  if (n === 0) return { first: 0, last: -1 };
  const top = scrollTop - buffer;
  const bottom = scrollTop + viewportHeight + buffer;
  const first = hm.indexAtOffset(Math.max(0, top));
  // last = last block whose top offset is < bottom
  let last = first;
  while (last + 1 < n && hm.offsetAt(last + 1) < bottom) last++;
  return { first, last };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extensions/plugins/viewport-virtualize-geometry.ts src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts
git commit -m "feat(§perf-large-file C4): computeBand viewport range from height map"
```

---

## Task 5: Geometry — `computeSpacers` + `computeDelta` (TDD)

**Files:**
- Modify: `src/extensions/plugins/viewport-virtualize-geometry.ts`
- Modify: `src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to the test file
import { computeDelta, computeSpacers } from "../viewport-virtualize-geometry";

describe("computeSpacers", () => {
  const hm = new HeightMap();
  hm.reset(["a", "b", "c", "d", "e", "f"], 100); // total 600

  it("reserves height above first and below last", () => {
    // band 2..3 → vtop = offset(2)=200; vbot = total - (offset(3)+h(3)) = 600-400 = 200
    expect(computeSpacers({ first: 2, last: 3 }, hm)).toEqual({ vtop: 200, vbot: 200 });
  });

  it("zero spacers when whole doc visible", () => {
    expect(computeSpacers({ first: 0, last: 5 }, hm)).toEqual({ vtop: 0, vbot: 0 });
  });

  it("zero spacers for empty band", () => {
    expect(computeSpacers({ first: 0, last: -1 }, hm)).toEqual({ vtop: 0, vbot: 0 });
  });
});

describe("computeDelta", () => {
  it("shows the new range and hides what left it", () => {
    // prev 2..4 → next 4..6 : show 5,6 ; hide 2,3
    expect(computeDelta({ first: 2, last: 4 }, { first: 4, last: 6 })).toEqual({
      hide: [2, 3],
      show: [5, 6],
    });
  });

  it("shows the entire next band when there is no prev", () => {
    expect(computeDelta(null, { first: 1, last: 3 })).toEqual({
      hide: [],
      show: [1, 2, 3],
    });
  });

  it("no-ops on an unchanged band", () => {
    expect(computeDelta({ first: 2, last: 4 }, { first: 2, last: 4 })).toEqual({
      hide: [],
      show: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts`
Expected: FAIL — `computeSpacers`/`computeDelta` not exported.

- [ ] **Step 3: Implement both**

```ts
// append to viewport-virtualize-geometry.ts
export function computeSpacers(
  band: Band,
  hm: HeightMap,
): { vbot: number; vtop: number } {
  if (band.last < band.first) return { vbot: 0, vtop: 0 };
  const vtop = hm.offsetAt(band.first);
  const lastBottom = hm.offsetAt(band.last) + hm.heightAt(band.last);
  const vbot = Math.max(0, hm.totalHeight - lastBottom);
  return { vbot, vtop };
}

/** Indices entering (show) and leaving (hide) the band since `prev`. */
export function computeDelta(
  prev: Band | null,
  next: Band,
): { hide: number[]; show: number[] } {
  const inNext = (i: number) => i >= next.first && i <= next.last;
  const show: number[] = [];
  const hide: number[] = [];
  for (let i = next.first; i <= next.last; i++) {
    if (!prev || i < prev.first || i > prev.last) show.push(i);
  }
  if (prev) {
    for (let i = prev.first; i <= prev.last; i++) {
      if (!inNext(i)) hide.push(i);
    }
  }
  return { hide, show };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts`
Expected: PASS (all geometry suites).

- [ ] **Step 5: Commit**

```bash
git add src/extensions/plugins/viewport-virtualize-geometry.ts src/extensions/plugins/__tests__/viewport-virtualize-geometry.test.ts
git commit -m "feat(§perf-large-file C4): computeSpacers + computeDelta windowing math"
```

---

## Task 6: Generic block NodeView factory (light types)

**Files:**
- Create: `src/extensions/plugins/viewport-virtualize.ts`
- Test: `src/extensions/plugins/__tests__/viewport-virtualize-nodeview.test.ts`

> Based on the prior (removed) NodeView in git `b93e94b`, adapted to `display:none`. The controller is stubbed here (filled in Tasks 8–13) so this task is independently testable in jsdom.

- [ ] **Step 1: Write the failing test**

```ts
// src/extensions/plugins/__tests__/viewport-virtualize-nodeview.test.ts
import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { makeBlockNodeView } from "../viewport-virtualize";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "text*",
      toDOM: () => ["p", 0],
      parseDOM: [{ tag: "p" }],
    },
    text: {},
  },
});

function noopController() {
  return { register() {}, unregister() {} } as never;
}

describe("makeBlockNodeView", () => {
  it("renders via the node's own toDOM (faithful passthrough)", () => {
    const node = schema.node("paragraph", null, [schema.text("hi")]);
    const nv = makeBlockNodeView(node, noopController());
    expect(nv.dom.tagName).toBe("P");
    expect(nv.contentDOM).toBe(nv.dom); // <p> is its own content hole
  });

  it("setHidden toggles display:none on the wrapper dom", () => {
    const node = schema.node("paragraph", null, [schema.text("hi")]);
    const nv = makeBlockNodeView(node, noopController());
    nv.setHidden(true);
    expect(nv.dom.style.display).toBe("none");
    nv.setHidden(false);
    expect(nv.dom.style.display).toBe("");
  });

  it("ignores attribute mutations on its own dom but not content edits", () => {
    const node = schema.node("paragraph", null, [schema.text("hi")]);
    const nv = makeBlockNodeView(node, noopController());
    expect(
      nv.ignoreMutation({ type: "attributes", target: nv.dom } as never),
    ).toBe(true);
    const child = nv.contentDOM!.firstChild as Node;
    expect(
      nv.ignoreMutation({ type: "childList", target: child } as never),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/extensions/plugins/__tests__/viewport-virtualize-nodeview.test.ts`
Expected: FAIL — module / `makeBlockNodeView` missing.

- [ ] **Step 3: Implement the NodeView factory + controller interface**

```ts
// src/extensions/plugins/viewport-virtualize.ts
// §perf-large-file C4 — true windowing (display:none + pseudo-element spacers).
// Design: docs/plans/2026-06-20-large-file-windowing-design.md.
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";

import { DOMSerializer } from "@tiptap/pm/model";

/** Light top-level types wrapped by the generic NodeView (PM won't clobber the
 *  wrapper dom's inline style; default-rendered blocks would be clobbered). The
 *  final list is locked by the container-safety spike (Task 7). */
export const LIGHT_VIRTUALIZED_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "horizontalRule",
  "definitionList",
  "callout",
];

/** Heavy top-level types with their own React NodeViews — toggled directly on
 *  their existing dom by the controller, never wrapped. */
export const HEAVY_VIRTUALIZED_TYPES = [
  "codeBlock",
  "mathBlock",
  "mermaidBlock",
  "queryBlock",
  "table",
];

export interface BlockHandle {
  dom: HTMLElement;
  setHidden(hidden: boolean): void;
}

export interface Controller {
  register(handle: BlockHandle): void;
  unregister(handle: BlockHandle): void;
}

export interface BlockNodeView extends NodeView, BlockHandle {
  dom: HTMLElement;
}

export function makeBlockNodeView(
  node: PMNode,
  controller: Controller,
): BlockNodeView {
  const toDOM = node.type.spec.toDOM;
  const rendered = toDOM
    ? DOMSerializer.renderSpec(document, toDOM(node))
    : { contentDOM: null, dom: document.createElement("div") };
  const dom = rendered.dom as HTMLElement;
  const contentDOM = (rendered.contentDOM as HTMLElement | null) ?? undefined;
  let current = node;
  let hidden = false;

  const nv: BlockNodeView = {
    contentDOM,
    dom,
    destroy() {
      controller.unregister(nv);
    },
    ignoreMutation(m) {
      // Ignore only our own style write on the wrapper; never ignore content
      // edits (those target contentDOM children, not `dom`).
      return m.type === "attributes" && m.target === dom;
    },
    setHidden(h: boolean) {
      if (h === hidden) return;
      hidden = h;
      dom.style.display = h ? "none" : "";
    },
    update(newNode: PMNode) {
      if (newNode.type !== current.type || !newNode.sameMarkup(current))
        return false;
      current = newNode;
      return true;
    },
  };
  controller.register(nv);
  return nv;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/extensions/plugins/__tests__/viewport-virtualize-nodeview.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extensions/plugins/viewport-virtualize.ts src/extensions/plugins/__tests__/viewport-virtualize-nodeview.test.ts
git commit -m "feat(§perf-large-file C4): generic block NodeView with display:none setHidden"
```

---

## Task 7: Container-safety spike (GUI, user-run — locks the covered-type list)

**No permanent code change** (temporary wiring, then revert or keep per result). Confirms a container NodeView doesn't break nested heavy-block edit-entry — the failure that forced paragraph+heading-only last time.

- [ ] **Step 1: Temporarily register the extension for containers only**

Add a throwaway extension that wraps `blockquote` + `bulletList` in `makeBlockNodeView` (import from Task 6) and register it in `createBaramExtensions()`. (You can gate it behind `window.__baramFlags?.containerSpike` to flip without rebuild.)

- [ ] **Step 2: Author a probe doc and test edit-entry in the GUI**

```
npm run tauri dev → new doc with:
> $$ E = mc^2 $$           (math inside a blockquote)
> ```mermaid
> graph TD; A-->B;
> ```                       (mermaid inside a blockquote)
- item with `inline code` and a nested ```js block```
```
Click into the math block, the mermaid block, and the nested code block. Confirm each enters edit mode normally (cursor lands, KaTeX/Mermaid source becomes editable).

- [ ] **Step 3: Record the result + lock the type list**

- If edit-entry works for all → keep `LIGHT_VIRTUALIZED_TYPES` as-is (full container coverage). Remove the throwaway spike extension.
- If a specific container breaks edit-entry → try the documented mitigations in order: (a) ensure `ignoreMutation` returns `true` ONLY for `m.attributeName === "style"` on `dom` (not all attribute mutations); (b) ensure `contentDOM` is the correct content hole; (c) do not add `stopEvent`. Re-test.
- If still broken after mitigations → drop that single type from `LIGHT_VIRTUALIZED_TYPES` (it stays in flow — correct, slightly slower) and note it in the C4 handoff.

Commit only the final `LIGHT_VIRTUALIZED_TYPES` decision (if changed) + a handoff note:

```bash
git add src/extensions/plugins/viewport-virtualize.ts docs/impl-notes/large-file-perf-c4-handoff.md
git commit -m "test(§perf-large-file C4): lock windowed container type list via edit-entry spike"
```

---

## Task 8: `VirtualizeController` — skeleton, scroller, zoom

**Files:**
- Modify: `src/extensions/plugins/viewport-virtualize.ts`

> DOM-heavy — verified in the GUI (Task 18), not jsdom. Add the constants + class shell that later tasks fill.

- [ ] **Step 1: Add constants and the controller skeleton**

```ts
// append to viewport-virtualize.ts
import type { EditorView } from "@tiptap/pm/view";

const BUFFER_PX = 1200;
const REMEASURE_MS = 200;
const ESTIMATE_PX = 28;
// Task-1 spike result: true if scrollTop is in VISUAL space (divide layout
// measurements by zoom before comparing). Set from the GUI probe.
const MEASURE_DIVIDES_BY_ZOOM = false;

export class VirtualizeController {
  private destroyed = false;
  private rafPending = false;
  private remeasureTimer: null | ReturnType<typeof setTimeout> = null;
  private scroller: HTMLElement | null = null;
  private view: EditorView | null = null;

  destroy(): void {
    this.destroyed = true;
    if (this.remeasureTimer) clearTimeout(this.remeasureTimer);
    this.scroller?.removeEventListener("scroll", this.onScroll);
  }

  /** Resolve the scroll container lazily (keep-alive editor mounts detached). */
  private ensureScroller(): HTMLElement | null {
    if (this.scroller) return this.scroller;
    const dom = this.view?.dom;
    const sc = dom?.closest<HTMLElement>(".editor-area-scroll") ?? null;
    if (sc) {
      this.scroller = sc;
      sc.addEventListener("scroll", this.onScroll, { passive: true });
    }
    return sc;
  }

  private onScroll = (): void => {
    if (this.rafPending || this.destroyed) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.reconcile();
    });
  };

  private zoom(): number {
    if (!MEASURE_DIVIDES_BY_ZOOM || !this.scroller) return 1;
    return parseFloat(getComputedStyle(this.scroller).zoom) || 1;
  }

  // register/unregister: Task 9; measure: Task 10; reconcile: Task 11;
  // onUpdate: Task 12; setView: below.
  setView(view: EditorView): void {
    this.view = view;
    this.ensureScroller();
  }

  register(_handle: BlockHandle): void {
    /* Task 9 */
  }

  unregister(_handle: BlockHandle): void {
    /* Task 9 */
  }

  reconcile(): void {
    /* Task 11 */
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (unused-param eslint is satisfied by `_`-prefixed stubs; if eslint complains, add `// eslint-disable-next-line` only on the temporary stubs).

- [ ] **Step 3: Commit**

```bash
git add src/extensions/plugins/viewport-virtualize.ts
git commit -m "feat(§perf-large-file C4): VirtualizeController skeleton with lazy scroller + zoom"
```

---

## Task 9: Controller — registration + ordered block discovery

**Files:**
- Modify: `src/extensions/plugins/viewport-virtualize.ts`

> The controller needs an ordered list of ALL top-level block doms (light + heavy) matching doc order. Light blocks register via their NodeView; heavy blocks are read from `.tiptap`'s direct children. The single source of truth for order + count is `.tiptap`'s direct children, mapped to handles.

- [ ] **Step 1: Implement registration + `collectBlocks`**

```ts
// replace the register/unregister stubs in VirtualizeController
private handles = new Map<HTMLElement, BlockHandle>(); // light NodeView doms
private ordered: BlockHandle[] = [];                   // doc-order, all types

register(handle: BlockHandle): void {
  this.handles.set(handle.dom, handle);
}

unregister(handle: BlockHandle): void {
  this.handles.delete(handle.dom);
}

/** Build the doc-order handle list from .tiptap's direct children. Heavy
 *  blocks (no registered NodeView handle) get an ad-hoc handle that toggles
 *  their own dom directly — safe because PM doesn't re-render off-screen
 *  NodeViews. */
private collectBlocks(): BlockHandle[] {
  const root = this.view?.dom as HTMLElement | undefined;
  if (!root) return [];
  const out: BlockHandle[] = [];
  for (const el of Array.from(root.children) as HTMLElement[]) {
    const light = this.handles.get(el);
    if (light) {
      out.push(light);
    } else {
      out.push({
        dom: el,
        setHidden: (h: boolean) => {
          el.style.display = h ? "none" : "";
        },
      });
    }
  }
  this.ordered = out;
  return out;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/extensions/plugins/viewport-virtualize.ts
git commit -m "feat(§perf-large-file C4): controller block registration + doc-order discovery"
```

---

## Task 10: Controller — height measurement (consumes Task-1 spike)

**Files:**
- Modify: `src/extensions/plugins/viewport-virtualize.ts`

- [ ] **Step 1: Add the HeightMap field + `measure`**

```ts
// add import at top:
import {
  type Band,
  computeBand,
  computeDelta,
  computeSpacers,
  HeightMap,
} from "./viewport-virtualize-geometry";

// add fields:
private hm = new HeightMap();
private band: Band | null = null;
private keyOf(el: HTMLElement, i: number): string {
  // Stable-ish per-block key: block-id decoration data attr if present, else index.
  return el.getAttribute("data-block-id") ?? `#${i}`;
}

/** Measure currently-VISIBLE blocks into the height map (offsetHeight is only
 *  meaningful for displayed elements; hidden blocks keep their cached/estimated
 *  height). Call after a load batch and on the debounced post-edit remeasure. */
private measure(): void {
  const blocks = this.collectBlocks();
  const keys = blocks.map((b, i) => this.keyOf(b.dom, i));
  if (this.hm.length === blocks.length) this.hm.syncKeys(keys, ESTIMATE_PX);
  else this.hm.reset(keys, ESTIMATE_PX);
  const z = this.zoom();
  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i].dom;
    if (el.style.display === "none") continue; // can't measure a hidden box
    const h = el.offsetHeight / z;
    if (h > 0) this.hm.setHeight(i, h);
  }
}
```

> If Task 1 found `scrollTop` is VISUAL-space, set `MEASURE_DIVIDES_BY_ZOOM = true` (Task 8) so `offsetHeight / z` and `scrollTop` share a space. If LAYOUT-space, leave it `false` (`z` is 1, division is a no-op).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/extensions/plugins/viewport-virtualize.ts
git commit -m "feat(§perf-large-file C4): controller height measurement into HeightMap"
```

---

## Task 11: Controller — scroll reconcile (band → delta toggle → spacers)

**Files:**
- Modify: `src/extensions/plugins/viewport-virtualize.ts`

- [ ] **Step 1: Implement `reconcile`**

```ts
// replace the reconcile stub
reconcile(): void {
  const sc = this.ensureScroller();
  if (!sc || this.destroyed) return;
  const blocks = this.ordered.length ? this.ordered : this.collectBlocks();
  if (blocks.length === 0) return;
  if (this.hm.length !== blocks.length) this.measure();

  const z = this.zoom();
  const scrollTop = sc.scrollTop / z;
  const viewportH = sc.clientHeight / z;
  const next = computeBand(scrollTop, viewportH, BUFFER_PX, this.hm);
  const { hide, show } = computeDelta(this.band, next);
  for (const i of show) blocks[i]?.setHidden(false);
  for (const i of hide) blocks[i]?.setHidden(true);
  this.band = next;

  const { vbot, vtop } = computeSpacers(next, this.hm);
  const root = this.view?.dom as HTMLElement | undefined;
  root?.style.setProperty("--vtop", `${Math.round(vtop)}px`);
  root?.style.setProperty("--vbot", `${Math.round(vbot)}px`);
}
```

> `--vtop`/`--vbot` are set on `.tiptap` (the editor `view.dom`). The CSS in Task 2 reads them on `.tiptap::before/::after`. If `view.dom` is not `.tiptap`, set on `root.closest('.tiptap') ?? root`; verify the actual class in the GUI.

- [ ] **Step 2: Type-check + run full unit suite**

Run: `npx tsc --noEmit && npx vitest run src/extensions/plugins/__tests__/`
Expected: clean + green (geometry + nodeview suites).

- [ ] **Step 3: Commit**

```bash
git add src/extensions/plugins/viewport-virtualize.ts
git commit -m "feat(§perf-large-file C4): controller scroll reconcile — band, delta toggle, spacers"
```

---

## Task 12: Controller — typing path (zero band work)

**Files:**
- Modify: `src/extensions/plugins/viewport-virtualize.ts`

> The freeze that killed every prior controller was evaluating the band on every transaction. Typing in place does NOT move the window, so a docChanged tx must do NOTHING except schedule a debounced remeasure (heights may have changed).

- [ ] **Step 1: Implement `onUpdate`**

```ts
// add to VirtualizeController
onUpdate(docChanged: boolean): void {
  if (!docChanged || this.destroyed) return;
  // Do NOT evaluate the band here (typing doesn't move the window). Schedule a
  // debounced remeasure of heights only; the next scroll uses fresh heights.
  if (this.remeasureTimer) clearTimeout(this.remeasureTimer);
  this.remeasureTimer = setTimeout(() => {
    this.remeasureTimer = null;
    if (this.destroyed) return;
    this.measure();
    // Recompute spacers in case visible-block heights changed (no toggle work).
    if (this.band) {
      const { vbot, vtop } = computeSpacers(this.band, this.hm);
      const root = this.view?.dom as HTMLElement | undefined;
      root?.style.setProperty("--vtop", `${Math.round(vtop)}px`);
      root?.style.setProperty("--vbot", `${Math.round(vbot)}px`);
    }
  }, REMEASURE_MS);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/extensions/plugins/viewport-virtualize.ts
git commit -m "feat(§perf-large-file C4): controller onUpdate does zero band work (debounced remeasure)"
```

---

## Task 13: `ViewportVirtualize` extension + activation gating

**Files:**
- Modify: `src/extensions/plugins/viewport-virtualize.ts`

> Wires nodeViews + the plugin. The plugin's `view.update` uses an O(1) reference check (NOT `doc.eq()` — that was a hidden per-keystroke floor, handoff `c76cc6a`). Activation is gated so the controller only does work on large docs and when the setting is on.

- [ ] **Step 1: Implement the extension**

```ts
// append to viewport-virtualize.ts
import type { EditorState } from "@tiptap/pm/state";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const viewportVirtualizeKey = new PluginKey("viewportVirtualize");

export interface ViewportVirtualizeOptions {
  /** Returns true when windowing should be active for this editor. */
  isEnabled: () => boolean;
}

/** The active large-doc controller, for module-level nav/export helpers
 *  (revealBlockInActiveEditor / withVirtualizationSuspended). Set in the
 *  plugin's view() when enabled, cleared on destroy. */
let activeController: VirtualizeController | null = null;

export const ViewportVirtualize = Extension.create<ViewportVirtualizeOptions>({
  name: "viewportVirtualize",

  addOptions() {
    return { isEnabled: () => false };
  },

  addProseMirrorPlugins() {
    const enabled = this.options.isEnabled;
    const controller = new VirtualizeController();
    const nodeViews: Record<
      string,
      (node: PMNode) => NodeView
    > = {};
    for (const type of LIGHT_VIRTUALIZED_TYPES) {
      nodeViews[type] = (node) =>
        enabled()
          ? makeBlockNodeView(node, controller)
          : passthroughNodeView(node);
    }
    return [
      new Plugin({
        key: viewportVirtualizeKey,
        props: { nodeViews },
        view: (view) => {
          if (enabled()) {
            controller.setView(view);
            activeController = controller;
            // First reconcile after the initial load batch settles.
            setTimeout(() => controller.reconcile(), REMEASURE_MS);
          }
          return {
            destroy: () => {
              if (activeController === controller) activeController = null;
              controller.destroy();
            },
            update: (v, prev: EditorState) => {
              if (enabled()) controller.onUpdate(v.state.doc !== prev.doc);
            },
          };
        },
      }),
    ];
  },
});

/** Inert NodeView: renders via toDOM, no controller registration, no hiding. */
function passthroughNodeView(node: PMNode): NodeView {
  const toDOM = node.type.spec.toDOM;
  const rendered = toDOM
    ? DOMSerializer.renderSpec(document, toDOM(node))
    : { contentDOM: null, dom: document.createElement("div") };
  return {
    contentDOM: (rendered.contentDOM as HTMLElement | null) ?? undefined,
    dom: rendered.dom as HTMLElement,
  };
}
```

> Note: registering a `nodeView` changes how a type renders even when inert, so this extension is added ONLY to the large keep-alive editor (Task 16 includes it conditionally) — small docs never get it and are completely untouched. On the large editor with the setting OFF (kill-switch), `enabled()` is false → `passthroughNodeView` renders via `toDOM` with no controller registration and no hiding. Verify large-doc parity with the setting off in the GUI (Task 18).

- [ ] **Step 2: Type-check + unit suite**

Run: `npx tsc --noEmit && npx vitest run src/extensions/plugins/__tests__/`
Expected: clean + green.

- [ ] **Step 3: Commit**

```bash
git add src/extensions/plugins/viewport-virtualize.ts
git commit -m "feat(§perf-large-file C4): ViewportVirtualize extension with gated activation + O(1) update"
```

---

## Task 14: `revealBlock` + navigation hooks

**Files:**
- Modify: `src/extensions/plugins/viewport-virtualize.ts`
- Modify: nav callers (global search, backlinks, outline, find-replace) — exact files found via grep in Step 1.

> A `display:none` target has no geometry, so programmatic nav must reveal it first. Expose `revealBlock(pos)` and a module-level accessor so nav code can call it.

- [ ] **Step 1: Confirm the editor-doc nav callers**

The sites that navigate to an editor DOC POSITION (the only ones where an off-screen `display:none` target needs revealing) are:
- `src/components/sidebar/Outline.tsx:62` — `editor.commands.setTextSelection(h.pos + 1)` then `domNode.node.scrollIntoView(...)`.
- `src/components/command/QuickSwitcher.tsx:399-400` — `.setTextSelection(pos).scrollIntoView()`.
- `src/components/editor/FindReplaceBar.tsx:121` and `:132` — find match navigation.
- `src/components/sidebar/BookmarkPanel.tsx:206` — `heading.scrollIntoView(...)` to a heading DOM node.

Re-confirm with: `grep -rn "setTextSelection\|scrollIntoView" src/components/sidebar/Outline.tsx src/components/command/QuickSwitcher.tsx src/components/editor/FindReplaceBar.tsx src/components/sidebar/BookmarkPanel.tsx`
(All other `scrollIntoView` hits — menus, TabBar, AIChatPanel, etc. — scroll their own UI lists, NOT the editor doc; skip them.)

- [ ] **Step 2: Add `revealBlock` to the controller + a registry**

```ts
// add to VirtualizeController
/** Force the window to include the block at doc position `pos`, then reconcile.
 *  Call before scrollIntoView to an off-screen target. */
revealBlock(pos: number): void {
  const blocks = this.collectBlocks();
  if (!blocks.length || !this.view) return;
  // Map pos → top-level child index.
  const $pos = this.view.state.doc.resolve(Math.min(pos, this.view.state.doc.content.size));
  const index = $pos.depth === 0 ? 0 : $pos.index(0);
  // Temporarily widen the band to include `index` so the block has geometry.
  const first = Math.max(0, index - 5);
  const last = Math.min(blocks.length - 1, index + 5);
  for (let i = first; i <= last; i++) blocks[i]?.setHidden(false);
  this.band = null; // force a full delta on the next reconcile
  this.reconcile();
}

// module-level export (activeController is declared + wired in Task 13's
// extension view()/destroy(); this just reads it).
export function revealBlockInActiveEditor(pos: number): void {
  activeController?.revealBlock(pos);
}
```

- [ ] **Step 3: Call `revealBlockInActiveEditor` from each nav site**

At each site from Step 1, call `revealBlockInActiveEditor(targetPos)` BEFORE the existing `setTextSelection`/`scrollIntoView`, using that site's position variable:
- `Outline.tsx:62` → `revealBlockInActiveEditor(h.pos + 1)` before `setTextSelection(h.pos + 1)`.
- `QuickSwitcher.tsx:399` → `revealBlockInActiveEditor(pos)` before `.setTextSelection(pos)`.
- `FindReplaceBar.tsx` → reveal the current match's `from` position before its `scrollIntoView`.
- `BookmarkPanel.tsx:206` → it has a heading DOM node; derive the pos via `editor.view.posAtDOM(heading, 0)` and `revealBlockInActiveEditor(pos)` before `heading.scrollIntoView(...)`.

```ts
import { revealBlockInActiveEditor } from "../../extensions/plugins/viewport-virtualize"; // adjust relative path per file
// ...
revealBlockInActiveEditor(targetPos);
// existing setTextSelection + scrollIntoView follows
```

> `revealBlockInActiveEditor` is a no-op when no large-doc controller is active (small docs / setting off), so adding it is safe everywhere.

- [ ] **Step 4: Type-check + unit suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + green (no behavior change when inactive — `activeController` is null on small docs).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(§perf-large-file C4): revealBlock + nav hooks for off-screen targets"
```

---

## Task 15: Settings flag `virtualizeLargeDocs` (default on)

**Files:**
- Modify: `src/stores/settings/store.ts` (+ its settings type + version bump/migration)

- [ ] **Step 1: Confirm the settings shape + version**

Current state (verified): `persist` at `store.ts:36`, `version: 11` at `store.ts:116`, `migrate` at `store.ts:117`. Re-confirm with `grep -n "version:\|migrate\|virtualize" src/stores/settings/store.ts` and locate the settings interface/type the store implements.

- [ ] **Step 2: Add the flag + migration (version 11 → 12)**

Add `virtualizeLargeDocs: boolean` to the settings interface/type (default `true`), a setter, bump the persist `version` to `12`, and in `migrate` fill the default for older states:

```ts
// in the settings interface/type
virtualizeLargeDocs: boolean;
setVirtualizeLargeDocs: (v: boolean) => void;

// in the store creator (defaults)
virtualizeLargeDocs: true,
setVirtualizeLargeDocs: (v) => set({ virtualizeLargeDocs: v }),

// version: 11 → 12 ; inside migrate(persisted, version):
if (version < 12) {
  (persisted as Record<string, unknown>).virtualizeLargeDocs ??= true;
}
```

> Match the exact migrate idiom already used at `store.ts:117` (it receives `(persisted, version)`); mirror how an existing field default is backfilled there.

- [ ] **Step 3: Verify the store migrates cleanly**

Run: `npx vitest run src/stores/settings`
Expected: existing settings tests PASS (add one asserting the default is `true` and migration fills it).

- [ ] **Step 4: Commit**

```bash
git add src/stores/settings/
git commit -m "feat(§perf-large-file C4): add virtualizeLargeDocs setting (default on) + migration"
```

---

## Task 16: Register in `createBaramExtensions` (auto-on for large docs)

**Files:**
- Modify: `src/extensions/index.ts`

- [ ] **Step 1: Inspect where the large-doc signal is available**

Run: `grep -n "createBaramExtensions\|LARGE_DOC\|keepalive\|isLarge\|Fold," src/extensions/index.ts src/hooks/use-large-doc-keepalive.ts`
Expected: the `createBaramExtensions` signature + how the keep-alive editor is created. Decide how to pass "this editor is the large keep-alive editor" + the setting into `isEnabled`.

- [ ] **Step 2: Add the extension with `isEnabled` wired to setting + large-doc flag**

```ts
// in createBaramExtensions(opts), after Fold — add CONDITIONALLY so small docs
// never get the extension (and never get its NodeViews):
import { ViewportVirtualize } from "./plugins/viewport-virtualize";
import { useSettingsStore } from "../stores/settings/store"; // adjust path
// ...
...(opts?.isLargeKeepaliveEditor
  ? [
      ViewportVirtualize.configure({
        // runtime kill-switch only; the construction-time large-doc gate is
        // this conditional inclusion.
        isEnabled: () => useSettingsStore.getState().virtualizeLargeDocs,
      }),
    ]
  : []),
```

> The shared (small-doc) editor calls `createBaramExtensions()` with no flag → extension absent → zero impact. The keep-alive editor calls `createBaramExtensions({ isLargeKeepaliveEditor: true })` (set in `createKeepaliveEditor()`). If `createBaramExtensions` doesn't take an options param, add `opts?: { isLargeKeepaliveEditor?: boolean }` (default absent) — verify the existing signature via the Step-1 grep before editing.

- [ ] **Step 3: Type-check + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + green (2460+ pass).

- [ ] **Step 4: Commit**

```bash
git add src/extensions/index.ts src/hooks/use-large-doc-keepalive.ts
git commit -m "feat(§perf-large-file C4): auto-enable windowing on the large keep-alive editor"
```

---

## Task 17: Export / print safety

**Files:**
- Modify: `src/utils/export/export-html.ts`
- Modify: `src/extensions/plugins/viewport-virtualize.ts` (add `withVirtualizationSuspended`)

- [ ] **Step 1: Add `withVirtualizationSuspended`**

```ts
// add to viewport-virtualize.ts (module-level; uses only PUBLIC methods, never
// the controller's private `band` field — a free function cannot access TS
// private members).
/** Reveal every block for the duration of `fn` (e.g. export clones the DOM),
 *  then restore the windowed state. Safe no-op when no controller is active. */
export function withVirtualizationSuspended<T>(fn: () => T): T {
  const c = activeController;
  if (!c) return fn();
  c.revealAll();
  try {
    return fn();
  } finally {
    c.rewindow();
  }
}
// add to VirtualizeController (public methods so the helper above can call them):
revealAll(): void {
  for (const b of this.collectBlocks()) b.setHidden(false);
  const root = this.view?.dom as HTMLElement | undefined;
  root?.style.setProperty("--vtop", "0px");
  root?.style.setProperty("--vbot", "0px");
}
/** Re-apply windowing from scratch (after a full reveal). */
rewindow(): void {
  this.band = null;
  this.reconcile();
}
```

- [ ] **Step 2: Wrap the export clone**

In `export-html.ts`, wrap the `editor.view.dom` clone/serialize in `withVirtualizationSuspended(() => { ...existing clone... })`.

- [ ] **Step 3: Run export tests**

Run: `npx vitest run src/utils/export`
Expected: PASS (export output unchanged; on small docs the helper is a no-op).

- [ ] **Step 4: Commit**

```bash
git add src/utils/export/export-html.ts src/extensions/plugins/viewport-virtualize.ts
git commit -m "feat(§perf-large-file C4): withVirtualizationSuspended for complete export/print"
```

---

## Task 18: GUI validation gate (user-run — accept/iterate)

**No code change unless a check fails.** Validates the engine on the real fixture. The user runs these; report results into the C4 handoff.

- [ ] **Step 1: Set the Task-1 constant + build**

Confirm `MEASURE_DIVIDES_BY_ZOOM` matches the Task-1 spike result. `npm run tauri dev` → open CONTEXT.md.

- [ ] **Step 2: Synthetic dispatch bench**

```js
const ed = window.__baramEditor;
function bench(label, n = 50) {
  ed.commands.focus(); ed.commands.setTextSelection(3);
  for (let i = 0; i < 5; i++) ed.view.dispatch(ed.state.tr.insertText("x", ed.state.selection.from));
  const t = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now();
    ed.view.dispatch(ed.state.tr.insertText("x", ed.state.selection.from)); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  console.log(label, "median", t[n >> 1].toFixed(1), "p90", t[Math.floor(n * 0.9)].toFixed(1));
}
// scroll once top→a bit (warms the band), then:
bench("WINDOWED");
const els = [...document.querySelectorAll('.editor-area-scroll .tiptap > *')];
console.log("hidden(display:none):", els.filter(e => e.style.display === "none").length, "/", els.length);
```
Expected: median single digits (vs 53 ms full), a few thousand blocks `display:none`.

- [ ] **Step 3: Run the acceptance checklist** (from design §7.4)

1. Scroll top→bottom: content appears everywhere, no permanent blank gaps.
2. Typing smooth (burst → scroll → burst), no freeze.
3. Click / outline-nav / backlink / find-in-doc to an off-screen target reveals it.
4. Scrollbar + document height correct, no jump.
5. Export/print complete; roundtrip MD→PM→MD unchanged (open, no edits, save, `git diff` the fixture copy = empty).
6. math/mermaid/code/table edit-entry works (incl. nested in a container).
7. `inputLatency` p50 with `__baramPerf.reset()` then a real typed burst — record the number.

- [ ] **Step 4: Record results + iterate**

Append a results block to `docs/impl-notes/large-file-perf-c4-handoff.md`: bench median, `inputLatency` p50, checklist pass/fail. If a check fails, debug (don't guess — trace with evidence) and loop back to the relevant task. If all pass:

```bash
git add docs/impl-notes/large-file-perf-c4-handoff.md
git commit -m "docs(§perf-large-file C4): windowing GUI validation results"
```

---

## Final verification (after Task 18 passes)

```bash
npx vitest run        # all green (2460+ pass)
npx tsc --noEmit      # clean
npx eslint . --max-warnings=0   # clean
git status --short    # only ?? CONTEXT.md
```

Then: PR to `main` (per [[feedback_pr_style]]: motivation, design considerations with the content-visibility→display:none rationale, architecture diagram of the windowing model, bench before/after, GUI checklist results, test results).

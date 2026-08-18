# Graph View Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fcose batch layout with a continuous d3-force simulation so graph nodes never overlap and dragging a node makes its neighbors follow and re-settle (Logseq-style), plus local-graph scope, freeze/re-layout controls, and persisted settings.

**Architecture:** Keep Cytoscape.js as the (canvas) renderer; replace the layout engine with a d3-force simulation (`graph-simulation.ts`) that writes node positions into Cytoscape on every tick. Drag uses the canonical d3 pattern (`fx/fy` pinning + `alphaTarget(0.3).restart()`). `forceCollide` guarantees no overlap. Filters/scopes rebuild the simulation's node/link arrays while preserving positions by node id.

**Tech Stack:** React 19, TypeScript (strict, `verbatimModuleSyntax`), Cytoscape.js 3.33 (kept), **d3-force 3 (new)**, Zustand (+persist/tauriStorage), Vitest.

**Spec:** `dev/superpowers/specs/2026-07-17-graph-view-improvements-design.md` (§30)

## Global Constraints

- TypeScript strict + `verbatimModuleSyntax` — type-only imports MUST use `import type`.
- File names kebab-case; components PascalCase export.
- No bare `useStore()` calls in components — use individual selectors or `useShallow`.
- Single file ≤ ~300 lines target, split at ~500.
- Tests: Vitest via `npm test` (never `npx jest`). Capture exit codes without pipes: `cmd > /tmp/log 2>&1; echo $?`.
- Commits: Conventional Commits in English with § refs (e.g. `feat(§30.2): ...`).
- Backend (Rust) unchanged — `LinkGraph` contract untouched.
- Pre-push hook runs clippy+knip (slow) — push in background if needed; NEVER `--no-verify`.

## Root-cause note (discovered during exploration)

`GraphView.tsx` Effects 4 (drag spring), 5 (hover), and zoom-fade bind Cytoscape events but the Cytoscape instance is created **asynchronously** (lazy import). Effects with `[]`/settings-only deps run before `cyRef.current` exists → early-return → **events are never bound on first mount** (only after a settings change re-runs the effect). This is why drag feels dead. The rewrite binds all cy-event effects with `[cyReady]` deps.

## File Structure

- Create: `src/components/sidebar/graph-simulation.ts` — d3-force wrapper (pure TS, headless-testable)
- Create: `src/components/sidebar/graph-style.ts` — `buildGraphStyle` moved out of GraphView.tsx
- Create: `src/components/sidebar/__tests__/graph-simulation.test.ts`
- Modify: `src/components/sidebar/graph-utils.ts` — add `mergeGraphs` (moved), `localSubgraph` (new BFS)
- Modify: `src/components/sidebar/GraphView.tsx` — rewire to simulation; remove fcose/layout/spring code
- Modify: `src/components/sidebar/GraphSettingsPanel.tsx` — local-depth slider; useShallow fix
- Modify: `src/stores/ui/graph-settings.ts` — scope/localDepth fields + persist middleware
- Modify: `src/components/sidebar/__tests__/graph-view.test.ts` — mergeGraphs + localSubgraph tests
- Modify: `src/vite-env.d.ts` — remove `cytoscape-fcose` module declaration
- Modify: `package.json` — add `d3-force`, `@types/d3-force`; remove `cytoscape-fcose`

---

### Task 1: Branch + extract `graph-style.ts` + move `mergeGraphs` into graph-utils (behavior-preserving refactor)

**Files:**
- Create: `src/components/sidebar/graph-style.ts`
- Modify: `src/components/sidebar/GraphView.tsx` (delete `buildGraphStyle` lines 667-839, `mergeGraphs` lines 872-895; add imports)
- Modify: `src/components/sidebar/graph-utils.ts` (append `mergeGraphs`)
- Test: `src/components/sidebar/__tests__/graph-view.test.ts`

**Interfaces:**
- Produces: `buildGraphStyle(settings: { colorByNamespace: boolean; linkThickness: number; showArrows: boolean }): StylesheetStyle[]` exported from `graph-style.ts`; `mergeGraphs(graphs: LinkGraph[]): LinkGraph` exported from `graph-utils.ts`.

- [ ] **Step 1: Create branch**

```bash
git -C /Users/donghoon.yoo/work/projects/baram checkout -b feature/graph-view-improvements
```

- [ ] **Step 2: Write failing tests for `mergeGraphs`** (append to `graph-view.test.ts`)

```ts
import { mergeGraphs } from "../graph-utils";

describe("mergeGraphs", () => {
  it("dedups nodes and edges across graphs", () => {
    const merged = mergeGraphs([
      { nodes: ["/a.md", "/b.md"], edges: [{ from: "/a.md", to: "/b.md" }] },
      { nodes: ["/b.md", "/c.md"], edges: [{ from: "/a.md", to: "/b.md" }, { from: "/b.md", to: "/c.md" }] },
    ]);
    expect(merged.nodes).toHaveLength(3);
    expect(merged.edges).toHaveLength(2);
  });

  it("preserves crossVault flag on edges", () => {
    const merged = mergeGraphs([
      { nodes: ["/a.md"], edges: [{ from: "/a.md", to: "/x.md", crossVault: true }] },
    ]);
    expect(merged.edges[0].crossVault).toBe(true);
  });

  it("returns empty graph for empty input", () => {
    expect(mergeGraphs([])).toEqual({ nodes: [], edges: [] });
  });
});
```

- [ ] **Step 3: Run to verify fail** — `npm test -- src/components/sidebar/__tests__/graph-view.test.ts` → FAIL (`mergeGraphs` not exported).

- [ ] **Step 4: Move code.**
  - `graph-style.ts`: new file with header comment `// §30 Graph View — cytoscape stylesheet builder`, `import type { StylesheetStyle } from "cytoscape";` + `import type cytoscape from "cytoscape";` (for `cytoscape.Css.Node` casts) and the entire `buildGraphStyle` function body verbatim from GraphView.tsx:667-839, exported.
  - `graph-utils.ts`: append `mergeGraphs` verbatim from GraphView.tsx:872-895 with `export`, but type the accumulator as `const edges: LinkGraph["edges"] = [];` so `crossVault` survives.
  - `GraphView.tsx`: delete both functions; add `import { buildGraphStyle } from "./graph-style";` and add `mergeGraphs` to the existing `./graph-utils` import.

- [ ] **Step 5: Verify** — `npm test -- src/components/sidebar/__tests__/graph-view.test.ts` → PASS; `npm run typecheck > /tmp/tc.log 2>&1; echo $?` → 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(§30): extract graph stylesheet and mergeGraphs from GraphView

- buildGraphStyle → graph-style.ts (no behavior change)
- mergeGraphs → graph-utils.ts, now exported + unit-tested
- fixes crossVault flag type loss in mergeGraphs accumulator"
```

---

### Task 2: `graph-simulation.ts` — d3-force wrapper (TDD, headless)

**Files:**
- Modify: `package.json` (deps)
- Create: `src/components/sidebar/graph-simulation.ts`
- Test: `src/components/sidebar/__tests__/graph-simulation.test.ts`

**Interfaces (Produces — later tasks rely on these exact signatures):**

```ts
export interface ForceSettings { centerForce: number; linkDistance: number; linkForce: number; repelForce: number }
export interface SimNodeInput { id: string; radius: number }
export interface SimLinkInput { source: string; target: string }
export interface SimNode extends SimulationNodeDatum { id: string; radius: number }
export interface SetGraphOptions { alpha?: number; warmupTicks?: number }
export interface GraphSimulation {
  drag(id: string, x: number, y: number): void;
  endDrag(id: string): void;
  getNodes(): ReadonlyArray<SimNode>;
  getPositions(): ReadonlyMap<string, { x: number; y: number }>;
  isFrozen(): boolean;
  reheat(): void;                       // unfreezes + alpha(0.8).restart()
  setFrozen(frozen: boolean): void;     // true → simulation.stop()
  setGraph(nodes: SimNodeInput[], links: SimLinkInput[], opts?: SetGraphOptions): void;
  stop(): void;                         // permanent teardown
  tickSync(iterations: number): void;   // manual ticks + notify (tests, warmup)
  updateForces(settings: ForceSettings): void;
  updateRadii(radii: ReadonlyMap<string, number>): void;
}
export function createGraphSimulation(
  initialSettings: ForceSettings,
  onTick: (nodes: ReadonlyArray<SimNode>) => void,
  opts?: { manual?: boolean },          // manual=true → never auto-restart (tests)
): GraphSimulation
```

- [ ] **Step 1: Install deps**

```bash
cd /Users/donghoon.yoo/work/projects/baram && npm install d3-force && npm install -D @types/d3-force
```

- [ ] **Step 2: Write failing tests** — `__tests__/graph-simulation.test.ts`:

```ts
// §30.2 Graph simulation — headless d3-force tests (no DOM needed)
import { describe, expect, it, vi } from "vitest";

import type { ForceSettings } from "../graph-simulation";

import { createGraphSimulation } from "../graph-simulation";

const SETTINGS: ForceSettings = { centerForce: 0.25, repelForce: 8, linkForce: 0.45, linkDistance: 80 };

function makeSim(onTick = vi.fn()) {
  return createGraphSimulation(SETTINGS, onTick, { manual: true });
}

describe("createGraphSimulation", () => {
  it("separates overlapping nodes (no-overlap guarantee)", () => {
    const sim = makeSim();
    sim.setGraph(
      [
        { id: "a", radius: 10 },
        { id: "b", radius: 10 },
      ],
      [],
    );
    sim.tickSync(300);
    const [a, b] = sim.getNodes();
    const dist = Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
    // collide radius = radius + 6 padding each → min distance 32; allow 1px tolerance
    expect(dist).toBeGreaterThanOrEqual(31);
    sim.stop();
  });

  it("pins the dragged node at the drag position", () => {
    const sim = makeSim();
    sim.setGraph([{ id: "a", radius: 10 }, { id: "b", radius: 10 }], [{ source: "a", target: "b" }]);
    sim.tickSync(50);
    sim.startDrag?.("a"); // startDrag is part of the drag flow below
    sim.drag("a", 500, 0);
    sim.tickSync(50);
    const a = sim.getNodes().find((n) => n.id === "a")!;
    expect(a.x).toBe(500);
    expect(a.y).toBe(0);
    sim.stop();
  });

  it("makes linked neighbors follow a dragged node", () => {
    const sim = makeSim();
    sim.setGraph([{ id: "a", radius: 10 }, { id: "b", radius: 10 }], [{ source: "a", target: "b" }]);
    sim.tickSync(100);
    const bBefore = { ...sim.getNodes().find((n) => n.id === "b")! };
    sim.drag("a", 800, 0);
    sim.tickSync(150);
    const bAfter = sim.getNodes().find((n) => n.id === "b")!;
    // b should have been pulled toward x=800
    expect((bAfter.x ?? 0) - (bBefore.x ?? 0)).toBeGreaterThan(100);
    sim.stop();
  });

  it("releases the pin on endDrag", () => {
    const sim = makeSim();
    sim.setGraph([{ id: "a", radius: 10 }], []);
    sim.drag("a", 100, 100);
    sim.endDrag("a");
    const a = sim.getNodes()[0];
    expect(a.fx).toBeNull();
    expect(a.fy).toBeNull();
    sim.stop();
  });

  it("preserves positions across setGraph (id-based)", () => {
    const sim = makeSim();
    sim.setGraph([{ id: "a", radius: 10 }, { id: "b", radius: 10 }], []);
    sim.tickSync(100);
    const aBefore = { ...sim.getNodes().find((n) => n.id === "a")! };
    sim.setGraph([{ id: "a", radius: 10 }, { id: "c", radius: 10 }], []);
    const aAfter = sim.getNodes().find((n) => n.id === "a")!;
    expect(aAfter.x).toBeCloseTo(aBefore.x ?? 0, 5);
    expect(aAfter.y).toBeCloseTo(aBefore.y ?? 0, 5);
    sim.stop();
  });

  it("seeds new nodes near a positioned link neighbor", () => {
    const sim = makeSim();
    sim.setGraph([{ id: "a", radius: 10 }], []);
    sim.tickSync(10);
    const a = sim.getNodes()[0];
    sim.setGraph(
      [{ id: "a", radius: 10 }, { id: "n", radius: 10 }],
      [{ source: "a", target: "n" }],
    );
    const n = sim.getNodes().find((x) => x.id === "n")!;
    expect(Math.hypot((n.x ?? 0) - (a.x ?? 0), (n.y ?? 0) - (a.y ?? 0))).toBeLessThan(31);
    sim.stop();
  });

  it("applies updated link distance on updateForces", () => {
    const sim = makeSim();
    sim.setGraph([{ id: "a", radius: 4 }, { id: "b", radius: 4 }], [{ source: "a", target: "b" }]);
    sim.updateForces({ ...SETTINGS, linkDistance: 300, linkForce: 1, repelForce: 0, centerForce: 0 });
    sim.tickSync(300);
    const [a, b] = sim.getNodes();
    const dist = Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
    expect(dist).toBeGreaterThan(150);
    sim.stop();
  });

  it("calls onTick with nodes on tickSync", () => {
    const onTick = vi.fn();
    const sim = makeSim(onTick);
    sim.setGraph([{ id: "a", radius: 10 }], []);
    sim.tickSync(1);
    expect(onTick).toHaveBeenCalled();
    expect(onTick.mock.lastCall![0][0].id).toBe("a");
    sim.stop();
  });

  it("tracks frozen state", () => {
    const sim = makeSim();
    expect(sim.isFrozen()).toBe(false);
    sim.setFrozen(true);
    expect(sim.isFrozen()).toBe(true);
    sim.reheat();
    expect(sim.isFrozen()).toBe(false);
    sim.stop();
  });
});
```

Note: `startDrag` in the pin test — the final interface has `startDrag(id: string): void` (sets `fx/fy` to current position + reheats when not manual/frozen). Include it in the interface and test flow; remove the `?.` in the test once implemented.

- [ ] **Step 3: Run to verify fail** — `npm test -- src/components/sidebar/__tests__/graph-simulation.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `graph-simulation.ts`:**

```ts
// §30.2 Graph View — continuous force simulation (d3-force) driving cytoscape positions
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";

export interface ForceSettings {
  centerForce: number; // 0..1 slider
  linkDistance: number; // 30..500 px
  linkForce: number; // 0..1 slider
  repelForce: number; // 0..50 slider
}

export interface SimNodeInput {
  id: string;
  radius: number;
}

export interface SimLinkInput {
  source: string;
  target: string;
}

export interface SimNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

type SimLink = SimulationLinkDatum<SimNode>;

export interface SetGraphOptions {
  /** restart alpha after graph swap (0 = stay stopped) */
  alpha?: number;
  /** synchronous ticks before first paint (initial load) */
  warmupTicks?: number;
}

export interface GraphSimulation {
  drag(id: string, x: number, y: number): void;
  endDrag(id: string): void;
  getNodes(): ReadonlyArray<SimNode>;
  getPositions(): ReadonlyMap<string, { x: number; y: number }>;
  isFrozen(): boolean;
  reheat(): void;
  setFrozen(frozen: boolean): void;
  setGraph(nodes: SimNodeInput[], links: SimLinkInput[], opts?: SetGraphOptions): void;
  startDrag(id: string): void;
  stop(): void;
  tickSync(iterations: number): void;
  updateForces(settings: ForceSettings): void;
  updateRadii(radii: ReadonlyMap<string, number>): void;
}

// Scaling constants — calibrated so default sliders (0.25 / 8 / 0.45 / 80)
// approximate the old fcose feel. §30.2
const REPEL_SCALE = 40;
const REPEL_DISTANCE_MAX = 600;
const CENTER_SCALE = 0.1;
const COLLIDE_PADDING = 6;
const COLLIDE_ITERATIONS = 2;
const DRAG_ALPHA_TARGET = 0.3;
const DEFAULT_SWAP_ALPHA = 0.3;
const RELAYOUT_ALPHA = 0.8;
const NEW_NODE_JITTER = 30;

export function createGraphSimulation(
  initialSettings: ForceSettings,
  onTick: (nodes: ReadonlyArray<SimNode>) => void,
  opts?: { manual?: boolean },
): GraphSimulation {
  const manual = opts?.manual ?? false;
  let nodes: SimNode[] = [];
  let nodeById = new Map<string, SimNode>();
  let frozen = false;
  let settings: ForceSettings = { ...initialSettings };
  /** last known positions — survives setGraph so graphs don't jump on refresh */
  const positions = new Map<string, { x: number; y: number }>();

  const chargeForce = forceManyBody<SimNode>().distanceMax(REPEL_DISTANCE_MAX);
  const xForce = forceX<SimNode>(0);
  const yForce = forceY<SimNode>(0);
  const collideForce = forceCollide<SimNode>((d) => d.radius + COLLIDE_PADDING).iterations(
    COLLIDE_ITERATIONS,
  );
  let linkForceInstance = forceLink<SimNode, SimLink>([]).id((d) => d.id);

  function applyForces(): void {
    chargeForce.strength(-settings.repelForce * REPEL_SCALE);
    xForce.strength(settings.centerForce * CENTER_SCALE);
    yForce.strength(settings.centerForce * CENTER_SCALE);
    linkForceInstance.distance(settings.linkDistance).strength(settings.linkForce);
  }

  function notify(): void {
    for (const n of nodes) {
      positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    }
    onTick(nodes);
  }

  const simulation = forceSimulation<SimNode>([])
    .force("charge", chargeForce)
    .force("x", xForce)
    .force("y", yForce)
    .force("collide", collideForce)
    .force("link", linkForceInstance)
    .on("tick", notify);
  simulation.stop();
  applyForces();

  function restart(alpha: number): void {
    if (manual || frozen) return;
    simulation.alpha(alpha).restart();
  }

  return {
    setGraph(nodeInputs, links, o) {
      nodes = nodeInputs.map((input) => {
        const node: SimNode = { id: input.id, radius: input.radius };
        const prev = positions.get(input.id);
        if (prev) {
          node.x = prev.x;
          node.y = prev.y;
        }
        return node;
      });
      nodeById = new Map(nodes.map((n) => [n.id, n]));
      // Seed brand-new nodes near an already-positioned link neighbor so they
      // grow out of the existing layout instead of appearing at the origin.
      for (const n of nodes) {
        if (n.x !== undefined) continue;
        for (const l of links) {
          const otherId = l.source === n.id ? l.target : l.target === n.id ? l.source : null;
          if (!otherId) continue;
          const other = nodeById.get(otherId);
          if (other?.x !== undefined && other.y !== undefined) {
            n.x = other.x + (Math.random() - 0.5) * NEW_NODE_JITTER;
            n.y = other.y + (Math.random() - 0.5) * NEW_NODE_JITTER;
            break;
          }
        }
        // else: leave undefined → d3 phyllotaxis initial placement
      }
      linkForceInstance = forceLink<SimNode, SimLink>(
        links.map((l) => ({ source: l.source, target: l.target })),
      ).id((d) => d.id);
      simulation.nodes(nodes);
      simulation.force("link", linkForceInstance);
      applyForces();
      const warmup = o?.warmupTicks ?? 0;
      if (warmup > 0) {
        simulation.alpha(1);
        simulation.tick(warmup);
        notify();
      }
      restart(o?.alpha ?? DEFAULT_SWAP_ALPHA);
    },

    startDrag(id) {
      const node = nodeById.get(id);
      if (!node) return;
      node.fx = node.x;
      node.fy = node.y;
      if (!manual && !frozen) simulation.alphaTarget(DRAG_ALPHA_TARGET).restart();
    },

    drag(id, x, y) {
      const node = nodeById.get(id);
      if (!node) return;
      node.fx = x;
      node.fy = y;
      node.x = x;
      node.y = y;
    },

    endDrag(id) {
      const node = nodeById.get(id);
      if (!node) return;
      node.fx = null;
      node.fy = null;
      if (!manual && !frozen) simulation.alphaTarget(0);
    },

    updateForces(next) {
      settings = { ...next };
      applyForces();
      restart(DEFAULT_SWAP_ALPHA);
    },

    updateRadii(radii) {
      for (const n of nodes) {
        const r = radii.get(n.id);
        if (r !== undefined) n.radius = r;
      }
      // re-set the accessor to force forceCollide to re-read radii
      collideForce.radius((d) => d.radius + COLLIDE_PADDING);
      restart(DEFAULT_SWAP_ALPHA);
    },

    reheat() {
      frozen = false;
      if (!manual) simulation.alpha(RELAYOUT_ALPHA).restart();
    },

    setFrozen(next) {
      frozen = next;
      if (frozen) simulation.stop();
    },

    isFrozen() {
      return frozen;
    },

    tickSync(iterations) {
      simulation.tick(iterations);
      notify();
    },

    getNodes() {
      return nodes;
    },

    getPositions() {
      return positions;
    },

    stop() {
      simulation.stop();
      simulation.on("tick", null);
    },
  };
}
```

- [ ] **Step 5: Run tests** — `npm test -- src/components/sidebar/__tests__/graph-simulation.test.ts` → PASS (9 tests). Fix the `startDrag?.` → `startDrag` in the test.

- [ ] **Step 6: Typecheck** — `npm run typecheck > /tmp/tc.log 2>&1; echo $?` → 0.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(§30.2): add d3-force graph simulation module

Continuous force simulation wrapper: forceCollide no-overlap, canonical
fx/fy drag pinning with alphaTarget reheat, position preservation across
graph swaps, neighbor-seeded placement for new nodes. Headless-tested."
```

---

### Task 3: `localSubgraph` BFS utility (TDD)

**Files:**
- Modify: `src/components/sidebar/graph-utils.ts`
- Test: `src/components/sidebar/__tests__/graph-view.test.ts`

**Interfaces:**
- Produces: `localSubgraph(edges: ReadonlyArray<{ source: string; target: string }>, centerId: string, depth: number): Set<string>` — undirected BFS; returns node ids within `depth` hops of `centerId` (center included).

- [ ] **Step 1: Failing tests** (append to `graph-view.test.ts`):

```ts
import { localSubgraph } from "../graph-utils";

describe("localSubgraph", () => {
  const edges = [
    { source: "a", target: "b" },
    { source: "c", target: "b" }, // undirected: b↔c
    { source: "c", target: "d" },
    { source: "e", target: "f" }, // disconnected island
  ];

  it("depth 1 returns center + direct neighbors (both directions)", () => {
    expect(localSubgraph(edges, "b", 1)).toEqual(new Set(["b", "a", "c"]));
  });

  it("depth 2 expands transitively", () => {
    expect(localSubgraph(edges, "a", 2)).toEqual(new Set(["a", "b", "c"]));
    expect(localSubgraph(edges, "b", 2)).toEqual(new Set(["b", "a", "c", "d"]));
  });

  it("unknown center returns only the center", () => {
    expect(localSubgraph(edges, "zzz", 2)).toEqual(new Set(["zzz"]));
  });

  it("depth 0 returns only the center", () => {
    expect(localSubgraph(edges, "b", 0)).toEqual(new Set(["b"]));
  });
});
```

- [ ] **Step 2: Verify fail** — `npm test -- src/components/sidebar/__tests__/graph-view.test.ts` → FAIL.

- [ ] **Step 3: Implement** (append to `graph-utils.ts`):

```ts
/**
 * §30.3 Local graph — undirected BFS from centerId up to `depth` hops.
 * Returns the set of node ids in the local subgraph (center included).
 */
export function localSubgraph(
  edges: ReadonlyArray<{ source: string; target: string }>,
  centerId: string,
  depth: number,
): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, []);
    if (!adjacency.has(e.target)) adjacency.set(e.target, []);
    adjacency.get(e.source)!.push(e.target);
    adjacency.get(e.target)!.push(e.source);
  }

  const visited = new Set<string>([centerId]);
  let frontier = [centerId];
  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return visited;
}
```

- [ ] **Step 4: Verify pass + typecheck** — same commands → PASS / 0.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(§30.3): add localSubgraph BFS utility for local graph scope"
```

---

### Task 4: Rewire GraphView to the simulation (remove fcose)

**Files:**
- Modify: `src/components/sidebar/GraphView.tsx`
- Modify: `src/vite-env.d.ts` (delete `declare module "cytoscape-fcose"` block, lines 8-12)
- Modify: `package.json` (`npm uninstall cytoscape-fcose`)

**Interfaces:**
- Consumes: `createGraphSimulation`, `GraphSimulation`, `ForceSettings` from `./graph-simulation` (Task 2 signatures).
- Produces: GraphView with refs `simRef`, `draggedIdRef`, `simSyncedOnceRef`, `lastSyncKeyRef` used by Tasks 5-6.

- [ ] **Step 1: Rewire.** Changes to `GraphView.tsx`:

1. Imports: remove nothing yet from graph-utils; add:
```ts
import type { GraphSimulation, SimLinkInput, SimNodeInput } from "./graph-simulation";
import { createGraphSimulation } from "./graph-simulation";
```

2. Refs (after `cyRef`):
```ts
const simRef = useRef<GraphSimulation | null>(null);
const draggedIdRef = useRef<string | null>(null);
const simSyncedOnceRef = useRef(false);
const lastSyncKeyRef = useRef<string | null>(null);
```

3. **Effect 1** — drop fcose import/registration; create the simulation after `cy`:
```ts
(async () => {
  const { default: cytoscape } = await import("cytoscape");
  if (destroyed || !containerRef.current) return;

  cy = cytoscape({
    container: containerRef.current,
    style: buildGraphStyle({ linkThickness, showArrows, colorByNamespace }),
    layout: { name: "preset" },
    minZoom: 0.1,
    maxZoom: 5,
    wheelSensitivity: 0.3,
  });

  cyRef.current = cy;

  const { centerForce, repelForce, linkForce, linkDistance } =
    useGraphSettingsStore.getState();
  simRef.current = createGraphSimulation(
    { centerForce, repelForce, linkForce, linkDistance },
    (simNodes) => {
      const inst = cyRef.current;
      if (!inst) return;
      inst.batch(() => {
        for (const n of simNodes) {
          if (n.id === draggedIdRef.current) continue;
          const el = inst.getElementById(n.id);
          if (el.length > 0) el.position({ x: n.x ?? 0, y: n.y ?? 0 });
        }
      });
    },
  );
  setCyReady(true);
})();

return () => {
  destroyed = true;
  simRef.current?.stop();
  simRef.current = null;
  if (cy) cy.destroy();
  cyRef.current = null;
  setCyReady(false);
};
```
(`layout: { name: "preset" }` = respect given positions, no auto layout.)

4. **Effect 2** — delete the whole fcose layout `await new Promise…layout.run()` block (lines 267-283). Replace with: give added nodes their last known sim position so refreshes don't flash at origin:
```ts
const posMap = simRef.current?.getPositions();
cy.elements().remove();
cy.add(
  [...nodesWithSize.map((n) => {
    const prev = posMap?.get(n.data.id);
    return prev ? { ...n, position: { ...prev } } : n;
  }), ...edges] as cytoscape.ElementDefinition[],
);
```
Keep orphan marking, `cy.resize()`, `cy.style().update()`, counts, tap binding. Add `cy.fit(undefined, 30)` ONLY via the first sim sync (below), not here.

5. **Effect 3** (force settings) — body becomes:
```ts
simRef.current?.updateForces({ centerForce, repelForce, linkForce, linkDistance });
```
Deps unchanged `[centerForce, repelForce, linkForce, linkDistance]`.

6. **Effect 4** (drag) — replace spring/`handleFree` entirely:
```ts
// Effect 4: drag → pin node in simulation and reheat (Logseq-style follow)
useEffect(() => {
  const cy = cyRef.current;
  if (!cy) return;

  const handleGrab = (evt: EventObject) => {
    const id = evt.target.id() as string;
    draggedIdRef.current = id;
    simRef.current?.startDrag(id);
  };
  const handleDrag = (evt: EventObject) => {
    const pos = evt.target.position();
    simRef.current?.drag(evt.target.id() as string, pos.x, pos.y);
  };
  const handleFree = (evt: EventObject) => {
    draggedIdRef.current = null;
    simRef.current?.endDrag(evt.target.id() as string);
  };

  cy.on("grab", "node", handleGrab);
  cy.on("drag", "node", handleDrag);
  cy.on("free", "node", handleFree);
  return () => {
    cy.off("grab", "node", handleGrab);
    cy.off("drag", "node", handleDrag);
    cy.off("free", "node", handleFree);
  };
}, [cyReady]);
```

7. **Fix dead event bindings:** change deps `[]` → `[cyReady]` on Effect 5 (hover) and the zoom-fade effect (`[textFadeThreshold]` → `[textFadeThreshold, cyReady]`).

8. **Effect 7** (filters) — at the end, after the edge-visibility loop, add the simulation sync:
```ts
// §30.2 Sync visible elements into the simulation (positions preserved by id)
const sim = simRef.current;
if (sim) {
  const visibleNodes: SimNodeInput[] = [];
  cy.nodes().forEach((node) => {
    if (node.style("display") === "none") return;
    visibleNodes.push({ id: node.id(), radius: ((node.data("size") as number) ?? 20) / 2 });
  });
  const visibleEdges: SimLinkInput[] = [];
  cy.edges().forEach((edge) => {
    if (edge.style("display") === "none") return;
    visibleEdges.push({ source: edge.source().id(), target: edge.target().id() });
  });
  const syncKey = `${visibleNodes.map((n) => n.id).sort().join("|")}#${visibleEdges.length}`;
  if (syncKey !== lastSyncKeyRef.current) {
    lastSyncKeyRef.current = syncKey;
    if (!simSyncedOnceRef.current) {
      simSyncedOnceRef.current = true;
      sim.setGraph(visibleNodes, visibleEdges, { warmupTicks: 100, alpha: 0.3 });
      cy.fit(undefined, 30);
    } else {
      sim.setGraph(visibleNodes, visibleEdges, { alpha: 0.3 });
    }
  }
}
```
Add `cyReady` to Effect 7 deps.

9. **Node-size effect** — after the size loop add:
```ts
const radii = new Map<string, number>();
cy.nodes().forEach((node) => radii.set(node.id(), (node.data("size") as number) / 2));
simRef.current?.updateRadii(radii);
```

10. Delete `buildLayoutOptions` (lines 841-870) — no remaining callers.

- [ ] **Step 2: Remove fcose** — delete lines 8-12 of `src/vite-env.d.ts`; run `npm uninstall cytoscape-fcose`.

- [ ] **Step 3: Verify** — `npm run typecheck > /tmp/tc.log 2>&1; echo $?` → 0; `npm test > /tmp/t.log 2>&1; echo $?` → 0; `rg -n "fcose" src/` → no hits.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(§30.2): drive graph layout with continuous d3-force simulation

- replace fcose batch layout: forceCollide prevents node overlap; drag
  pins node (fx/fy) + alphaTarget reheat so neighbors follow and the
  graph re-settles (Logseq-style)
- preserve node positions across index refresh and filter changes
- fix dead cy event bindings (hover/drag/zoom effects ran before the
  async cytoscape instance existed; now keyed on cyReady)
- drop cytoscape-fcose dependency (resolves fcose double-register warning)"
```

---

### Task 5: Local graph scope + depth slider

**Files:**
- Modify: `src/stores/ui/graph-settings.ts`
- Modify: `src/components/sidebar/GraphView.tsx`
- Modify: `src/components/sidebar/GraphSettingsPanel.tsx`

**Interfaces:**
- Produces (store additions): `graphScope: "all" | "current" | "local"`, `setGraphScope(v)`, `localDepth: number` (default 1, range 1-3), `setLocalDepth(v)`. Export `type GraphScope = "all" | "current" | "local"`.

- [ ] **Step 1: Store** — add to `GraphSettingsState` + implementation:
```ts
export type GraphScope = "all" | "current" | "local";
// state
graphScope: GraphScope;
localDepth: number;
setGraphScope: (v: GraphScope) => void;
setLocalDepth: (v: number) => void;
// defaults
graphScope: "current",
localDepth: 1,
// actions
setGraphScope: (v) => set({ graphScope: v }),
setLocalDepth: (v) => set({ localDepth: v }),
```

- [ ] **Step 2: GraphView** — delete `const [graphScope, setGraphScope] = useState…`; read both from the store:
```ts
const graphScope = useGraphSettingsStore((s) => s.graphScope);
const setGraphScope = useGraphSettingsStore((s) => s.setGraphScope);
const localDepth = useGraphSettingsStore((s) => s.localDepth);
```
Data effect (Effect 2): treat `local` like `current` (the `graphScope === "all"` branch condition already does). Effect 7 changes:
  - Scope filter: when `graphScope === "local"` skip the rootPath scope filter (`hasScope = false`) and instead compute:
```ts
let localIds: Set<string> | null = null;
if (graphScope === "local" && activeFilePath) {
  const allEdges: Array<{ source: string; target: string }> = [];
  cy.edges().forEach((edge) => {
    allEdges.push({ source: edge.source().id(), target: edge.target().id() });
  });
  localIds = localSubgraph(allEdges, activeFilePath, localDepth);
}
```
  and in the per-node visibility chain add first: `if (localIds && !localIds.has(id)) visible = false;`
  - Deps: add `activeFilePath`, `localDepth` to Effect 7 deps.
  - Import `localSubgraph` from `./graph-utils`.
  - Header scope buttons — render the group always (not only `contexts.length > 1`); "All" button stays conditional:
```tsx
<div className="graph-scope">
  <button className={…current…} onClick={() => setGraphScope("current")}>Current</button>
  {contexts.length > 1 && (
    <button className={…all…} onClick={() => setGraphScope("all")}>All</button>
  )}
  <button
    className={`graph-scope__btn ${graphScope === "local" ? "graph-scope__btn--active" : ""}`}
    disabled={!activeFilePath}
    onClick={() => setGraphScope("local")}
    title="Show only the active file's neighborhood"
  >
    Local
  </button>
</div>
```

- [ ] **Step 3: Settings panel** — fix the bare-store-call convention violation and add the depth slider. Replace `const s = useGraphSettingsStore();` with:
```ts
import { useShallow } from "zustand/shallow";
const s = useGraphSettingsStore(useShallow((state) => ({ ...all fields/setters used by the panel ...})));
```
(enumerate every field the panel uses — searchQuery/showOrphans/existingFilesOnly/showTags/colorByNamespace/namespaceFilter/nodeSize/linkThickness/textFadeThreshold/showArrows/centerForce/repelForce/linkForce/linkDistance/graphScope/localDepth + their setters). Add below the Namespace row in Filters:
```tsx
{s.graphScope === "local" && (
  <SliderRow label="Local depth" max={3} min={1} onChange={s.setLocalDepth} step={1} value={s.localDepth} />
)}
```

- [ ] **Step 4: Verify** — typecheck 0, `npm test` 0. Manual smoke deferred to final user test.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(§30.3): add local graph scope with depth slider

Scope moves to the settings store; Local mode shows the active file's
N-hop neighborhood (BFS, 1-3) and follows the active tab. Settings
panel switched to useShallow selector per convention."
```

---

### Task 6: Freeze / re-layout controls

**Files:**
- Modify: `src/components/sidebar/GraphView.tsx`
- Modify: `src/styles/graph.css` (only if button spacing needs it — reuse `.graph-view-settings-btn` styles by adding the shared class)

- [ ] **Step 1: State + handlers** in GraphView:
```ts
const [frozen, setFrozen] = useState(false);

const handleToggleFreeze = useCallback(() => {
  setFrozen((prev) => {
    const next = !prev;
    simRef.current?.setFrozen(next);
    return next;
  });
}, []);

const handleReheat = useCallback(() => {
  setFrozen(false);
  simRef.current?.reheat();
}, []);
```

- [ ] **Step 2: Buttons** — inside `.graph-view-header-actions`, before the settings gear:
```tsx
<button
  className="graph-view-settings-btn btn-unstyled"
  onClick={handleToggleFreeze}
  title={frozen ? "Resume physics" : "Freeze layout"}
>
  <svg fill="currentColor" height="14" viewBox="0 0 16 16" width="14">
    {frozen ? (
      <path d="M5 3.5v9l7-4.5-7-4.5z" />
    ) : (
      <path d="M5 3h2.2v10H5zM8.8 3H11v10H8.8z" />
    )}
  </svg>
</button>
<button
  className="graph-view-settings-btn btn-unstyled"
  onClick={handleReheat}
  title="Re-layout"
>
  <svg fill="currentColor" height="14" viewBox="0 0 16 16" width="14">
    <path d="M8 3a5 5 0 1 0 4.9 4H11.4A3.6 3.6 0 1 1 8 4.4V7l4-3-4-3v2z" />
  </svg>
</button>
```

- [ ] **Step 3: Verify** — typecheck 0, tests 0.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(§30.3): add freeze and re-layout controls to graph header"
```

---

### Task 7: Persist graph settings

**Files:**
- Modify: `src/stores/ui/graph-settings.ts`

- [ ] **Step 1: Wrap with persist** (pattern: `src/stores/editor/fold.ts`):
```ts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { tauriStorage } from "../system/tauri-storage";

// transient text filters are session-only; everything else persists
const TRANSIENT_KEYS = new Set(["searchQuery", "namespaceFilter"]);

export const useGraphSettingsStore = create<GraphSettingsState>()(
  persist(
    (set) => ({
      /* …existing state + actions verbatim… */
    }),
    {
      name: "baram-graph-settings",
      version: 1,
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) =>
        Object.fromEntries(
          Object.entries(state).filter(
            ([key, value]) => typeof value !== "function" && !TRANSIENT_KEYS.has(key),
          ),
        ) as Partial<GraphSettingsState>,
    },
  ),
);
```

- [ ] **Step 2: Verify** — typecheck 0, `npm test` 0 (full suite; persist wrapping must not break store-consuming tests).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(§30.4): persist graph settings via tauriStorage

Forces/display/filter toggles + scope/depth survive restarts; transient
text filters (search, namespace) reset per session."
```

---

### Task 8: Size audit + full verification

**Files:**
- Possibly modify: `src/components/sidebar/GraphView.tsx`

- [ ] **Step 1: Measure** — `wc -l src/components/sidebar/GraphView.tsx`. If > 550: extract Effect 2's data-fetch body into `src/components/sidebar/use-graph-data.ts` as `useGraphData(cyReady: boolean, handleNodeTap: (evt: EventObject) => void): { nodeCount: number; edgeCount: number }` — move the entire Effect 2 (including mergeGraphs/vault-map/namespace-color logic and its exact dep array) into the hook unchanged; GraphView consumes the returned counts. If ≤ 550, skip (record actual count in commit message or PR notes).

- [ ] **Step 2: Full gates** (backgroundable):
```bash
npm run typecheck > /tmp/gv-tc.log 2>&1; echo $?
npm test > /tmp/gv-test.log 2>&1; echo $?
npm run lint > /tmp/gv-lint.log 2>&1; echo $?
```
All → 0. Inspect tails of each log on failure.

- [ ] **Step 3: Update local dev docs** — mark `dev/backlog.md:169` fcose warning item resolved (dep removed); note §30 spec doc as canonical in the spec file status line. (dev/ is gitignored — local edit only.)

- [ ] **Step 4: Commit** (only if Step 1 extraction happened)

```bash
git add -A && git commit -m "refactor(§30): extract graph data hook to keep GraphView under size limit"
```

- [ ] **Step 5: STOP — report to user for manual testing + PR approval.** Do NOT create a PR until the user approves.

## Self-Review Notes

- Spec coverage: §30.2 (Tasks 2+4), §30.3 local/freeze (Tasks 3+5+6), §30.4 persistence (Task 7), file-split convention (Tasks 1+8), backlog fcose warning (Task 4+8). P2 items intentionally out of scope per spec §7.
- Types consistent: `SimNodeInput`/`SimLinkInput`/`GraphSimulation` defined once in Task 2, consumed in Tasks 4-6 by those names. `GraphScope` defined in Task 5 store.
- Known cosmetic risk (accepted): one-frame flash of new nodes at origin before first warmup paint on initial load.

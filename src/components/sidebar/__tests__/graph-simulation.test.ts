import type { ForceSettings } from "../graph-simulation";

// §30.2 Graph simulation — headless d3-force tests (no DOM needed)
import { describe, expect, it, vi } from "vitest";

import { createGraphSimulation } from "../graph-simulation";

const SETTINGS: ForceSettings = {
  centerForce: 0.25,
  repelForce: 8,
  linkForce: 0.45,
  linkDistance: 80,
};

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
    // collide radius = radius + 6 padding each → min distance 32; 1px tolerance
    expect(dist).toBeGreaterThanOrEqual(31);
    sim.stop();
  });

  it("pins the dragged node at the drag position", () => {
    const sim = makeSim();
    sim.setGraph(
      [
        { id: "a", radius: 10 },
        { id: "b", radius: 10 },
      ],
      [{ source: "a", target: "b" }],
    );
    sim.tickSync(50);
    sim.startDrag("a");
    sim.drag("a", 500, 0);
    sim.tickSync(50);
    const a = sim.getNodes().find((n) => n.id === "a")!;
    expect(a.x).toBe(500);
    expect(a.y).toBe(0);
    sim.stop();
  });

  it("makes linked neighbors follow a dragged node", () => {
    const sim = makeSim();
    sim.setGraph(
      [
        { id: "a", radius: 10 },
        { id: "b", radius: 10 },
      ],
      [{ source: "a", target: "b" }],
    );
    sim.tickSync(100);
    const bBefore = { ...sim.getNodes().find((n) => n.id === "b")! };
    sim.startDrag("a");
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
    sim.startDrag("a");
    sim.drag("a", 100, 100);
    sim.endDrag("a");
    const a = sim.getNodes()[0];
    expect(a.fx).toBeNull();
    expect(a.fy).toBeNull();
    sim.stop();
  });

  it("preserves positions across setGraph (id-based)", () => {
    const sim = makeSim();
    sim.setGraph(
      [
        { id: "a", radius: 10 },
        { id: "b", radius: 10 },
      ],
      [],
    );
    sim.tickSync(100);
    const aBefore = { ...sim.getNodes().find((n) => n.id === "a")! };
    sim.setGraph(
      [
        { id: "a", radius: 10 },
        { id: "c", radius: 10 },
      ],
      [],
    );
    const aAfter = sim.getNodes().find((n) => n.id === "a")!;
    expect(aAfter.x).toBeCloseTo(aBefore.x ?? 0, 5);
    expect(aAfter.y).toBeCloseTo(aBefore.y ?? 0, 5);
    sim.stop();
  });

  it("seeds new nodes near a positioned link neighbor", () => {
    const sim = makeSim();
    sim.setGraph([{ id: "a", radius: 10 }], []);
    sim.tickSync(10);
    const a = { ...sim.getNodes()[0] };
    sim.setGraph(
      [
        { id: "a", radius: 10 },
        { id: "n", radius: 10 },
      ],
      [{ source: "a", target: "n" }],
    );
    const n = sim.getNodes().find((x) => x.id === "n")!;
    expect(
      Math.hypot((n.x ?? 0) - (a.x ?? 0), (n.y ?? 0) - (a.y ?? 0)),
    ).toBeLessThan(31);
    sim.stop();
  });

  it("applies updated link distance on updateForces", () => {
    const sim = makeSim();
    sim.setGraph(
      [
        { id: "a", radius: 4 },
        { id: "b", radius: 4 },
      ],
      [{ source: "a", target: "b" }],
    );
    sim.updateForces({
      centerForce: 0,
      repelForce: 0,
      linkForce: 1,
      linkDistance: 300,
    });
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
    const lastNodes = onTick.mock.lastCall![0] as Array<{ id: string }>;
    expect(lastNodes[0].id).toBe("a");
    sim.stop();
  });

  it("exposes positions via getPositions after ticking", () => {
    const sim = makeSim();
    sim.setGraph(
      [
        { id: "a", radius: 10 },
        { id: "b", radius: 10 },
      ],
      [],
    );
    sim.tickSync(10);
    const positions = sim.getPositions();
    expect(positions.get("a")).toBeDefined();
    expect(positions.get("b")).toBeDefined();
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

  it("updateRadii changes collide footprint", () => {
    const sim = makeSim();
    sim.setGraph(
      [
        { id: "a", radius: 5 },
        { id: "b", radius: 5 },
      ],
      [],
    );
    sim.tickSync(300);
    sim.updateRadii(
      new Map([
        ["a", 40],
        ["b", 40],
      ]),
    );
    sim.tickSync(300);
    const [a, b] = sim.getNodes();
    const dist = Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
    // collide min distance = (40+6)*2 = 92; 2px tolerance
    expect(dist).toBeGreaterThanOrEqual(90);
    sim.stop();
  });
});

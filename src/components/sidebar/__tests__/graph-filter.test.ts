import type {
  GraphFilterOptions,
  GraphFilterSyncState,
} from "../use-graph-filter";
import type { Core, ElementDefinition } from "cytoscape";

// §30 Graph View — applyGraphFilter unit tests (headless cytoscape, no React)
import cytoscape from "cytoscape";
import { describe, expect, it, vi } from "vitest";

import { createGraphSimulation } from "../graph-simulation";
import { applyGraphFilter } from "../use-graph-filter";

const SETTINGS = {
  centerForce: 0.25,
  repelForce: 8,
  linkForce: 0.45,
  linkDistance: 80,
};

// center → n1, center → n2, n1 → n2 (same-depth edge at depth 1)
const BASE_ELEMENTS: ElementDefinition[] = [
  { data: { id: "center", label: "center", size: 20 } },
  { data: { id: "n1", label: "n1", size: 20 } },
  { data: { id: "n2", label: "n2", size: 20 } },
  { data: { id: "e-c1", source: "center", target: "n1" } },
  { data: { id: "e-c2", source: "center", target: "n2" } },
  { data: { id: "e-nn", source: "n1", target: "n2" } },
];

const LOCAL_OPTS: GraphFilterOptions = {
  activeFilePath: "center",
  excludedPaths: [],
  existingFilesOnly: false,
  graphScope: "local",
  localDepth: 1,
  localIncoming: true,
  localNeighborLinks: true,
  localOutgoing: true,
  namespaceFilter: "",
  scopePaths: [],
  searchQuery: "",
  showOrphans: true,
  showTags: true,
};

function makeHarness() {
  const cy: Core = cytoscape({
    headless: true,
    styleEnabled: true,
    elements: structuredClone(BASE_ELEMENTS),
  });
  const sim = createGraphSimulation(SETTINGS, vi.fn(), { manual: true });
  const syncState: GraphFilterSyncState = {
    lastSyncKey: null,
    syncedOnce: false,
  };
  const apply = (overrides: Partial<GraphFilterOptions> = {}) =>
    applyGraphFilter(cy, sim, { ...LOCAL_OPTS, ...overrides }, syncState);
  const display = (id: string) =>
    cy.getElementById(id).style("display") as string;
  const teardown = () => {
    sim.stop();
    cy.destroy();
  };
  return { apply, cy, display, sim, teardown };
}

describe("applyGraphFilter", () => {
  it("neighbor-links off hides same-depth edges; on restores them", () => {
    const { apply, display, teardown } = makeHarness();

    apply();
    expect(display("e-nn")).toBe("element");

    apply({ localNeighborLinks: false });
    expect(display("e-nn")).toBe("none");
    expect(display("e-c1")).toBe("element");
    expect(display("e-c2")).toBe("element");

    apply({ localNeighborLinks: true });
    expect(display("e-nn")).toBe("element");

    teardown();
  });

  it("re-applies filter state after elements are re-created with identical counts", () => {
    const { apply, cy, display, teardown } = makeHarness();

    apply({ localNeighborLinks: false });
    expect(display("e-nn")).toBe("none");

    // Simulate a link-index refresh: same counts, fresh elements (all
    // display bypasses lost). The hook re-runs via graphEpoch even though
    // node/edge counts are unchanged — re-applying must restore the state.
    cy.elements().remove();
    cy.add(structuredClone(BASE_ELEMENTS));
    expect(display("e-nn")).toBe("element");

    apply({ localNeighborLinks: false });
    expect(display("e-nn")).toBe("none");

    teardown();
  });

  it("resyncs the simulation when edge identity changes but counts stay equal", () => {
    const { apply, cy, sim, teardown } = makeHarness();

    apply();
    const spy = vi.spyOn(sim, "setGraph");

    // Swap one edge for another — edge COUNT is unchanged. A count-based
    // sync key would skip the resync entirely, leaving stale springs and
    // unsimulated new elements (they pile up unmoved and overlap).
    cy.getElementById("e-nn").remove();
    cy.add([
      { data: { id: "e-swap", source: "n2", target: "center" } },
    ] as ElementDefinition[]);

    apply();

    expect(spy).toHaveBeenCalledTimes(1);
    const lastLinks = spy.mock.lastCall![1];
    expect(
      lastLinks.some((l) => l.source === "n2" && l.target === "center"),
    ).toBe(true);
    expect(lastLinks.some((l) => l.source === "n1" && l.target === "n2")).toBe(
      false,
    );

    teardown();
  });

  it("skips the sim resync when nothing visible changed", () => {
    const { apply, sim, teardown } = makeHarness();

    apply();
    const spy = vi.spyOn(sim, "setGraph");
    apply(); // identical inputs → same sync key → no resync
    expect(spy).not.toHaveBeenCalled();

    teardown();
  });

  it("direction toggles narrow the local neighborhood", () => {
    const { apply, display, teardown } = makeHarness();

    // center has only outgoing links; incoming-only leaves just the center
    apply({ localIncoming: true, localOutgoing: false });
    expect(display("center")).toBe("element");
    expect(display("n1")).toBe("none");
    expect(display("n2")).toBe("none");

    apply({ localIncoming: false, localOutgoing: true });
    expect(display("n1")).toBe("element");
    expect(display("n2")).toBe("element");

    teardown();
  });
});

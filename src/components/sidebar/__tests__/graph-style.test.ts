import type { GraphColors } from "../graph-colors";
import type { Core } from "cytoscape";

import cytoscape from "cytoscape";
import { afterEach, describe, expect, it, vi } from "vitest";

// §30 Graph View — cytoscape stylesheet colours
//
// These run a REAL cytoscape instance rather than inspecting the returned objects, because
// the defect being guarded here was invisible to any check that did not involve cytoscape's
// own colour parser: the stylesheet looked correct, and cytoscape silently substituted its
// built-in defaults for every value it could not parse.
import { resolveGraphColors } from "../graph-colors";
import { buildGraphStyle } from "../graph-style";

const SETTINGS = {
  colorByNamespace: false,
  linkThickness: 1,
  showArrows: true,
};

/** One distinct colour per role, so a stylesheet that reads the wrong field fails. */
const COLORS: GraphColors = {
  active: "#010101",
  activeBorder: "#020202",
  crossVault: "#030303",
  edge: "#040404",
  label: "#050505",
  neighbor: "#060606",
  node: "#070707",
  orphan: "#080808",
  pinned: "#090909",
  tag: "#0a0a0a",
};

/** cytoscape reports colours back in its own `rgb(r,g,b)` spelling. */
function rgb(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255})`;
}

let cy: Core | null = null;

function mount(): Core {
  cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements: [
      { data: { id: "n1", label: "one", size: 20 }, group: "nodes" },
      { data: { id: "n2", label: "two", size: 20 }, group: "nodes" },
      {
        data: { id: "ghost", isGhost: true, label: "g", size: 20 },
        group: "nodes",
      },
      {
        data: { id: "tag", isTag: true, label: "#t", size: 20 },
        group: "nodes",
      },
      { data: { id: "e1", source: "n1", target: "n2" }, group: "edges" },
      {
        data: { crossVault: true, id: "e2", source: "n1", target: "n2" },
        group: "edges",
      },
    ],
  });
  cy.style().fromJson(buildGraphStyle(SETTINGS, COLORS)).update();
  return cy;
}

afterEach(() => {
  cy?.destroy();
  cy = null;
});

describe("buildGraphStyle colours", () => {
  it("paints node labels with the label colour", () => {
    // The §30 dark-theme defect: this read rgb(0,0,0) — cytoscape's default — because the
    // stylesheet passed a var() string it could not parse.
    expect(mount().getElementById("n1").style("color")).toBe(rgb(COLORS.label));
  });

  it("paints node bodies and edges with their own colours", () => {
    const graph = mount();
    expect(graph.getElementById("n1").style("background-color")).toBe(
      rgb(COLORS.node),
    );
    expect(graph.getElementById("e1").style("line-color")).toBe(
      rgb(COLORS.edge),
    );
    expect(graph.getElementById("e1").style("target-arrow-color")).toBe(
      rgb(COLORS.edge),
    );
  });

  it.each([
    ["active", "background-color", "active"],
    ["active", "border-color", "activeBorder"],
    ["neighbor", "background-color", "neighbor"],
    ["orphan", "background-color", "orphan"],
    ["pinned", "border-color", "pinned"],
    ["hover", "border-color", "activeBorder"],
    ["hover-neighbor", "border-color", "neighbor"],
    ["search-match", "border-color", "activeBorder"],
  ] as [string, string, keyof GraphColors][])(
    "node.%s takes %s from the %s colour",
    (className, property, key) => {
      const node = mount().getElementById("n1");
      node.addClass(className);
      expect(node.style(property)).toBe(rgb(COLORS[key]));
    },
  );

  it.each([
    ["highlighted", "line-color", "active"],
    ["hover-edge", "line-color", "active"],
  ] as [string, string, keyof GraphColors][])(
    "edge.%s takes %s from the %s colour",
    (className, property, key) => {
      const edge = mount().getElementById("e1");
      edge.addClass(className);
      expect(edge.style(property)).toBe(rgb(COLORS[key]));
    },
  );

  it("paints the selected node with the active colours", () => {
    const node = mount().getElementById("n1");
    node.select();
    expect(node.style("background-color")).toBe(rgb(COLORS.active));
    expect(node.style("border-color")).toBe(rgb(COLORS.activeBorder));
  });

  it("paints ghost, tag and cross-vault elements with their own colours", () => {
    const graph = mount();
    expect(graph.getElementById("ghost").style("border-color")).toBe(
      rgb(COLORS.node),
    );
    expect(graph.getElementById("tag").style("background-color")).toBe(
      rgb(COLORS.tag),
    );
    expect(graph.getElementById("e2").style("line-color")).toBe(
      rgb(COLORS.crossVault),
    );
  });

  it("emits no CSS variable references at all", () => {
    const values = buildGraphStyle(SETTINGS, COLORS).flatMap((rule) =>
      Object.values(rule.style as Record<string, unknown>),
    );
    expect(
      values.filter((v) => typeof v === "string" && v.includes("var(")),
    ).toEqual([]);
  });

  it("accepts every colour a real theme resolves to", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    cy = cytoscape({ headless: true, styleEnabled: true });
    cy.style()
      .fromJson(buildGraphStyle(SETTINGS, resolveGraphColors()))
      .update();

    // cytoscape reports an unusable value rather than throwing, so silence IS the assertion.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("would fall back to black if a colour were a var() string", () => {
    // The discriminator for the tests above: it proves this harness can still detect the
    // original defect, and records why literals are the requirement.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    cy = cytoscape({
      headless: true,
      styleEnabled: true,
      elements: [{ data: { id: "n1" }, group: "nodes" }],
    });
    cy.style()
      .fromJson([
        {
          selector: "node",
          style: { color: "var(--color-graph-label, #d1d5db)" },
        },
      ])
      .update();

    expect(cy.getElementById("n1").style("color")).toBe("rgb(0,0,0)");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("is invalid") as unknown as string,
    );
    warn.mockRestore();
  });
});

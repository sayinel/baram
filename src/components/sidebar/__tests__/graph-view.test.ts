// §30 Graph View — unit tests
import { describe, it, expect } from "vitest";
import {
  displayName,
  toGraphElements,
  nodeSize,
} from "../graph-utils";
import type { LinkGraph } from "../../../ipc/types";

// ─── displayName ─────────────────────────────────────

describe("displayName", () => {
  it("extracts filename without extension", () => {
    expect(displayName("/vault/notes/My Note.md")).toBe("My Note");
  });

  it("handles nested paths", () => {
    expect(displayName("projects/baram/README.md")).toBe("README");
  });

  it("handles file without .md extension", () => {
    expect(displayName("/vault/file.txt")).toBe("file.txt");
  });

  it("handles bare filename", () => {
    expect(displayName("note.md")).toBe("note");
  });

  it("is case-insensitive for .md removal", () => {
    expect(displayName("FILE.MD")).toBe("FILE");
  });
});

// ─── toGraphElements ─────────────────────────────────

describe("toGraphElements", () => {
  it("converts empty graph", () => {
    const graph: LinkGraph = { nodes: [], edges: [] };
    const result = toGraphElements(graph);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("converts nodes with labels and zero degree", () => {
    const graph: LinkGraph = {
      nodes: ["/vault/a.md", "/vault/b.md"],
      edges: [],
    };
    const result = toGraphElements(graph);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].data.id).toBe("/vault/a.md");
    expect(result.nodes[0].data.label).toBe("a");
    expect(result.nodes[0].data.degree).toBe(0);
  });

  it("converts edges and computes degrees", () => {
    const graph: LinkGraph = {
      nodes: ["/vault/a.md", "/vault/b.md", "/vault/c.md"],
      edges: [
        { from: "/vault/a.md", to: "/vault/b.md" },
        { from: "/vault/a.md", to: "/vault/c.md" },
        { from: "/vault/b.md", to: "/vault/c.md" },
      ],
    };
    const result = toGraphElements(graph);

    expect(result.edges).toHaveLength(3);
    // a: out=2 → degree=2
    expect(result.nodes.find((n) => n.data.id === "/vault/a.md")!.data.degree).toBe(2);
    // b: in=1 + out=1 → degree=2
    expect(result.nodes.find((n) => n.data.id === "/vault/b.md")!.data.degree).toBe(2);
    // c: in=2 → degree=2
    expect(result.nodes.find((n) => n.data.id === "/vault/c.md")!.data.degree).toBe(2);
  });

  it("deduplicates same source→target edges", () => {
    const graph: LinkGraph = {
      nodes: ["/vault/a.md", "/vault/b.md"],
      edges: [
        { from: "/vault/a.md", to: "/vault/b.md" },
        { from: "/vault/a.md", to: "/vault/b.md" }, // duplicate
        { from: "/vault/a.md", to: "/vault/b.md" }, // duplicate
      ],
    };
    const result = toGraphElements(graph);
    expect(result.edges).toHaveLength(1);
    // degree should count unique edges only
    expect(result.nodes[0].data.degree).toBe(1);
    expect(result.nodes[1].data.degree).toBe(1);
  });

  it("preserves directional edges (a→b and b→a are distinct)", () => {
    const graph: LinkGraph = {
      nodes: ["/vault/a.md", "/vault/b.md"],
      edges: [
        { from: "/vault/a.md", to: "/vault/b.md" },
        { from: "/vault/b.md", to: "/vault/a.md" },
      ],
    };
    const result = toGraphElements(graph);
    expect(result.edges).toHaveLength(2);
    expect(result.nodes[0].data.degree).toBe(2); // a: out+in = 2
    expect(result.nodes[1].data.degree).toBe(2); // b: out+in = 2
  });

  it("assigns unique edge IDs", () => {
    const graph: LinkGraph = {
      nodes: ["/vault/a.md", "/vault/b.md", "/vault/c.md"],
      edges: [
        { from: "/vault/a.md", to: "/vault/b.md" },
        { from: "/vault/a.md", to: "/vault/c.md" },
      ],
    };
    const result = toGraphElements(graph);
    const ids = result.edges.map((e) => e.data.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── nodeSize ─────────────────────────────────────────

describe("nodeSize", () => {
  it("returns minSize for degree 0", () => {
    expect(nodeSize(0)).toBe(20);
  });

  it("increases with degree", () => {
    const s1 = nodeSize(1);
    const s5 = nodeSize(5);
    const s20 = nodeSize(20);
    expect(s1).toBeGreaterThan(20);
    expect(s5).toBeGreaterThan(s1);
    expect(s20).toBeGreaterThan(s5);
  });

  it("caps at maxSize", () => {
    expect(nodeSize(10000)).toBeLessThanOrEqual(60);
  });

  it("respects custom min/max", () => {
    expect(nodeSize(0, 10, 100)).toBe(10);
    expect(nodeSize(10000, 10, 50)).toBeLessThanOrEqual(50);
  });
});

import { describe, it, expect } from "vitest";
import {
  parseSkillFrontmatter,
  buildDependencyGraph,
  detectCycles,
  getReverseDependencies,
  getImpactAnalysis,
  type SkillMeta,
} from "../skill-dependency-analyzer";

describe("parseSkillFrontmatter", () => {
  it("parses name, requires, output_format", () => {
    const yaml =
      "name: test\nrequires: [a, b]\noutput_format: json\ntype: skill";
    const meta = parseSkillFrontmatter(yaml, "/path/test.md");
    expect(meta.name).toBe("test");
    expect(meta.requires).toEqual(["a", "b"]);
    expect(meta.outputFormat).toBe("json");
  });

  it("handles empty requires", () => {
    const yaml = "name: test\nrequires: []\ntype: skill";
    const meta = parseSkillFrontmatter(yaml, "/path/test.md");
    expect(meta.requires).toEqual([]);
  });

  it("handles missing requires", () => {
    const yaml = "name: test\ntype: skill";
    const meta = parseSkillFrontmatter(yaml, "/path/test.md");
    expect(meta.requires).toEqual([]);
  });
});

describe("buildDependencyGraph", () => {
  const skills: SkillMeta[] = [
    { name: "a", filePath: "/a.md", requires: ["b"], outputFormat: "json" },
    { name: "b", filePath: "/b.md", requires: ["c"], outputFormat: "text" },
    { name: "c", filePath: "/c.md", requires: [], outputFormat: "markdown" },
  ];

  it("builds adjacency list", () => {
    const graph = buildDependencyGraph(skills);
    expect(graph.get("a")).toEqual(["b"]);
    expect(graph.get("b")).toEqual(["c"]);
    expect(graph.get("c")).toEqual([]);
  });
});

describe("detectCycles", () => {
  it("detects circular dependency", () => {
    const graph = new Map([
      ["a", ["b"]],
      ["b", ["c"]],
      ["c", ["a"]],
    ]);
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it("no cycles in acyclic graph", () => {
    const graph = new Map([
      ["a", ["b"]],
      ["b", ["c"]],
      ["c", []],
    ]);
    const cycles = detectCycles(graph);
    expect(cycles).toEqual([]);
  });
});

describe("getReverseDependencies", () => {
  const skills: SkillMeta[] = [
    { name: "a", filePath: "/a.md", requires: ["c"], outputFormat: "json" },
    { name: "b", filePath: "/b.md", requires: ["c"], outputFormat: "text" },
    { name: "c", filePath: "/c.md", requires: [], outputFormat: "markdown" },
  ];

  it("finds skills that depend on target", () => {
    const reverse = getReverseDependencies(skills, "c");
    expect(reverse).toContain("a");
    expect(reverse).toContain("b");
  });

  it("returns empty for leaf", () => {
    const reverse = getReverseDependencies(skills, "a");
    expect(reverse).toEqual([]);
  });
});

describe("getImpactAnalysis", () => {
  const skills: SkillMeta[] = [
    { name: "a", filePath: "/a.md", requires: ["b"], outputFormat: "json" },
    { name: "b", filePath: "/b.md", requires: ["c"], outputFormat: "text" },
    { name: "c", filePath: "/c.md", requires: [], outputFormat: "markdown" },
    { name: "d", filePath: "/d.md", requires: ["b"], outputFormat: "text" },
  ];

  it("finds transitive dependents", () => {
    const impact = getImpactAnalysis(skills, "c");
    // c is required by b, b is required by a and d
    expect(impact).toContain("b");
    expect(impact).toContain("a");
    expect(impact).toContain("d");
  });
});

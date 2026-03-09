import { describe, it, expect } from "vitest";
import { resolveExecutionOrder, dryRunChain } from "../skill-chain-runner";
import type { SkillMeta } from "../skill-dependency-analyzer";

const skills: SkillMeta[] = [
  {
    name: "a",
    filePath: "/a.md",
    requires: ["b"],
    outputFormat: "json",
    description: "Skill A",
  },
  {
    name: "b",
    filePath: "/b.md",
    requires: ["c"],
    outputFormat: "text",
    description: "Skill B",
  },
  {
    name: "c",
    filePath: "/c.md",
    requires: [],
    outputFormat: "markdown",
    description: "Skill C",
  },
];

describe("resolveExecutionOrder", () => {
  it("returns deps-first order", () => {
    const order = resolveExecutionOrder(skills, "a");
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("returns single skill when no deps", () => {
    const order = resolveExecutionOrder(skills, "c");
    expect(order).toEqual(["c"]);
  });

  it("throws on circular dependency", () => {
    const cyclic: SkillMeta[] = [
      { name: "x", filePath: "/x.md", requires: ["y"], outputFormat: "" },
      { name: "y", filePath: "/y.md", requires: ["x"], outputFormat: "" },
    ];
    expect(() => resolveExecutionOrder(cyclic, "x")).toThrow(
      "Circular dependency",
    );
  });
});

describe("dryRunChain", () => {
  it("succeeds for valid chain", () => {
    const result = dryRunChain(skills, "a");
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.status === "passed")).toBe(true);
  });

  it("fails for missing skill in chain", () => {
    const partial: SkillMeta[] = [
      {
        name: "a",
        filePath: "/a.md",
        requires: ["missing"],
        outputFormat: "json",
        description: "A",
      },
    ];
    const result = dryRunChain(partial, "a");
    expect(result.success).toBe(false);
    expect(result.steps.some((s) => s.status === "failed")).toBe(true);
  });

  it("skips downstream steps after failure", () => {
    const broken: SkillMeta[] = [
      {
        name: "a",
        filePath: "/a.md",
        requires: ["b"],
        outputFormat: "json",
        description: "A",
      },
      {
        name: "b",
        filePath: "/b.md",
        requires: ["missing"],
        outputFormat: "text",
        description: "B",
      },
    ];
    const result = dryRunChain(broken, "a");
    expect(result.success).toBe(false);
    const statuses = result.steps.map((s) => s.status);
    expect(statuses).toContain("failed");
    expect(statuses).toContain("skipped");
  });

  it("detects circular dependency", () => {
    const cyclic: SkillMeta[] = [
      { name: "x", filePath: "/x.md", requires: ["y"], outputFormat: "" },
      { name: "y", filePath: "/y.md", requires: ["x"], outputFormat: "" },
    ];
    const result = dryRunChain(cyclic, "x");
    expect(result.success).toBe(false);
    expect(result.steps[0].error).toContain("Circular");
  });
});

// §11.6 Agent Planner — build prompts and parse plan responses
import { describe, expect, it } from "vitest";

import { buildPlannerPrompt, parsePlanResponse } from "../agent-planner";

describe("buildPlannerPrompt", () => {
  it("includes user goal in prompt", () => {
    const prompt = buildPlannerPrompt("Improve descriptions", [
      "skills/a.md",
      "skills/b.md",
    ]);
    expect(prompt).toContain("Improve descriptions");
  });

  it("includes file list in prompt", () => {
    const prompt = buildPlannerPrompt("test", ["file1.md", "file2.md"]);
    expect(prompt).toContain("file1.md");
    expect(prompt).toContain("file2.md");
  });

  it("requests JSON output format", () => {
    const prompt = buildPlannerPrompt("test", []);
    expect(prompt).toContain("JSON");
  });
});

describe("parsePlanResponse", () => {
  it("parses valid plan JSON", () => {
    const response =
      '{"goal":"test","steps":[{"file":"a.md","action":"update","description":"fix","risk":"low"}]}';
    const plan = parsePlanResponse(response);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].file).toBe("a.md");
  });

  it("throws on invalid JSON", () => {
    expect(() => parsePlanResponse("not json")).toThrow();
  });
});

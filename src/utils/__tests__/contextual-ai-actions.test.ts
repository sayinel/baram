import { describe, expect, it } from "vitest";

import { getActionsForMode } from "../contextual-ai-actions";

describe("getActionsForMode", () => {
  it("returns 6 actions for text mode", () => {
    const actions = getActionsForMode("text");
    expect(actions).toHaveLength(6);
    expect(actions.map((a) => a.id)).toEqual([
      "improve",
      "shorten",
      "expand",
      "translate",
      "tone",
      "explain",
    ]);
  });

  it("returns 5 actions for code mode", () => {
    const actions = getActionsForMode("code");
    expect(actions).toHaveLength(5);
    expect(actions.map((a) => a.id)).toContain("optimize");
    expect(actions.map((a) => a.id)).toContain("find-bugs");
  });

  it("returns 4 actions for math mode", () => {
    const actions = getActionsForMode("math");
    expect(actions).toHaveLength(4);
  });

  it("returns 4 actions for table mode", () => {
    const actions = getActionsForMode("table");
    expect(actions).toHaveLength(4);
  });

  it("returns 4 actions for structure mode", () => {
    const actions = getActionsForMode("structure");
    expect(actions).toHaveLength(4);
  });

  it("each action has id, label, systemPrompt", () => {
    const actions = getActionsForMode("code");
    for (const action of actions) {
      expect(action).toHaveProperty("id");
      expect(action).toHaveProperty("label");
      expect(action).toHaveProperty("systemPrompt");
    }
  });
});

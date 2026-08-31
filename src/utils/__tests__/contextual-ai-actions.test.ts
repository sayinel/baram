import { describe, expect, it } from "vitest";

import { getActionsForMode } from "../contextual-ai-actions";

describe("getActionsForMode", () => {
  it("returns 7 actions for text mode", () => {
    const actions = getActionsForMode("text");
    expect(actions).toHaveLength(7);
    expect(actions.map((a) => a.id)).toEqual([
      "improve",
      "shorten",
      "expand",
      "translate",
      "tone",
      "explain",
      // §314 산문 모드에만 붙는다.
      "extract-tasks",
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

  it("returns 5 actions for structure mode", () => {
    const actions = getActionsForMode("structure");
    expect(actions).toHaveLength(5);
  });

  it("‼️ §314 추출은 산문 모드에만 붙는다", () => {
    // 수식이나 이미지를 고르고 "할 일 뽑기"를 권하는 것은 그 자리에서 뜻이 없다.
    for (const mode of ["structure", "text"] as const) {
      expect(getActionsForMode(mode).map((a) => a.id)).toContain(
        "extract-tasks",
      );
    }
    for (const mode of [
      "code",
      "diagram",
      "image",
      "math",
      "svg",
      "table",
    ] as const) {
      expect(getActionsForMode(mode).map((a) => a.id)).not.toContain(
        "extract-tasks",
      );
    }
  });

  it("‼️ 추출만 자기 모드를 갖는다 — 다른 둘은 문서에 곧장 쓴다", () => {
    // `generate`로 접어 넣으면 §18.20 위험 8이 금지한 바로 그 우회가 된다:
    // 확인 없이 쓰인 태스크 줄은 아젠다·쿼리 블록·태그 인덱스에까지 퍼진다.
    const extract = getActionsForMode("text").find(
      (a) => a.id === "extract-tasks",
    );
    expect(extract?.mode).toBe("tasks");
    expect(
      getActionsForMode("text")
        .filter((a) => a.id !== "extract-tasks")
        .every((a) => a.mode !== "tasks"),
    ).toBe(true);
  });

  it("returns SVG actions for svg mode", () => {
    const actions = getActionsForMode("svg");
    expect(actions.length).toBeGreaterThan(0);
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("improve-svg");
    expect(ids).toContain("modify-svg");
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

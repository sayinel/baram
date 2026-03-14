// §11.3.3 SessionMemory — rejection tracking + avoid/prefer patterns
import { beforeEach, describe, expect, it } from "vitest";

import { SessionMemory } from "../session-memory";

describe("SessionMemory", () => {
  let memory: SessionMemory;

  beforeEach(() => {
    memory = new SessionMemory("test-file.md");
  });

  it("records rejection", () => {
    memory.recordRejection("This is too formal");
    expect(memory.getRejections()).toHaveLength(1);
  });

  it("limits rejections to 10", () => {
    for (let i = 0; i < 15; i++) {
      memory.recordRejection(`rejection-${i}`);
    }
    expect(memory.getRejections()).toHaveLength(10);
  });

  it("adds avoid pattern from explicit feedback", () => {
    memory.addAvoidPattern("too formal");
    expect(memory.getPreferences().avoidPatterns).toContain("too formal");
  });

  it("adds prefer pattern", () => {
    memory.addPreferPattern("use Korean");
    expect(memory.getPreferences().preferPatterns).toContain("use Korean");
  });

  it("generates prompt injection string", () => {
    memory.recordRejection("Too verbose suggestion");
    memory.addPreferPattern("concise");
    const prompt = memory.toPromptContext();
    expect(prompt).toContain("DO NOT");
    expect(prompt).toContain("concise");
  });

  it("returns empty string when no feedback collected", () => {
    expect(memory.toPromptContext()).toBe("");
  });
});

// §11.3 WritingFlowStore — Zustand store combining mode, session context, and memory
import { beforeEach, describe, expect, it } from "vitest";

import { useWritingFlowStore } from "../writing-flow-store";

describe("WritingFlowStore", () => {
  beforeEach(() => {
    useWritingFlowStore.getState().reset();
  });

  it("initializes with general mode", () => {
    expect(useWritingFlowStore.getState().currentMode).toBe("general");
  });

  it("updates mode via setMode()", () => {
    useWritingFlowStore.getState().setMode("technical", 0.8);
    expect(useWritingFlowStore.getState().currentMode).toBe("technical");
    expect(useWritingFlowStore.getState().modeConfidence).toBe(0.8);
  });

  it("provides compositePromptContext() combining mode + session + memory", () => {
    useWritingFlowStore.getState().setMode("technical", 0.9);
    const ctx = useWritingFlowStore.getState().compositePromptContext();
    expect(ctx).toContain("technical");
  });

  it("resets sessionMemory per file", () => {
    useWritingFlowStore.getState().switchFile("file-a.md");
    useWritingFlowStore.getState().getSessionMemory().addAvoidPattern("test");
    useWritingFlowStore.getState().switchFile("file-b.md");
    expect(
      useWritingFlowStore.getState().getSessionMemory().getPreferences()
        .avoidPatterns,
    ).toHaveLength(0);
  });
});

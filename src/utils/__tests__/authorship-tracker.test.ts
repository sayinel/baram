// §11.7 AuthorshipTracker — segment management for AI vs human authorship tracking
import { beforeEach, describe, expect, it } from "vitest";

import { AuthorshipTracker } from "../authorship-tracker";

describe("AuthorshipTracker", () => {
  let tracker: AuthorshipTracker;

  beforeEach(() => {
    tracker = new AuthorshipTracker();
  });

  it("records ai-generated segment on ghost text accept", () => {
    tracker.recordAIGenerated(10, 30, {
      provider: "claude",
      model: "sonnet",
      action: "ghost-text",
    });
    const segments = tracker.getSegments();
    expect(segments).toHaveLength(1);
    expect(segments[0].origin).toBe("ai-generated");
    expect(segments[0].from).toBe(10);
    expect(segments[0].to).toBe(30);
  });

  it("records ai-modified segment on inline edit accept", () => {
    tracker.recordAIModified(5, 20, {
      provider: "openai",
      model: "gpt-4o",
      action: "inline-edit",
    });
    const segments = tracker.getSegments();
    expect(segments[0].origin).toBe("ai-modified");
  });

  it("converts ai-generated to human when user types in that range", () => {
    tracker.recordAIGenerated(10, 30, {
      provider: "claude",
      model: "sonnet",
      action: "ghost-text",
    });
    tracker.recordHumanEdit(15, 20);
    const segments = tracker.getSegments();
    // Should split: [10-15 ai-generated] [15-20 human] [20-30 ai-generated]
    const humanSeg = segments.find((s) => s.origin === "human");
    expect(humanSeg).toBeDefined();
  });

  it("calculates statistics", () => {
    tracker.recordAIGenerated(0, 100, {
      provider: "claude",
      model: "sonnet",
      action: "ghost-text",
    });
    tracker.recordHumanEdit(0, 70);
    const stats = tracker.getStats(100);
    expect(stats.humanPercent).toBe(70);
    expect(stats.aiGeneratedPercent).toBe(30);
  });
});

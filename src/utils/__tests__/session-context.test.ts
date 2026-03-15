// §11.3.2 SessionContextTracker — circular buffer + 5-min sliding window analysis
import { beforeEach, describe, expect, it } from "vitest";

import { SessionContextTracker } from "../session-context";

describe("SessionContextTracker", () => {
  let tracker: SessionContextTracker;

  beforeEach(() => {
    tracker = new SessionContextTracker();
  });

  it("records edit events up to buffer limit (100)", () => {
    for (let i = 0; i < 120; i++) {
      tracker.record({
        nodeType: "paragraph",
        textLength: 10,
        timestamp: Date.now() + i,
        type: "insert",
      });
    }
    expect(tracker.getEvents()).toHaveLength(100);
  });

  it("analyzes 5-min window for dominant pattern", () => {
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      tracker.record({
        nodeType: "listItem",
        textLength: 15,
        timestamp: now - i * 1000,
        type: "insert",
      });
    }
    const analysis = tracker.analyze();
    expect(analysis.dominantPattern).toBe("list-writing");
  });

  it("detects fast continuous typing as freewriting", () => {
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      tracker.record({
        nodeType: "paragraph",
        textLength: 50,
        timestamp: now - i * 500,
        type: "insert",
      });
    }
    const analysis = tracker.analyze();
    expect(analysis.wordsPerMinute).toBeGreaterThan(30);
  });

  it("detects high delete ratio as review mode", () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      tracker.record({
        nodeType: "paragraph",
        textLength: 20,
        timestamp: now - i * 2000,
        type: "delete",
      });
    }
    for (let i = 0; i < 3; i++) {
      tracker.record({
        nodeType: "paragraph",
        textLength: 5,
        timestamp: now - i * 2000,
        type: "insert",
      });
    }
    const analysis = tracker.analyze();
    expect(analysis.dominantPattern).toBe("reviewing");
  });

  it("generates context string for Ghost Text prompt", () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      tracker.record({
        nodeType: "listItem",
        textLength: 20,
        timestamp: now - i * 1000,
        type: "insert",
      });
    }
    const context = tracker.toPromptContext();
    expect(context).toContain("list");
  });
});

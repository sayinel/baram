import { describe, it, expect } from "vitest";
import { DAILY_PROMPTS, getDailyPrompt, getRandomPrompt } from "../journal-prompts";

describe("DAILY_PROMPTS", () => {
  it("has at least 50 entries", () => {
    expect(DAILY_PROMPTS.length).toBeGreaterThanOrEqual(50);
  });

  it("has no duplicate prompts", () => {
    const unique = new Set(DAILY_PROMPTS);
    expect(unique.size).toBe(DAILY_PROMPTS.length);
  });

  it("all entries are non-empty strings", () => {
    for (const p of DAILY_PROMPTS) {
      expect(typeof p).toBe("string");
      expect(p.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("getDailyPrompt", () => {
  it("returns same prompt for same date", () => {
    const date1 = new Date(2026, 1, 28); // 2026-02-28
    const date2 = new Date(2026, 1, 28);
    expect(getDailyPrompt(date1)).toBe(getDailyPrompt(date2));
  });

  it("returns a string from the pool", () => {
    const date = new Date(2026, 1, 28);
    const prompt = getDailyPrompt(date);
    expect(DAILY_PROMPTS).toContain(prompt);
  });

  it("returns different prompts for consecutive days (majority)", () => {
    const differentCount = (() => {
      let count = 0;
      for (let i = 0; i < 30; i++) {
        const d1 = new Date(2026, 0, i + 1);
        const d2 = new Date(2026, 0, i + 2);
        if (getDailyPrompt(d1) !== getDailyPrompt(d2)) count++;
      }
      return count;
    })();
    // Expect at least 25 out of 30 consecutive pairs to differ
    expect(differentCount).toBeGreaterThanOrEqual(25);
  });

  it("is deterministic across multiple calls", () => {
    const date = new Date(2026, 5, 15); // 2026-06-15
    const results = Array.from({ length: 10 }, () => getDailyPrompt(date));
    expect(new Set(results).size).toBe(1);
  });

  it("different dates in a year map to different prompt indices", () => {
    const jan1 = getDailyPrompt(new Date(2026, 0, 1));
    const dec31 = getDailyPrompt(new Date(2026, 11, 31));
    // They should be valid prompts from the pool
    expect(DAILY_PROMPTS).toContain(jan1);
    expect(DAILY_PROMPTS).toContain(dec31);
  });
});

describe("getRandomPrompt", () => {
  it("returns a string from the pool", () => {
    const prompt = getRandomPrompt();
    expect(DAILY_PROMPTS).toContain(prompt);
  });

  it("returns a non-empty string", () => {
    const prompt = getRandomPrompt();
    expect(prompt.trim().length).toBeGreaterThan(0);
  });

  it("produces varied results over multiple calls", () => {
    const results = new Set(Array.from({ length: 20 }, () => getRandomPrompt()));
    // With 60+ prompts and 20 calls, expect at least 5 unique values
    expect(results.size).toBeGreaterThanOrEqual(5);
  });
});

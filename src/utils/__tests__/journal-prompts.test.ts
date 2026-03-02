import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DAILY_PROMPTS,
  getDailyPrompt,
  getRandomPrompt,
  getDailyPromptWithHistory,
  HISTORY_SIZE,
} from "../journal-prompts";

// ── DAILY_PROMPTS structure ─────────────────────────────────────────────────

describe("DAILY_PROMPTS", () => {
  it("has exactly 120 entries", () => {
    expect(DAILY_PROMPTS.length).toBe(120);
  });

  it("gratitude category has 30 prompts", () => {
    expect(DAILY_PROMPTS.filter((p) => p.category === "gratitude").length).toBe(30);
  });

  it("reflection category has 30 prompts", () => {
    expect(DAILY_PROMPTS.filter((p) => p.category === "reflection").length).toBe(30);
  });

  it("goals category has 20 prompts", () => {
    expect(DAILY_PROMPTS.filter((p) => p.category === "goals").length).toBe(20);
  });

  it("creative category has 20 prompts", () => {
    expect(DAILY_PROMPTS.filter((p) => p.category === "creative").length).toBe(20);
  });

  it("relationships category has 20 prompts", () => {
    expect(DAILY_PROMPTS.filter((p) => p.category === "relationships").length).toBe(20);
  });

  it("all prompts have a valid non-empty id", () => {
    for (const p of DAILY_PROMPTS) {
      expect(typeof p.id).toBe("string");
      expect(p.id.trim().length).toBeGreaterThan(0);
    }
  });

  it("all prompt ids are unique", () => {
    const ids = DAILY_PROMPTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(DAILY_PROMPTS.length);
  });

  it("all prompts have non-empty text", () => {
    for (const p of DAILY_PROMPTS) {
      expect(typeof p.text).toBe("string");
      expect(p.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate prompt texts", () => {
    const texts = DAILY_PROMPTS.map((p) => p.text);
    expect(new Set(texts).size).toBe(DAILY_PROMPTS.length);
  });
});

// ── getDailyPrompt ──────────────────────────────────────────────────────────

describe("getDailyPrompt", () => {
  it("returns same prompt for same date", () => {
    const date1 = new Date(2026, 1, 28);
    const date2 = new Date(2026, 1, 28);
    expect(getDailyPrompt(date1)).toBe(getDailyPrompt(date2));
  });

  it("returns a string that exists in the prompt pool", () => {
    const date = new Date(2026, 1, 28);
    const prompt = getDailyPrompt(date);
    expect(DAILY_PROMPTS.map((p) => p.text)).toContain(prompt);
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
    expect(differentCount).toBeGreaterThanOrEqual(25);
  });

  it("is deterministic across multiple calls", () => {
    const date = new Date(2026, 5, 15);
    const results = Array.from({ length: 10 }, () => getDailyPrompt(date));
    expect(new Set(results).size).toBe(1);
  });

  it("different dates in a year map to valid prompts", () => {
    const jan1 = getDailyPrompt(new Date(2026, 0, 1));
    const dec31 = getDailyPrompt(new Date(2026, 11, 31));
    const texts = DAILY_PROMPTS.map((p) => p.text);
    expect(texts).toContain(jan1);
    expect(texts).toContain(dec31);
  });
});

// ── getRandomPrompt ─────────────────────────────────────────────────────────

describe("getRandomPrompt", () => {
  it("returns a string from the pool", () => {
    const prompt = getRandomPrompt();
    expect(DAILY_PROMPTS.map((p) => p.text)).toContain(prompt);
  });

  it("returns a non-empty string", () => {
    const prompt = getRandomPrompt();
    expect(prompt.trim().length).toBeGreaterThan(0);
  });

  it("produces varied results over multiple calls", () => {
    const results = new Set(Array.from({ length: 20 }, () => getRandomPrompt()));
    expect(results.size).toBeGreaterThanOrEqual(5);
  });
});

// ── getDailyPromptWithHistory ───────────────────────────────────────────────

describe("getDailyPromptWithHistory", () => {
  const date = new Date(2026, 2, 1);

  it("returns a DailyPrompt object", () => {
    const p = getDailyPromptWithHistory(date, []);
    expect(p).toHaveProperty("id");
    expect(p).toHaveProperty("category");
    expect(p).toHaveProperty("text");
  });

  it("avoids recently used prompt IDs", () => {
    // Get the first prompt with empty history
    const first = getDailyPromptWithHistory(date, []);
    // Now mark it as used — next call should avoid it
    const second = getDailyPromptWithHistory(date, [first.id]);
    expect(second.id).not.toBe(first.id);
  });

  it("filters by category when provided", () => {
    const p = getDailyPromptWithHistory(date, [], "gratitude");
    expect(p.category).toBe("gratitude");
  });

  it("returns a goals prompt when category is goals", () => {
    const p = getDailyPromptWithHistory(date, [], "goals");
    expect(p.category).toBe("goals");
  });

  it("resets pool when all prompts in category are used", () => {
    const gratitudeIds = DAILY_PROMPTS
      .filter((p) => p.category === "gratitude")
      .map((p) => p.id);
    // Pass all IDs as history — should still return a prompt (pool reset)
    const p = getDailyPromptWithHistory(date, gratitudeIds, "gratitude");
    expect(p.category).toBe("gratitude");
    expect(p.id.trim().length).toBeGreaterThan(0);
  });

  it("is deterministic for same date and history", () => {
    const history = ["g-001", "g-002"];
    const results = Array.from({ length: 5 }, () =>
      getDailyPromptWithHistory(date, history),
    );
    const ids = results.map((r) => r.id);
    expect(new Set(ids).size).toBe(1);
  });

  it("HISTORY_SIZE is 30", () => {
    expect(HISTORY_SIZE).toBe(30);
  });
});

// ── loadCustomPrompts ───────────────────────────────────────────────────────

describe("loadCustomPrompts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns empty array when prompts folder does not exist", async () => {
    // Simulate IPC failure (folder missing)
    vi.mock("../../ipc/invoke", () => ({
      listDir: vi.fn().mockRejectedValue(new Error("No such directory")),
      readFile: vi.fn(),
    }));
    const { loadCustomPrompts: lcp } = await import("../journal-prompts");
    const result = await lcp("/some/journal/dir");
    expect(result).toEqual([]);
  });
});

/**
 * §56g Journal Stats Cache — unit tests for pure functions
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createEmptyCache,
  updateCacheEntry,
  type JournalStatsCache,
} from "../journal-stats-cache";

// Mock IPC — we only test pure functions here so no actual IPC is called
vi.mock("../../ipc/invoke", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDir: vi.fn(),
}));

// ============================================================
// createEmptyCache
// ============================================================
describe("createEmptyCache", () => {
  it("returns version 1", () => {
    const cache = createEmptyCache();
    expect(cache.version).toBe(1);
  });

  it("returns zeroed stats", () => {
    const cache = createEmptyCache();
    expect(cache.stats.currentStreak).toBe(0);
    expect(cache.stats.longestStreak).toBe(0);
    expect(cache.stats.totalEntries).toBe(0);
    expect(cache.stats.totalWords).toBe(0);
  });

  it("has an empty entriesByDate map", () => {
    const cache = createEmptyCache();
    expect(Object.keys(cache.entriesByDate)).toHaveLength(0);
  });

  it("lastFullScan is a valid ISO string", () => {
    const cache = createEmptyCache();
    expect(() => new Date(cache.stats.lastFullScan)).not.toThrow();
  });
});

// ============================================================
// updateCacheEntry — word count
// ============================================================
describe("updateCacheEntry — word count", () => {
  let base: JournalStatsCache;

  beforeEach(() => {
    base = createEmptyCache();
  });

  it("counts plain body words", () => {
    const content = "Hello world foo bar";
    const result = updateCacheEntry(base, "2026-01-01", content);
    expect(result.entriesByDate["2026-01-01"].words).toBe(4);
  });

  it("excludes frontmatter from word count", () => {
    const content = `---
date: 2026-01-01
mood: happy
---

Hello world`;
    const result = updateCacheEntry(base, "2026-01-01", content);
    // Only "Hello world" = 2 words
    expect(result.entriesByDate["2026-01-01"].words).toBe(2);
  });

  it("excludes heading lines from word count", () => {
    const content = `# My Journal

Some text here`;
    const result = updateCacheEntry(base, "2026-01-01", content);
    // Heading line excluded; "Some text here" = 3 words
    expect(result.entriesByDate["2026-01-01"].words).toBe(3);
  });

  it("excludes both frontmatter and headings", () => {
    const content = `---
date: 2026-01-01
---

# Title

One two three`;
    const result = updateCacheEntry(base, "2026-01-01", content);
    expect(result.entriesByDate["2026-01-01"].words).toBe(3);
  });

  it("returns 0 for empty content", () => {
    const result = updateCacheEntry(base, "2026-01-01", "");
    expect(result.entriesByDate["2026-01-01"].words).toBe(0);
  });
});

// ============================================================
// updateCacheEntry — frontmatter fields (mood, energy, tags)
// ============================================================
describe("updateCacheEntry — frontmatter fields", () => {
  let base: JournalStatsCache;

  beforeEach(() => {
    base = createEmptyCache();
  });

  it("parses mood from frontmatter", () => {
    const content = `---
mood: happy
---

Hello`;
    const result = updateCacheEntry(base, "2026-01-01", content);
    expect(result.entriesByDate["2026-01-01"].mood).toBe("happy");
  });

  it("parses energy as a number", () => {
    const content = `---
energy: 7
---

Hello`;
    const result = updateCacheEntry(base, "2026-01-01", content);
    expect(result.entriesByDate["2026-01-01"].energy).toBe(7);
  });

  it("parses tags as an array (YAML list)", () => {
    const content = `---
tags:
  - work
  - focus
---

Hello`;
    const result = updateCacheEntry(base, "2026-01-01", content);
    expect(result.entriesByDate["2026-01-01"].tags).toEqual(["work", "focus"]);
  });

  it("parses tags as inline array", () => {
    const content = `---
tags: [work, focus, health]
---

Hello`;
    const result = updateCacheEntry(base, "2026-01-01", content);
    expect(result.entriesByDate["2026-01-01"].tags).toEqual(["work", "focus", "health"]);
  });

  it("returns undefined mood when not in frontmatter", () => {
    const result = updateCacheEntry(base, "2026-01-01", "Hello world");
    expect(result.entriesByDate["2026-01-01"].mood).toBeUndefined();
  });

  it("returns undefined energy when not in frontmatter", () => {
    const result = updateCacheEntry(base, "2026-01-01", "Hello world");
    expect(result.entriesByDate["2026-01-01"].energy).toBeUndefined();
  });

  it("returns undefined tags when not in frontmatter", () => {
    const result = updateCacheEntry(base, "2026-01-01", "Hello world");
    expect(result.entriesByDate["2026-01-01"].tags).toBeUndefined();
  });
});

// ============================================================
// updateCacheEntry — hasPhotos
// ============================================================
describe("updateCacheEntry — hasPhotos", () => {
  let base: JournalStatsCache;

  beforeEach(() => {
    base = createEmptyCache();
  });

  it("sets hasPhotos=true when content contains ![", () => {
    const content = "Some text\n![alt](photo.jpg)";
    const result = updateCacheEntry(base, "2026-01-01", content);
    expect(result.entriesByDate["2026-01-01"].hasPhotos).toBe(true);
  });

  it("sets hasPhotos=undefined when no image markdown", () => {
    const result = updateCacheEntry(base, "2026-01-01", "Just text, no photos.");
    expect(result.entriesByDate["2026-01-01"].hasPhotos).toBeUndefined();
  });
});

// ============================================================
// updateCacheEntry — aggregate stats recomputation
// ============================================================
describe("updateCacheEntry — aggregate stats", () => {
  it("totalEntries increases with each new date", () => {
    let cache = createEmptyCache();
    cache = updateCacheEntry(cache, "2026-01-01", "word1 word2");
    expect(cache.stats.totalEntries).toBe(1);
    cache = updateCacheEntry(cache, "2026-01-02", "word3");
    expect(cache.stats.totalEntries).toBe(2);
  });

  it("totalWords sums word counts across entries", () => {
    let cache = createEmptyCache();
    cache = updateCacheEntry(cache, "2026-01-01", "one two three"); // 3
    cache = updateCacheEntry(cache, "2026-01-02", "four five");     // 2
    expect(cache.stats.totalWords).toBe(5);
  });

  it("does not mutate the original cache", () => {
    const original = createEmptyCache();
    const updated = updateCacheEntry(original, "2026-01-01", "hello world");
    expect(original.stats.totalEntries).toBe(0);
    expect(updated.stats.totalEntries).toBe(1);
  });

  it("preserves lastFullScan from the original cache", () => {
    const cache = createEmptyCache();
    const sentinel = "2026-01-15T12:00:00.000Z";
    cache.stats.lastFullScan = sentinel;
    const updated = updateCacheEntry(cache, "2026-01-01", "hello");
    expect(updated.stats.lastFullScan).toBe(sentinel);
  });
});

// ============================================================
// Streak calculation via updateCacheEntry
// ============================================================
describe("updateCacheEntry — streak calculation", () => {
  it("consecutive dates produce non-zero longest streak", () => {
    // Use dates in the past so current streak is always 0 (no today entry)
    let cache = createEmptyCache();
    cache = updateCacheEntry(cache, "2020-01-01", "text");
    cache = updateCacheEntry(cache, "2020-01-02", "text");
    cache = updateCacheEntry(cache, "2020-01-03", "text");
    expect(cache.stats.longestStreak).toBe(3);
  });

  it("gap in dates breaks streak", () => {
    let cache = createEmptyCache();
    cache = updateCacheEntry(cache, "2020-01-01", "text");
    cache = updateCacheEntry(cache, "2020-01-02", "text");
    // gap on 2020-01-03
    cache = updateCacheEntry(cache, "2020-01-04", "text");
    // longest is 2 (Jan 1-2), current is 0 (today is 2026-xx-xx)
    expect(cache.stats.longestStreak).toBe(2);
  });

  it("single entry gives longestStreak=1", () => {
    const cache = updateCacheEntry(createEmptyCache(), "2020-06-15", "hello world");
    expect(cache.stats.longestStreak).toBe(1);
  });

  it("currentStreak is 0 when today has no entry", () => {
    // All entries in the past with no gap running to today
    let cache = createEmptyCache();
    cache = updateCacheEntry(cache, "2020-01-01", "text");
    cache = updateCacheEntry(cache, "2020-01-02", "text");
    expect(cache.stats.currentStreak).toBe(0);
  });
});

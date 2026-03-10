import { describe, expect, it } from "vitest";

import {
  categorizeJournalResult,
  extractDateFromPath,
  extractFrontmatterFields,
  filterByFrontmatter,
  groupSearchResults,
  hasActiveFilters,
  highlightSearchMatch,
} from "../journal-search";

const DIR = "/home/user/journal";

describe("categorizeJournalResult", () => {
  it("categorizes daily hierarchical path", () => {
    expect(
      categorizeJournalResult(`${DIR}/daily/2024/2024-03-15.md`, DIR),
    ).toBe("daily");
  });

  it("categorizes weekly hierarchical path", () => {
    expect(categorizeJournalResult(`${DIR}/weekly/2024/2024-W12.md`, DIR)).toBe(
      "weekly",
    );
  });

  it("categorizes monthly hierarchical path", () => {
    expect(categorizeJournalResult(`${DIR}/monthly/2024/2024-03.md`, DIR)).toBe(
      "monthly",
    );
  });

  it("categorizes yearly hierarchical path", () => {
    expect(categorizeJournalResult(`${DIR}/yearly/2024.md`, DIR)).toBe(
      "yearly",
    );
  });

  it("categorizes notes path", () => {
    expect(categorizeJournalResult(`${DIR}/notes/ideas.md`, DIR)).toBe("notes");
  });

  it("categorizes flat daily YYYY-MM-DD.md in journal root", () => {
    expect(categorizeJournalResult(`${DIR}/2024-03-15.md`, DIR)).toBe("daily");
  });

  it("categorizes flat daily YYYYMMDD.md in journal root", () => {
    expect(categorizeJournalResult(`${DIR}/20240315.md`, DIR)).toBe("daily");
  });

  it("returns 'other' for path outside journal dir", () => {
    expect(categorizeJournalResult("/home/user/vault/notes.md", DIR)).toBe(
      "other",
    );
  });

  it("returns 'other' for unknown subfolder", () => {
    expect(categorizeJournalResult(`${DIR}/archive/old.md`, DIR)).toBe("other");
  });

  it("handles trailing slash in journalDir", () => {
    expect(
      categorizeJournalResult(`${DIR}/daily/2024/2024-01-01.md`, `${DIR}/`),
    ).toBe("daily");
  });
});

describe("groupSearchResults", () => {
  it("groups mixed results by category", () => {
    const results = [
      { path: `${DIR}/daily/2024/2024-03-01.md`, line: 1 },
      { path: `${DIR}/weekly/2024/2024-W10.md`, line: 2 },
      { path: `${DIR}/daily/2024/2024-03-02.md`, line: 3 },
      { path: `${DIR}/notes/ideas.md`, line: 4 },
      { path: `${DIR}/monthly/2024/2024-03.md`, line: 5 },
    ];

    const grouped = groupSearchResults(results, DIR);

    expect(grouped.has("daily")).toBe(true);
    expect(grouped.get("daily")).toHaveLength(2);
    expect(grouped.has("weekly")).toBe(true);
    expect(grouped.get("weekly")).toHaveLength(1);
    expect(grouped.has("monthly")).toBe(true);
    expect(grouped.has("notes")).toBe(true);
  });

  it("omits categories with no results", () => {
    const results = [{ path: `${DIR}/notes/todo.md`, line: 1 }];
    const grouped = groupSearchResults(results, DIR);
    expect(grouped.has("notes")).toBe(true);
    expect(grouped.has("daily")).toBe(false);
    expect(grouped.has("weekly")).toBe(false);
  });

  it("preserves canonical category order", () => {
    const results = [
      { path: `${DIR}/notes/a.md`, line: 1 },
      { path: `${DIR}/daily/2024/2024-01-01.md`, line: 2 },
      { path: `${DIR}/yearly/2024.md`, line: 3 },
    ];
    const grouped = groupSearchResults(results, DIR);
    const keys = [...grouped.keys()];
    expect(keys.indexOf("daily")).toBeLessThan(keys.indexOf("yearly"));
    expect(keys.indexOf("yearly")).toBeLessThan(keys.indexOf("notes"));
  });

  it("returns empty map for empty results", () => {
    const grouped = groupSearchResults([], DIR);
    expect(grouped.size).toBe(0);
  });
});

describe("highlightSearchMatch", () => {
  it("wraps match in <mark> tags", () => {
    expect(highlightSearchMatch("hello world", "world")).toBe(
      "hello <mark>world</mark>",
    );
  });

  it("is case-insensitive", () => {
    expect(highlightSearchMatch("Hello World", "hello")).toBe(
      "<mark>Hello</mark> World",
    );
  });

  it("highlights all occurrences", () => {
    const result = highlightSearchMatch("cat and cat and cat", "cat");
    expect((result.match(/<mark>/g) ?? []).length).toBe(3);
  });

  it("strips leading # for tag search", () => {
    expect(highlightSearchMatch("use #rust daily", "#rust")).toBe(
      "use #<mark>rust</mark> daily",
    );
  });

  it("returns original text for empty query", () => {
    expect(highlightSearchMatch("some text", "")).toBe("some text");
  });

  it("returns original text for whitespace-only query", () => {
    expect(highlightSearchMatch("some text", "   ")).toBe("some text");
  });

  it("escapes regex special chars in query", () => {
    expect(highlightSearchMatch("price: $10.00", "$10.00")).toBe(
      "price: <mark>$10.00</mark>",
    );
  });

  it("handles query longer than text gracefully", () => {
    expect(highlightSearchMatch("hi", "hello world")).toBe("hi");
  });
});

// ── §56k Frontmatter utilities ───────────────────────────────────────────────

describe("extractFrontmatterFields", () => {
  const mkContent = (yaml: string, body = "") => `---\n${yaml}\n---\n${body}`;

  it("extracts date, mood, energy from frontmatter", () => {
    const content = mkContent("date: 2026-02-28\nmood: calm\nenergy: 4");
    const fields = extractFrontmatterFields(content);
    expect(fields.date).toBe("2026-02-28");
    expect(fields.mood).toBe("calm");
    expect(fields.energy).toBe(4);
  });

  it("extracts inline tags", () => {
    const content = mkContent("tags: [여행, 운동, 독서]");
    const { tags } = extractFrontmatterFields(content);
    expect(tags).toEqual(["여행", "운동", "독서"]);
  });

  it("extracts block-style tags", () => {
    const content = mkContent("tags:\n  - 여행\n  - 운동");
    const { tags } = extractFrontmatterFields(content);
    expect(tags).toEqual(["여행", "운동"]);
  });

  it("detects hasPhotos from body", () => {
    const content = mkContent(
      "date: 2026-01-01",
      "Some text\n![photo](img.jpg)",
    );
    expect(extractFrontmatterFields(content).hasPhotos).toBe(true);
  });

  it("hasPhotos false when no image syntax", () => {
    const content = mkContent("date: 2026-01-01", "Just text");
    expect(extractFrontmatterFields(content).hasPhotos).toBe(false);
  });

  it("returns defaults when no frontmatter", () => {
    const content = "No frontmatter here\n![photo](img.jpg)";
    const fields = extractFrontmatterFields(content);
    expect(fields.date).toBeUndefined();
    expect(fields.mood).toBeUndefined();
    expect(fields.energy).toBeUndefined();
    expect(fields.hasPhotos).toBe(true);
  });

  it("returns empty tags array when tags key absent", () => {
    const content = mkContent("date: 2026-01-01");
    expect(extractFrontmatterFields(content).tags).toEqual([]);
  });

  it("strips quotes from tag values", () => {
    const content = mkContent("tags: [\"여행\", '운동']");
    const { tags } = extractFrontmatterFields(content);
    expect(tags).toEqual(["여행", "운동"]);
  });
});

describe("extractDateFromPath", () => {
  it("extracts YYYY-MM-DD from path", () => {
    expect(extractDateFromPath("/journal/daily/2026/02/2026-02-28.md")).toBe(
      "2026-02-28",
    );
  });

  it("extracts date from flat filename", () => {
    expect(extractDateFromPath("/journal/2026-01-01.md")).toBe("2026-01-01");
  });

  it("returns null when no date in path", () => {
    expect(extractDateFromPath("/journal/notes/ideas.md")).toBeNull();
  });
});

describe("filterByFrontmatter", () => {
  const r = (path: string, yaml: string, body = "") => ({
    path,
    content: `---\n${yaml}\n---\n${body}`,
  });

  const items = [
    r(
      "/j/2026-01-10.md",
      "date: 2026-01-10\nmood: calm\nenergy: 3\ntags: [여행]",
    ),
    r(
      "/j/2026-02-01.md",
      "date: 2026-02-01\nmood: warm\nenergy: 5\ntags: [운동]",
      "![img](x.jpg)",
    ),
    r(
      "/j/2026-03-15.md",
      "date: 2026-03-15\nmood: bright\nenergy: 2\ntags: [독서, 여행]",
    ),
    r("/j/no-date.md", "mood: deep\nenergy: 4"),
  ];

  it("date range filter — from only", () => {
    const res = filterByFrontmatter(items, { dateFrom: "2026-02-01" });
    expect(res.map((r) => r.path)).toEqual([
      "/j/2026-02-01.md",
      "/j/2026-03-15.md",
    ]);
  });

  it("date range filter — to only", () => {
    const res = filterByFrontmatter(items, { dateTo: "2026-01-31" });
    expect(res.map((r) => r.path)).toEqual(["/j/2026-01-10.md"]);
  });

  it("date range filter — from and to", () => {
    const res = filterByFrontmatter(items, {
      dateFrom: "2026-01-10",
      dateTo: "2026-02-01",
    });
    expect(res.map((r) => r.path)).toEqual([
      "/j/2026-01-10.md",
      "/j/2026-02-01.md",
    ]);
  });

  it("date filter excludes entries with no date", () => {
    const res = filterByFrontmatter(items, { dateFrom: "2026-01-01" });
    expect(res.map((r) => r.path)).not.toContain("/j/no-date.md");
  });

  it("mood filter matches selected moods", () => {
    const res = filterByFrontmatter(items, { moodFilter: ["calm", "bright"] });
    expect(res.map((r) => r.path)).toEqual([
      "/j/2026-01-10.md",
      "/j/2026-03-15.md",
    ]);
  });

  it("mood filter empty array = no filter", () => {
    const res = filterByFrontmatter(items, { moodFilter: [] });
    expect(res).toHaveLength(items.length);
  });

  it("energy min filter", () => {
    const res = filterByFrontmatter(items, { energyMin: 4 });
    expect(res.map((r) => r.path)).toEqual([
      "/j/2026-02-01.md",
      "/j/no-date.md",
    ]);
  });

  it("tags filter — OR logic, any match passes", () => {
    const res = filterByFrontmatter(items, { tagsFilter: ["운동", "독서"] });
    expect(res.map((r) => r.path)).toEqual([
      "/j/2026-02-01.md",
      "/j/2026-03-15.md",
    ]);
  });

  it("tags filter empty array = no filter", () => {
    const res = filterByFrontmatter(items, { tagsFilter: [] });
    expect(res).toHaveLength(items.length);
  });

  it("hasPhotos filter keeps only entries with images", () => {
    const res = filterByFrontmatter(items, { hasPhotos: true });
    expect(res.map((r) => r.path)).toEqual(["/j/2026-02-01.md"]);
  });

  it("combined filters — AND logic across fields", () => {
    const res = filterByFrontmatter(items, {
      dateFrom: "2026-01-01",
      dateTo: "2026-02-28",
      moodFilter: ["warm"],
      energyMin: 4,
      hasPhotos: true,
    });
    expect(res.map((r) => r.path)).toEqual(["/j/2026-02-01.md"]);
  });

  it("returns all when no filters active", () => {
    const res = filterByFrontmatter(items, {});
    expect(res).toHaveLength(items.length);
  });
});

describe("hasActiveFilters", () => {
  it("returns false for empty filters", () => {
    expect(hasActiveFilters({})).toBe(false);
  });

  it("returns true when dateFrom set", () => {
    expect(hasActiveFilters({ dateFrom: "2026-01-01" })).toBe(true);
  });

  it("returns true when moodFilter non-empty", () => {
    expect(hasActiveFilters({ moodFilter: ["calm"] })).toBe(true);
  });

  it("returns false when moodFilter is empty array", () => {
    expect(hasActiveFilters({ moodFilter: [] })).toBe(false);
  });

  it("returns true when energyMin set", () => {
    expect(hasActiveFilters({ energyMin: 3 })).toBe(true);
  });

  it("returns true when hasPhotos true", () => {
    expect(hasActiveFilters({ hasPhotos: true })).toBe(true);
  });
});

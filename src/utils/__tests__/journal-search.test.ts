import { describe, it, expect } from "vitest";
import {
  categorizeJournalResult,
  groupSearchResults,
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
    expect(
      categorizeJournalResult(`${DIR}/weekly/2024/2024-W12.md`, DIR),
    ).toBe("weekly");
  });

  it("categorizes monthly hierarchical path", () => {
    expect(
      categorizeJournalResult(`${DIR}/monthly/2024/2024-03.md`, DIR),
    ).toBe("monthly");
  });

  it("categorizes yearly hierarchical path", () => {
    expect(
      categorizeJournalResult(`${DIR}/yearly/2024.md`, DIR),
    ).toBe("yearly");
  });

  it("categorizes notes path", () => {
    expect(
      categorizeJournalResult(`${DIR}/notes/ideas.md`, DIR),
    ).toBe("notes");
  });

  it("categorizes flat daily YYYY-MM-DD.md in journal root", () => {
    expect(
      categorizeJournalResult(`${DIR}/2024-03-15.md`, DIR),
    ).toBe("daily");
  });

  it("categorizes flat daily YYYYMMDD.md in journal root", () => {
    expect(
      categorizeJournalResult(`${DIR}/20240315.md`, DIR),
    ).toBe("daily");
  });

  it("returns 'other' for path outside journal dir", () => {
    expect(
      categorizeJournalResult("/home/user/vault/notes.md", DIR),
    ).toBe("other");
  });

  it("returns 'other' for unknown subfolder", () => {
    expect(
      categorizeJournalResult(`${DIR}/archive/old.md`, DIR),
    ).toBe("other");
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

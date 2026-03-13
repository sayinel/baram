import type { FileEntry } from "../../stores/file-store";

// §35 Quick Switcher — file search utility tests
import { describe, expect, it } from "vitest";

import {
  extractHeadings,
  flattenFileTree,
  fuzzyMatch,
  fuzzyScore,
} from "../file-search";

describe("flattenFileTree", () => {
  const tree: FileEntry[] = [
    {
      name: "docs",
      path: "/root/docs",
      isDir: true,
      children: [
        { name: "guide.md", path: "/root/docs/guide.md", isDir: false },
        { name: "faq.md", path: "/root/docs/faq.md", isDir: false },
      ],
    },
    { name: "README.md", path: "/root/README.md", isDir: false },
    {
      name: ".git",
      path: "/root/.git",
      isDir: true,
      children: [{ name: "config", path: "/root/.git/config", isDir: false }],
    },
    {
      name: "node_modules",
      path: "/root/node_modules",
      isDir: true,
      children: [
        { name: "pkg.json", path: "/root/node_modules/pkg.json", isDir: false },
      ],
    },
    { name: "notes.txt", path: "/root/notes.txt", isDir: false },
  ];

  it("returns flat list of files with relative paths", () => {
    const result = flattenFileTree(tree, "/root");
    expect(result).toContainEqual({
      name: "guide.md",
      path: "/root/docs/guide.md",
      relativePath: "docs/guide.md",
    });
    expect(result).toContainEqual({
      name: "README.md",
      path: "/root/README.md",
      relativePath: "README.md",
    });
  });

  it("excludes directories from result", () => {
    const result = flattenFileTree(tree, "/root");
    const dirs = result.filter((f) => f.name === "docs" || f.name === ".git");
    expect(dirs).toHaveLength(0);
  });

  it("excludes .git and node_modules contents", () => {
    const result = flattenFileTree(tree, "/root");
    const hidden = result.filter(
      (f) => f.path.includes(".git/") || f.path.includes("node_modules/"),
    );
    expect(hidden).toHaveLength(0);
  });

  it("handles empty tree", () => {
    expect(flattenFileTree([], "/root")).toEqual([]);
  });

  it("handles deeply nested structure", () => {
    const deep: FileEntry[] = [
      {
        name: "a",
        path: "/r/a",
        isDir: true,
        children: [
          {
            name: "b",
            path: "/r/a/b",
            isDir: true,
            children: [{ name: "c.md", path: "/r/a/b/c.md", isDir: false }],
          },
        ],
      },
    ];
    const result = flattenFileTree(deep, "/r");
    expect(result).toEqual([
      { name: "c.md", path: "/r/a/b/c.md", relativePath: "a/b/c.md" },
    ]);
  });
});

describe("fuzzyMatch", () => {
  it("matches exact substring", () => {
    expect(fuzzyMatch("read", "README.md")).toBe(true);
  });

  it("matches fuzzy characters in order", () => {
    expect(fuzzyMatch("rmd", "README.md")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("README", "readme.md")).toBe(true);
  });

  it("returns false for non-matching", () => {
    expect(fuzzyMatch("xyz", "README.md")).toBe(false);
  });

  it("returns true for empty query", () => {
    expect(fuzzyMatch("", "anything")).toBe(true);
  });

  it("returns false when query is longer than text", () => {
    expect(fuzzyMatch("abcdef", "abc")).toBe(false);
  });
});

describe("fuzzyScore", () => {
  it("returns negative score for start-of-string match", () => {
    const score = fuzzyScore("readme", "readme");
    expect(score).toBeLessThan(0); // start-of-string bonus
  });

  it("returns lower score for consecutive matches", () => {
    const scoreConsecutive = fuzzyScore("read", "readme.md");
    const scoreSpread = fuzzyScore("ramd", "readme.md");
    expect(scoreConsecutive).toBeLessThan(scoreSpread);
  });

  it("returns Infinity for no match", () => {
    expect(fuzzyScore("xyz", "readme.md")).toBe(Infinity);
  });

  it("prefers start-of-word matches", () => {
    const scoreStart = fuzzyScore("gui", "guide.md");
    const scoreMid = fuzzyScore("uid", "guide.md");
    expect(scoreStart).toBeLessThan(scoreMid);
  });
});

describe("extractHeadings", () => {
  it("extracts headings with levels and line numbers", () => {
    const md = "# Title\n\nSome text\n\n## Section 1\n\n### Sub-section";
    const headings = extractHeadings(md);
    expect(headings).toEqual([
      { level: 1, text: "Title", line: 1 },
      { level: 2, text: "Section 1", line: 5 },
      { level: 3, text: "Sub-section", line: 7 },
    ]);
  });

  it("ignores code block headings", () => {
    const md = "# Real Heading\n\n```\n# Not a heading\n```\n\n## Another";
    const headings = extractHeadings(md);
    expect(headings).toHaveLength(2);
    expect(headings[0].text).toBe("Real Heading");
    expect(headings[1].text).toBe("Another");
  });

  it("returns empty array for no headings", () => {
    expect(extractHeadings("Just some text\nNo headings here")).toEqual([]);
  });

  it("handles heading with inline formatting", () => {
    const md = "## **Bold** and *italic* heading";
    const headings = extractHeadings(md);
    expect(headings[0].text).toBe("**Bold** and *italic* heading");
  });

  it("handles empty content", () => {
    expect(extractHeadings("")).toEqual([]);
  });
});

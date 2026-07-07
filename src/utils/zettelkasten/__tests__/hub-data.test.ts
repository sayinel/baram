import type { FileEntry } from "../../../ipc/types";

import { describe, expect, it } from "vitest";

import { recentFromEntries } from "../hub-data";
import { firstBodyLine } from "../parse-note-title";

describe("firstBodyLine", () => {
  it("strips frontmatter and a leading heading marker", () => {
    expect(firstBodyLine("---\nid: 1\n---\n\n# Hello\nbody")).toBe("Hello");
  });

  it("returns the first non-empty line when there is no frontmatter", () => {
    expect(firstBodyLine("first line\nsecond line")).toBe("first line");
  });

  it("returns '' when the body has no non-empty content", () => {
    expect(firstBodyLine("---\nid: 1\n---\n\n")).toBe("");
    expect(firstBodyLine("")).toBe("");
  });
});

describe("recentFromEntries", () => {
  function entry(overrides: Partial<FileEntry>): FileEntry {
    return {
      isDir: false,
      modifiedAt: 0,
      name: "note.md",
      path: "/vault/notes/note.md",
      size: 0,
      ...overrides,
    };
  }

  it("sorts by modifiedAt descending", () => {
    const entries = [
      entry({ name: "a.md", path: "/a.md", modifiedAt: 1 }),
      entry({ name: "b.md", path: "/b.md", modifiedAt: 3 }),
      entry({ name: "c.md", path: "/c.md", modifiedAt: 2 }),
    ];
    expect(recentFromEntries(entries, 10).map((r) => r.path)).toEqual([
      "/b.md",
      "/c.md",
      "/a.md",
    ]);
  });

  it("filters to .md/.markdown files and drops directories", () => {
    const entries = [
      entry({ name: "note.md", path: "/note.md", modifiedAt: 1 }),
      entry({ name: "note.markdown", path: "/note2.markdown", modifiedAt: 2 }),
      entry({ name: "image.png", path: "/image.png", modifiedAt: 3 }),
      entry({
        name: "subdir",
        path: "/subdir",
        modifiedAt: 4,
        isDir: true,
      }),
    ];
    expect(recentFromEntries(entries, 10).map((r) => r.path)).toEqual([
      "/note2.markdown",
      "/note.md",
    ]);
  });

  it("takes only `limit` entries", () => {
    const entries = [
      entry({ name: "a.md", path: "/a.md", modifiedAt: 1 }),
      entry({ name: "b.md", path: "/b.md", modifiedAt: 2 }),
      entry({ name: "c.md", path: "/c.md", modifiedAt: 3 }),
    ];
    expect(recentFromEntries(entries, 2)).toHaveLength(2);
  });

  it("derives the title from the filename via parseNoteTitle", () => {
    const entries = [
      entry({
        name: "202607051530 원자적 노트.md",
        path: "/vault/notes/202607051530 원자적 노트.md",
        modifiedAt: 1,
      }),
    ];
    expect(recentFromEntries(entries, 10)).toEqual([
      {
        path: "/vault/notes/202607051530 원자적 노트.md",
        title: "원자적 노트",
      },
    ]);
  });
});

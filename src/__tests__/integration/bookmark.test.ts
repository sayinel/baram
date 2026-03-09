// §36 북마크 시스템 — 통합 테스트
import { describe, test, expect } from "vitest";

// ── BookmarkItem 타입 계약 ──

export interface BookmarkItem {
  id: string;
  type: "file" | "heading";
  filePath: string;
  label: string;
  group: string;
  createdAt: number;
  headingText?: string;
  headingLevel?: number;
}

// ── 유틸리티 함수 (bookmark-store.ts에서 export 예정) ──

/** Generate localStorage key scoped to vault root */
function storageKey(rootPath: string): string {
  return `baram:bookmarks:${rootPath}`;
}

/** Check for duplicate bookmark (same type + filePath + headingText) */
function isDuplicate(
  bookmarks: BookmarkItem[],
  item: Pick<BookmarkItem, "type" | "filePath" | "headingText">,
): boolean {
  return bookmarks.some(
    (b) =>
      b.type === item.type &&
      b.filePath === item.filePath &&
      b.headingText === item.headingText,
  );
}

/** Get unique groups from bookmarks list */
function getGroups(bookmarks: BookmarkItem[]): string[] {
  const groups = new Set<string>();
  for (const b of bookmarks) {
    groups.add(b.group);
  }
  return Array.from(groups);
}

/** Find heading pos by text+level in a doc (simulated) */
function findHeadingPos(
  headings: Array<{ level: number; text: string; pos: number }>,
  headingText: string,
  headingLevel?: number,
): number | null {
  const match = headings.find(
    (h) =>
      h.text === headingText &&
      (headingLevel === undefined || h.level === headingLevel),
  );
  return match?.pos ?? null;
}

// ── Tests ──

describe("§36 Bookmark System", () => {
  describe("BookmarkItem type contract", () => {
    test("file bookmark has required fields", () => {
      const bookmark: BookmarkItem = {
        id: "uuid-1",
        type: "file",
        filePath: "/vault/notes.md",
        label: "notes.md",
        group: "Default",
        createdAt: Date.now(),
      };

      expect(bookmark.type).toBe("file");
      expect(bookmark.filePath).toBe("/vault/notes.md");
      expect(bookmark.label).toBe("notes.md");
      expect(bookmark.group).toBe("Default");
      expect(bookmark.headingText).toBeUndefined();
    });

    test("heading bookmark includes heading metadata", () => {
      const bookmark: BookmarkItem = {
        id: "uuid-2",
        type: "heading",
        filePath: "/vault/architecture.md",
        label: "architecture.md § 기술 스택",
        group: "자주 참조",
        createdAt: Date.now(),
        headingText: "기술 스택",
        headingLevel: 2,
      };

      expect(bookmark.type).toBe("heading");
      expect(bookmark.headingText).toBe("기술 스택");
      expect(bookmark.headingLevel).toBe(2);
    });
  });

  describe("storageKey", () => {
    test("generates localStorage key scoped to vault path", () => {
      expect(storageKey("/Users/me/vault")).toBe(
        "baram:bookmarks:/Users/me/vault",
      );
    });

    test("different vaults produce different keys", () => {
      expect(storageKey("/vault-a")).not.toBe(storageKey("/vault-b"));
    });
  });

  describe("isDuplicate", () => {
    const existing: BookmarkItem[] = [
      {
        id: "1",
        type: "file",
        filePath: "/vault/a.md",
        label: "a.md",
        group: "Default",
        createdAt: 1000,
      },
      {
        id: "2",
        type: "heading",
        filePath: "/vault/b.md",
        label: "b.md § Intro",
        group: "Default",
        createdAt: 2000,
        headingText: "Intro",
        headingLevel: 1,
      },
    ];

    test("detects duplicate file bookmark", () => {
      expect(
        isDuplicate(existing, { type: "file", filePath: "/vault/a.md" }),
      ).toBe(true);
    });

    test("allows different file", () => {
      expect(
        isDuplicate(existing, { type: "file", filePath: "/vault/c.md" }),
      ).toBe(false);
    });

    test("detects duplicate heading bookmark", () => {
      expect(
        isDuplicate(existing, {
          type: "heading",
          filePath: "/vault/b.md",
          headingText: "Intro",
        }),
      ).toBe(true);
    });

    test("allows same file but different heading", () => {
      expect(
        isDuplicate(existing, {
          type: "heading",
          filePath: "/vault/b.md",
          headingText: "Summary",
        }),
      ).toBe(false);
    });

    test("file and heading for same path are not duplicates", () => {
      expect(
        isDuplicate(existing, {
          type: "heading",
          filePath: "/vault/a.md",
          headingText: "Section 1",
        }),
      ).toBe(false);
    });
  });

  describe("getGroups", () => {
    test("extracts unique group names", () => {
      const bookmarks: BookmarkItem[] = [
        {
          id: "1",
          type: "file",
          filePath: "/a.md",
          label: "a",
          group: "Default",
          createdAt: 1,
        },
        {
          id: "2",
          type: "file",
          filePath: "/b.md",
          label: "b",
          group: "Work",
          createdAt: 2,
        },
        {
          id: "3",
          type: "file",
          filePath: "/c.md",
          label: "c",
          group: "Default",
          createdAt: 3,
        },
      ];
      const groups = getGroups(bookmarks);
      expect(groups).toContain("Default");
      expect(groups).toContain("Work");
      expect(groups).toHaveLength(2);
    });

    test("returns empty array for no bookmarks", () => {
      expect(getGroups([])).toEqual([]);
    });
  });

  describe("findHeadingPos", () => {
    const headings = [
      { level: 1, text: "Title", pos: 0 },
      { level: 2, text: "Introduction", pos: 50 },
      { level: 2, text: "Summary", pos: 120 },
      { level: 3, text: "Details", pos: 200 },
    ];

    test("finds heading by text and level", () => {
      expect(findHeadingPos(headings, "Introduction", 2)).toBe(50);
    });

    test("finds heading by text only", () => {
      expect(findHeadingPos(headings, "Summary")).toBe(120);
    });

    test("returns null when heading not found", () => {
      expect(findHeadingPos(headings, "Nonexistent")).toBeNull();
    });

    test("matches both text and level when level provided", () => {
      // If we had two headings with same text but different level
      const mixed = [
        { level: 2, text: "Intro", pos: 10 },
        { level: 3, text: "Intro", pos: 80 },
      ];
      expect(findHeadingPos(mixed, "Intro", 3)).toBe(80);
    });
  });
});

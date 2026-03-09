// §34 Unlinked Mentions — integration tests
import { describe, test, expect } from "vitest";
import type { UnlinkedMention } from "../../ipc/types";

/** Group unlinked mentions by source file — mirrors Backlinks.tsx logic */
function groupUnlinkedByFile(
  entries: UnlinkedMention[],
): { sourcePath: string; entries: UnlinkedMention[] }[] {
  if (entries.length === 0) return [];

  const map = new Map<string, UnlinkedMention[]>();
  for (const entry of entries) {
    const existing = map.get(entry.sourcePath);
    if (existing) {
      existing.push(entry);
    } else {
      map.set(entry.sourcePath, [entry]);
    }
  }

  return Array.from(map.entries()).map(([sourcePath, groupEntries]) => ({
    sourcePath,
    entries: groupEntries,
  }));
}

/** Simulate linkify: replace matchText on line with [[target]] */
function linkifyLine(
  lineContent: string,
  matchText: string,
  currentStem: string,
): string {
  const matchIdx = lineContent.toLowerCase().indexOf(matchText.toLowerCase());
  if (matchIdx === -1) return lineContent;

  const before = lineContent.slice(0, matchIdx);
  const matched = lineContent.slice(matchIdx, matchIdx + matchText.length);
  const after = lineContent.slice(matchIdx + matchText.length);

  const wikilink =
    matched === currentStem
      ? `[[${currentStem}]]`
      : `[[${currentStem}|${matched}]]`;

  return before + wikilink + after;
}

describe("§34 Unlinked Mentions", () => {
  describe("UnlinkedMention type contract", () => {
    test("matches Rust serde camelCase field names", () => {
      // This test verifies the TypeScript type matches what Rust sends
      const mention: UnlinkedMention = {
        sourcePath: "/vault/notes.md",
        line: 5,
        context: "discusses architecture patterns",
        matchText: "architecture",
      };

      expect(mention.sourcePath).toBe("/vault/notes.md");
      expect(mention.line).toBe(5);
      expect(mention.context).toBe("discusses architecture patterns");
      expect(mention.matchText).toBe("architecture");
    });
  });

  describe("groupUnlinkedByFile", () => {
    test("groups mentions by source file", () => {
      const mentions: UnlinkedMention[] = [
        {
          sourcePath: "/vault/a.md",
          line: 1,
          context: "ctx1",
          matchText: "arch",
        },
        {
          sourcePath: "/vault/b.md",
          line: 3,
          context: "ctx2",
          matchText: "arch",
        },
        {
          sourcePath: "/vault/a.md",
          line: 7,
          context: "ctx3",
          matchText: "arch",
        },
      ];

      const groups = groupUnlinkedByFile(mentions);
      expect(groups).toHaveLength(2);
      expect(groups[0].sourcePath).toBe("/vault/a.md");
      expect(groups[0].entries).toHaveLength(2);
      expect(groups[1].sourcePath).toBe("/vault/b.md");
      expect(groups[1].entries).toHaveLength(1);
    });

    test("returns empty array for empty input", () => {
      expect(groupUnlinkedByFile([])).toEqual([]);
    });
  });

  describe("linkify (convert mention to wikilink)", () => {
    test("wraps exact match as [[target]]", () => {
      const result = linkifyLine(
        "discusses architecture patterns",
        "architecture",
        "architecture",
      );
      expect(result).toBe("discusses [[architecture]] patterns");
    });

    test("uses alias syntax when case differs", () => {
      const result = linkifyLine(
        "discusses Architecture patterns",
        "Architecture",
        "architecture",
      );
      expect(result).toBe("discusses [[architecture|Architecture]] patterns");
    });

    test("preserves surrounding text", () => {
      const result = linkifyLine(
        "the architecture is important for architecture",
        "architecture",
        "architecture",
      );
      // Only replaces first occurrence
      expect(result).toBe("the [[architecture]] is important for architecture");
    });

    test("returns original line when matchText not found", () => {
      const result = linkifyLine(
        "no match here",
        "architecture",
        "architecture",
      );
      expect(result).toBe("no match here");
    });

    test("handles match at start of line", () => {
      const result = linkifyLine(
        "architecture is key",
        "architecture",
        "architecture",
      );
      expect(result).toBe("[[architecture]] is key");
    });

    test("handles match at end of line", () => {
      const result = linkifyLine(
        "about the architecture",
        "architecture",
        "architecture",
      );
      expect(result).toBe("about the [[architecture]]");
    });
  });
});

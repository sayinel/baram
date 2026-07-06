import { beforeEach, describe, expect, it } from "vitest";

// §95 Zettelkasten: [[ autocomplete searches by title, inserts id
import { useZettelIndexStore } from "../../../stores/zettelkasten/zettel-index";
import {
  buildFileSuggestionItem,
  filterFiles,
  type WikilinkSuggestionItem,
} from "../wikilink-suggest-utils";

describe("wikilink-suggest-utils — §95 zettel autocomplete", () => {
  beforeEach(() => useZettelIndexStore.getState().clear());

  describe("buildFileSuggestionItem", () => {
    it("zettel-note file (id-prefixed filename): target=id, searchText=title from index", () => {
      useZettelIndexStore.getState().setAll([
        {
          id: "202607051530",
          path: "/vault/notes/202607051530 원자적 노트.md",
          title: "원자적 노트",
        },
      ]);

      const item = buildFileSuggestionItem(
        {
          name: "202607051530 원자적 노트.md",
          path: "/vault/notes/202607051530 원자적 노트.md",
        },
        "0",
      );

      expect(item.target).toBe("202607051530");
      expect(item.searchText).toBe("원자적 노트");
      expect(item.label).toBe("원자적 노트");
    });

    it("zettel-note file falls back to parseNoteTitle when not in the index", () => {
      const item = buildFileSuggestionItem(
        {
          name: "202607060000 미색인 노트.md",
          path: "/vault/inbox/202607060000 미색인 노트.md",
        },
        "1",
      );

      expect(item.target).toBe("202607060000");
      expect(item.searchText).toBe("미색인 노트");
      expect(item.label).toBe("미색인 노트");
    });

    it("regular (non-zettel) file: target=filename, no searchText", () => {
      const item = buildFileSuggestionItem(
        { name: "daily-notes.md", path: "/vault/daily-notes.md" },
        "2",
      );

      expect(item.target).toBe("daily-notes");
      expect(item.searchText).toBeUndefined();
      expect(item.label).toBe("daily-notes.md");
    });
  });

  describe("filterFiles", () => {
    it("matches zettel items by title (searchText), not by the raw id", () => {
      const files: WikilinkSuggestionItem[] = [
        {
          id: "0",
          target: "202607051530",
          label: "원자적 노트",
          path: "/vault/notes/202607051530 원자적 노트.md",
          searchText: "원자적 노트",
        },
      ];

      expect(filterFiles(files, "원자적", 20)).toHaveLength(1);
      expect(filterFiles(files, "202607051530", 20)).toHaveLength(0);
    });

    it("matches regular files by filename (target), unchanged behavior", () => {
      const files: WikilinkSuggestionItem[] = [
        {
          id: "0",
          target: "daily-notes",
          label: "daily-notes.md",
          path: "/vault/daily-notes.md",
        },
      ];

      expect(filterFiles(files, "daily", 20)).toHaveLength(1);
      expect(filterFiles(files, "zzz", 20)).toHaveLength(0);
    });

    it("empty query returns the slice as-is (existing behavior preserved)", () => {
      const files: WikilinkSuggestionItem[] = [
        {
          id: "0",
          target: "202607051530",
          label: "원자적 노트",
          path: "/vault/notes/202607051530 원자적 노트.md",
          searchText: "원자적 노트",
        },
        {
          id: "1",
          target: "daily-notes",
          label: "daily-notes.md",
          path: "/vault/daily-notes.md",
        },
      ];

      expect(filterFiles(files, "", 20)).toHaveLength(2);
    });
  });
});

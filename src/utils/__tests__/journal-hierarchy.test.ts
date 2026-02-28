/**
 * §56a Phase A — Journal Hierarchy & Migration Tests
 * TDD Red Phase: all tests should FAIL before implementation
 */
import { describe, it, expect } from "vitest";
import {
  getHierarchicalJournalPath,
  flatToHierarchicalPath,
  detectFlatJournalFiles,
  buildMigrationPlan,
  JOURNAL_HIDDEN_ENTRIES,
  isJournalHiddenEntry,
} from "../journal";

describe("§56a Hierarchical journal paths", () => {
  const date = new Date(2026, 1, 28); // 2026-02-28

  describe("getHierarchicalJournalPath", () => {
    it("returns daily/YYYY/MM/YYYY-MM-DD.md for a date", () => {
      expect(getHierarchicalJournalPath("/journals", date, "YYYY-MM-DD.md")).toBe(
        "/journals/daily/2026/02/2026-02-28.md",
      );
    });

    it("pads single-digit month and day", () => {
      const jan5 = new Date(2026, 0, 5);
      expect(getHierarchicalJournalPath("/j", jan5, "YYYY-MM-DD.md")).toBe(
        "/j/daily/2026/01/2026-01-05.md",
      );
    });

    it("supports custom filename format", () => {
      expect(getHierarchicalJournalPath("/j", date, "YYYYMMDD.md")).toBe(
        "/j/daily/2026/02/20260228.md",
      );
    });
  });

  describe("flatToHierarchicalPath", () => {
    it("converts flat path to hierarchical path", () => {
      expect(flatToHierarchicalPath("/journals", "/journals/2026-02-28.md")).toBe(
        "/journals/daily/2026/02/2026-02-28.md",
      );
    });

    it("returns null for non-date filenames", () => {
      expect(flatToHierarchicalPath("/journals", "/journals/notes.md")).toBeNull();
    });

    it("returns null for files already in daily/ structure", () => {
      expect(
        flatToHierarchicalPath("/journals", "/journals/daily/2026/02/2026-02-28.md"),
      ).toBeNull();
    });
  });

  describe("detectFlatJournalFiles", () => {
    it("finds flat YYYY-MM-DD.md files in root", () => {
      const entries = [
        { name: "2026-02-28.md", path: "/j/2026-02-28.md", isDir: false },
        { name: "2026-02-27.md", path: "/j/2026-02-27.md", isDir: false },
        { name: "daily", path: "/j/daily", isDir: true },
        { name: "notes.md", path: "/j/notes.md", isDir: false },
      ];
      const result = detectFlatJournalFiles(entries);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("2026-02-28.md");
    });

    it("returns empty array when no flat files exist", () => {
      const entries = [
        { name: "daily", path: "/j/daily", isDir: true },
        { name: "notes", path: "/j/notes", isDir: true },
      ];
      expect(detectFlatJournalFiles(entries)).toHaveLength(0);
    });
  });

  describe("buildMigrationPlan", () => {
    it("generates from/to pairs for flat files", () => {
      const flatFiles = [
        { name: "2026-02-28.md", path: "/j/2026-02-28.md", isDir: false },
        { name: "2025-12-31.md", path: "/j/2025-12-31.md", isDir: false },
      ];
      const plan = buildMigrationPlan("/j", flatFiles);
      expect(plan).toHaveLength(2);
      expect(plan[0]).toEqual({
        from: "/j/2026-02-28.md",
        to: "/j/daily/2026/02/2026-02-28.md",
      });
      expect(plan[1]).toEqual({
        from: "/j/2025-12-31.md",
        to: "/j/daily/2025/12/2025-12-31.md",
      });
    });

    it("skips non-date files", () => {
      const flatFiles = [
        { name: "notes.md", path: "/j/notes.md", isDir: false },
      ];
      const plan = buildMigrationPlan("/j", flatFiles);
      expect(plan).toHaveLength(0);
    });
  });
});

describe("§56a Journal hidden entries filter", () => {
  describe("JOURNAL_HIDDEN_ENTRIES", () => {
    it("includes .journal.json and assets", () => {
      expect(JOURNAL_HIDDEN_ENTRIES).toContain(".journal.json");
      expect(JOURNAL_HIDDEN_ENTRIES).toContain("assets");
      expect(JOURNAL_HIDDEN_ENTRIES).toContain("prompts");
    });
  });

  describe("isJournalHiddenEntry", () => {
    it("returns true for hidden entries", () => {
      expect(isJournalHiddenEntry(".journal.json")).toBe(true);
      expect(isJournalHiddenEntry("assets")).toBe(true);
      expect(isJournalHiddenEntry("prompts")).toBe(true);
    });

    it("returns false for visible entries", () => {
      expect(isJournalHiddenEntry("daily")).toBe(false);
      expect(isJournalHiddenEntry("notes")).toBe(false);
      expect(isJournalHiddenEntry("weekly")).toBe(false);
      expect(isJournalHiddenEntry("templates")).toBe(false);
    });
  });
});

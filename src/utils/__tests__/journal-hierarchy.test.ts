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
  getISOWeekNumber,
  getWeekStartDate,
  getWeeklyJournalPath,
  getMonthlyJournalPath,
  getYearlyJournalPath,
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

describe("§56a Periodic note paths", () => {
  describe("getISOWeekNumber", () => {
    it("returns week 1 for 2026-01-01 (Thursday)", () => {
      expect(getISOWeekNumber(new Date(2026, 0, 1))).toBe(1);
    });

    it("returns week 9 for 2026-02-28 (Saturday)", () => {
      expect(getISOWeekNumber(new Date(2026, 1, 28))).toBe(9);
    });

    it("returns week 53 for 2020-12-31 (Thursday)", () => {
      expect(getISOWeekNumber(new Date(2020, 11, 31))).toBe(53);
    });

    it("returns week 1 for 2021-01-04 (Monday)", () => {
      expect(getISOWeekNumber(new Date(2021, 0, 4))).toBe(1);
    });
  });

  describe("getWeekStartDate", () => {
    it("returns Monday for a Wednesday", () => {
      // 2026-02-25 is Wednesday
      const monday = getWeekStartDate(new Date(2026, 1, 25));
      expect(monday.getDate()).toBe(23); // Monday Feb 23
    });

    it("returns same day for a Monday", () => {
      const monday = getWeekStartDate(new Date(2026, 1, 23));
      expect(monday.getDate()).toBe(23);
    });

    it("returns previous Monday for a Sunday", () => {
      // 2026-03-01 is Sunday
      const monday = getWeekStartDate(new Date(2026, 2, 1));
      expect(monday.getDate()).toBe(23); // Feb 23
    });
  });

  describe("getWeeklyJournalPath", () => {
    it("builds correct weekly path", () => {
      const date = new Date(2026, 1, 28); // Week 9
      expect(getWeeklyJournalPath("/j", date)).toBe("/j/weekly/2026/2026-W09.md");
    });

    it("handles week 1", () => {
      const date = new Date(2026, 0, 1);
      expect(getWeeklyJournalPath("/j", date)).toBe("/j/weekly/2026/2026-W01.md");
    });
  });

  describe("getMonthlyJournalPath", () => {
    it("builds correct monthly path", () => {
      const date = new Date(2026, 1, 28);
      expect(getMonthlyJournalPath("/j", date)).toBe("/j/monthly/2026/2026-02.md");
    });

    it("pads single-digit month", () => {
      const date = new Date(2026, 0, 15);
      expect(getMonthlyJournalPath("/j", date)).toBe("/j/monthly/2026/2026-01.md");
    });
  });

  describe("getYearlyJournalPath", () => {
    it("builds correct yearly path", () => {
      const date = new Date(2026, 5, 1);
      expect(getYearlyJournalPath("/j", date)).toBe("/j/yearly/2026.md");
    });
  });
});

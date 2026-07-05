import { describe, expect, it } from "vitest";

import {
  applyJournalTemplate,
  formatJournalDate,
  formatJournalFilename,
  formatReadableDate,
  generateDefaultJournal,
  getFirstDayOfWeek,
  getJournalFilePath,
  getMonthDays,
  getOrdinalSuffix,
  isDateString,
  resolveDateAlias,
  resolveJournalDir,
} from "../journal/journal";

describe("journal utilities", () => {
  const date = new Date(2026, 1, 27); // 2026-02-27 Friday

  describe("formatJournalDate", () => {
    it("formats date as YYYY-MM-DD", () => {
      expect(formatJournalDate(date)).toBe("2026-02-27");
    });

    it("pads single-digit month and day", () => {
      expect(formatJournalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    });
  });

  describe("getOrdinalSuffix", () => {
    it("returns st for 1, 21, 31", () => {
      expect(getOrdinalSuffix(1)).toBe("st");
      expect(getOrdinalSuffix(21)).toBe("st");
      expect(getOrdinalSuffix(31)).toBe("st");
    });

    it("returns nd for 2, 22", () => {
      expect(getOrdinalSuffix(2)).toBe("nd");
      expect(getOrdinalSuffix(22)).toBe("nd");
    });

    it("returns rd for 3, 23", () => {
      expect(getOrdinalSuffix(3)).toBe("rd");
      expect(getOrdinalSuffix(23)).toBe("rd");
    });

    it("returns th for 11, 12, 13 (special cases)", () => {
      expect(getOrdinalSuffix(11)).toBe("th");
      expect(getOrdinalSuffix(12)).toBe("th");
      expect(getOrdinalSuffix(13)).toBe("th");
    });

    it("returns th for other numbers", () => {
      expect(getOrdinalSuffix(4)).toBe("th");
      expect(getOrdinalSuffix(15)).toBe("th");
      expect(getOrdinalSuffix(30)).toBe("th");
    });
  });

  describe("formatReadableDate", () => {
    it("formats as 'Month Dayth (DayName), Year'", () => {
      expect(formatReadableDate(new Date(2026, 0, 1))).toBe(
        "January 1st (Thursday), 2026",
      );
      expect(formatReadableDate(new Date(2026, 1, 27))).toBe(
        "February 27th (Friday), 2026",
      );
      expect(formatReadableDate(new Date(2026, 11, 25))).toBe(
        "December 25th (Friday), 2026",
      );
    });
  });

  describe("formatJournalFilename", () => {
    it("replaces YYYY-MM-DD format", () => {
      expect(formatJournalFilename(date, "YYYY-MM-DD.md")).toBe(
        "2026-02-27.md",
      );
    });

    it("replaces YYYYMMDD format", () => {
      expect(formatJournalFilename(date, "YYYYMMDD.md")).toBe("20260227.md");
    });
  });

  describe("isDateString", () => {
    it("returns true for valid date strings", () => {
      expect(isDateString("2026-02-27")).toBe(true);
      expect(isDateString("2000-01-01")).toBe(true);
    });

    it("returns false for invalid strings", () => {
      expect(isDateString("today")).toBe(false);
      expect(isDateString("2026-2-27")).toBe(false);
      expect(isDateString("26-02-27")).toBe(false);
      expect(isDateString("")).toBe(false);
    });
  });

  describe("resolveDateAlias", () => {
    it("resolves today", () => {
      const result = resolveDateAlias("today");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("resolves yesterday", () => {
      const result = resolveDateAlias("yesterday");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // yesterday should be different from today
      expect(result).not.toBe(resolveDateAlias("today"));
    });

    it("resolves tomorrow", () => {
      const result = resolveDateAlias("tomorrow");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result).not.toBe(resolveDateAlias("today"));
    });

    it("is case-insensitive", () => {
      expect(resolveDateAlias("Today")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(resolveDateAlias("TODAY")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("returns null for unknown aliases", () => {
      expect(resolveDateAlias("next week")).toBeNull();
      expect(resolveDateAlias("foo")).toBeNull();
    });
  });

  describe("generateDefaultJournal", () => {
    it("generates frontmatter with date", () => {
      const result = generateDefaultJournal(date);
      expect(result).toContain("date: 2026-02-27");
    });

    it("includes readable date heading with day name", () => {
      const result = generateDefaultJournal(date);
      expect(result).toContain("# February 27th (Friday), 2026");
    });

    it("does not split into Diary/Notes sections", () => {
      const result = generateDefaultJournal(date);
      expect(result).not.toContain("## Diary");
      expect(result).not.toContain("## Notes");
    });

    it("does not include daily prompt blockquote", () => {
      const result = generateDefaultJournal(date);
      expect(result).not.toContain("> 💡");
    });
  });

  describe("applyJournalTemplate", () => {
    it("replaces {{date}}", () => {
      expect(applyJournalTemplate("# {{date}}", date)).toBe("# 2026-02-27");
    });

    it("replaces {{year}}, {{month}}, {{day}}", () => {
      const tpl = "{{year}}/{{month}}/{{day}}";
      expect(applyJournalTemplate(tpl, date)).toBe("2026/02/27");
    });

    it("replaces {{dayName}} and {{monthName}}", () => {
      expect(applyJournalTemplate("{{dayName}}", date)).toBe("Friday");
      expect(applyJournalTemplate("{{monthName}}", date)).toBe("February");
    });

    it("handles multiple occurrences", () => {
      expect(applyJournalTemplate("{{date}} {{date}}", date)).toBe(
        "2026-02-27 2026-02-27",
      );
    });
  });

  describe("resolveJournalDir", () => {
    it("returns absolute path as-is when rootPath is null", () => {
      expect(resolveJournalDir(null, "/Users/xxx/journals")).toBe(
        "/Users/xxx/journals",
      );
    });

    it("returns absolute path as-is when rootPath is provided", () => {
      expect(resolveJournalDir("/root", "/Users/xxx/journals")).toBe(
        "/Users/xxx/journals",
      );
    });

    it("returns null for relative path", () => {
      expect(resolveJournalDir(null, "journals")).toBeNull();
      expect(resolveJournalDir("/root", "journals")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(resolveJournalDir(null, "")).toBeNull();
      expect(resolveJournalDir("/root", "")).toBeNull();
    });

    it("detects Windows absolute path", () => {
      expect(resolveJournalDir(null, "C:\\Users\\xxx\\journals")).toBe(
        "C:\\Users\\xxx\\journals",
      );
    });
  });

  describe("getJournalFilePath", () => {
    it("builds path from absolute journalDir", () => {
      expect(
        getJournalFilePath(null, "/Users/xxx/journals", date, "YYYY-MM-DD.md"),
      ).toBe("/Users/xxx/journals/2026-02-27.md");
    });

    it("returns null for relative path", () => {
      expect(
        getJournalFilePath("/root", "journals", date, "YYYY-MM-DD.md"),
      ).toBeNull();
    });

    it("returns null for empty directory", () => {
      expect(getJournalFilePath(null, "", date, "YYYY-MM-DD.md")).toBeNull();
    });
  });

  describe("getMonthDays", () => {
    it("returns correct number of days for February 2026", () => {
      const days = getMonthDays(2026, 1); // month 0-indexed
      expect(days).toHaveLength(28);
    });

    it("returns correct number of days for January", () => {
      const days = getMonthDays(2026, 0);
      expect(days).toHaveLength(31);
    });

    it("handles leap year February", () => {
      const days = getMonthDays(2024, 1);
      expect(days).toHaveLength(29);
    });
  });

  describe("getFirstDayOfWeek", () => {
    it("returns 0-6 for day of week", () => {
      const dow = getFirstDayOfWeek(2026, 1); // Feb 2026 starts on Sunday
      expect(dow).toBe(0);
    });
  });
});

import { describe, expect, test } from "vitest";

import {
  getHeatmapLevel,
  getMonthLabels,
  getWeekColumns,
} from "../ContributionHeatmap";

describe("getHeatmapLevel", () => {
  test("returns 0 for wordCount 0", () => {
    expect(getHeatmapLevel(0)).toBe(0);
  });

  test("returns 1 for 1-99 words", () => {
    expect(getHeatmapLevel(1)).toBe(1);
    expect(getHeatmapLevel(50)).toBe(1);
    expect(getHeatmapLevel(99)).toBe(1);
  });

  test("returns 2 for 100-299 words", () => {
    expect(getHeatmapLevel(100)).toBe(2);
    expect(getHeatmapLevel(200)).toBe(2);
    expect(getHeatmapLevel(299)).toBe(2);
  });

  test("returns 3 for 300-499 words", () => {
    expect(getHeatmapLevel(300)).toBe(3);
    expect(getHeatmapLevel(400)).toBe(3);
    expect(getHeatmapLevel(499)).toBe(3);
  });

  test("returns 4 for 500+ words", () => {
    expect(getHeatmapLevel(500)).toBe(4);
    expect(getHeatmapLevel(1000)).toBe(4);
  });
});

describe("getWeekColumns", () => {
  test("returns 365 entries for non-leap year 2023", () => {
    const cols = getWeekColumns(2023);
    expect(cols).toHaveLength(365);
  });

  test("returns 366 entries for leap year 2024", () => {
    const cols = getWeekColumns(2024);
    expect(cols).toHaveLength(366);
  });

  test("first entry is Jan 1 with correct dayOfWeek", () => {
    const cols2023 = getWeekColumns(2023);
    expect(cols2023[0].date).toBe("2023-01-01");
    // Jan 1 2023 is a Sunday (0)
    expect(cols2023[0].dayOfWeek).toBe(0);
    expect(cols2023[0].weekIndex).toBe(0);
  });

  test("last entry of 2023 is Dec 31", () => {
    const cols = getWeekColumns(2023);
    expect(cols[364].date).toBe("2023-12-31");
  });

  test("each day has dayOfWeek 0-6", () => {
    const cols = getWeekColumns(2025);
    for (const c of cols) {
      expect(c.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(c.dayOfWeek).toBeLessThanOrEqual(6);
    }
  });

  test("weekIndex is non-decreasing", () => {
    const cols = getWeekColumns(2025);
    for (let i = 1; i < cols.length; i++) {
      expect(cols[i].weekIndex).toBeGreaterThanOrEqual(cols[i - 1].weekIndex);
    }
  });

  test("max weekIndex is at most 53 (53 or 54 weeks depending on year)", () => {
    const cols2023 = getWeekColumns(2023);
    const max = Math.max(...cols2023.map((c) => c.weekIndex));
    expect(max).toBeLessThanOrEqual(53);
  });

  test("year boundary: first day of year has weekIndex 0", () => {
    for (const year of [2020, 2021, 2022, 2023, 2024, 2025]) {
      const cols = getWeekColumns(year);
      expect(cols[0].weekIndex).toBe(0);
    }
  });
});

describe("getMonthLabels", () => {
  test("returns 12 labels", () => {
    const labels = getMonthLabels(2025);
    expect(labels).toHaveLength(12);
  });

  test("first label is Jan", () => {
    const labels = getMonthLabels(2025);
    expect(labels[0].month).toBe("Jan");
  });

  test("last label is Dec", () => {
    const labels = getMonthLabels(2025);
    expect(labels[11].month).toBe("Dec");
  });

  test("Jan always has weekIndex 0", () => {
    for (const year of [2020, 2021, 2022, 2023, 2024, 2025]) {
      const labels = getMonthLabels(year);
      expect(labels[0].weekIndex).toBe(0);
    }
  });

  test("weekIndex is non-decreasing across months", () => {
    const labels = getMonthLabels(2025);
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i].weekIndex).toBeGreaterThanOrEqual(
        labels[i - 1].weekIndex,
      );
    }
  });

  test("all month names are correct abbreviations", () => {
    const expected = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const labels = getMonthLabels(2025);
    expect(labels.map((l) => l.month)).toEqual(expected);
  });

  test("leap year 2024: Feb starts at correct column", () => {
    const labels2024 = getMonthLabels(2024);
    const labels2023 = getMonthLabels(2023);
    // Feb weekIndex should be >= 4 (Jan has 31 days, always at least 4 weeks)
    expect(labels2024[1].weekIndex).toBeGreaterThanOrEqual(4);
    expect(labels2023[1].weekIndex).toBeGreaterThanOrEqual(4);
  });
});

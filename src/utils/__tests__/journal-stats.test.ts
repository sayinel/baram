/**
 * §56g Journal Streaks & Stats — unit tests
 */
import { describe, expect, it } from "vitest";

import {
  calculateMonthStats,
  calculateStreak,
  calculateYearStats,
} from "../journal/journal-stats";

// ============================================================
// calculateStreak
// ============================================================
describe("calculateStreak — consecutive dates", () => {
  it("returns current=3 longest=3 for three consecutive days including today", () => {
    const dates = new Set(["2026-02-26", "2026-02-27", "2026-02-28"]);
    const result = calculateStreak(dates, "2026-02-28");
    expect(result.current).toBe(3);
    expect(result.longest).toBe(3);
  });

  it("returns current=0 when today has no entry but yesterday does", () => {
    const dates = new Set(["2026-02-27"]);
    const result = calculateStreak(dates, "2026-02-28");
    expect(result.current).toBe(0);
    expect(result.longest).toBe(1);
  });

  it("returns current=1 when only today has an entry", () => {
    const dates = new Set(["2026-02-28"]);
    const result = calculateStreak(dates, "2026-02-28");
    expect(result.current).toBe(1);
    expect(result.longest).toBe(1);
  });

  it("returns current=0 longest=0 for empty set", () => {
    const dates = new Set<string>();
    const result = calculateStreak(dates, "2026-02-28");
    expect(result.current).toBe(0);
    expect(result.longest).toBe(0);
  });

  it("correctly identifies a gap: current stops at gap, longest covers earlier run", () => {
    // streak of 3 in Jan, gap, then 1 day in Feb
    const dates = new Set([
      "2026-01-10",
      "2026-01-11",
      "2026-01-12",
      "2026-02-28",
    ]);
    const result = calculateStreak(dates, "2026-02-28");
    expect(result.current).toBe(1);
    expect(result.longest).toBe(3);
  });

  it("longest equals the longest run when current is shorter", () => {
    // Run of 5 in January, then isolated day today
    const dates = new Set([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
      "2026-02-28",
    ]);
    const result = calculateStreak(dates, "2026-02-28");
    expect(result.current).toBe(1);
    expect(result.longest).toBe(5);
  });

  it("handles month boundary crossing correctly", () => {
    // Jan 31 → Feb 01 → Feb 02 (consecutive across month boundary)
    const dates = new Set(["2026-01-31", "2026-02-01", "2026-02-02"]);
    const result = calculateStreak(dates, "2026-02-02");
    expect(result.current).toBe(3);
    expect(result.longest).toBe(3);
  });

  it("handles year boundary crossing correctly", () => {
    const dates = new Set(["2025-12-30", "2025-12-31", "2026-01-01"]);
    const result = calculateStreak(dates, "2026-01-01");
    expect(result.current).toBe(3);
    expect(result.longest).toBe(3);
  });
});

// ============================================================
// calculateMonthStats
// ============================================================
describe("calculateMonthStats", () => {
  it("returns correct totals for a fully journaled month (28 days, Feb 2026 non-leap)", () => {
    const dates = new Set<string>();
    for (let d = 1; d <= 28; d++) {
      dates.add(`2026-02-${String(d).padStart(2, "0")}`);
    }
    const result = calculateMonthStats(dates, 2026, 1); // month=1 => February
    expect(result.total).toBe(28);
    expect(result.daysInMonth).toBe(28);
    expect(result.percentage).toBe(100);
  });

  it("returns 0/31 for a month with no entries", () => {
    const result = calculateMonthStats(new Set(), 2026, 0); // January
    expect(result.total).toBe(0);
    expect(result.daysInMonth).toBe(31);
    expect(result.percentage).toBe(0);
  });

  it("returns correct percentage for partial month", () => {
    // 10 of 31 days in January 2026
    const dates = new Set<string>();
    for (let d = 1; d <= 10; d++) {
      dates.add(`2026-01-${String(d).padStart(2, "0")}`);
    }
    const result = calculateMonthStats(dates, 2026, 0);
    expect(result.total).toBe(10);
    expect(result.daysInMonth).toBe(31);
    expect(result.percentage).toBe(32); // round(10/31*100) = 32
  });

  it("recognises leap year February (29 days)", () => {
    const result = calculateMonthStats(new Set(), 2024, 1); // 2024 is leap
    expect(result.daysInMonth).toBe(29);
  });

  it("ignores dates from other months", () => {
    const dates = new Set(["2026-01-15", "2026-03-01"]);
    const result = calculateMonthStats(dates, 2026, 1); // February
    expect(result.total).toBe(0);
  });
});

// ============================================================
// calculateYearStats
// ============================================================
describe("calculateYearStats", () => {
  it("returns 0 totals for empty date set", () => {
    const result = calculateYearStats(new Set(), 2026);
    expect(result.total).toBe(0);
    expect(result.percentage).toBe(0);
    expect(result.byMonth).toHaveLength(12);
    expect(result.byMonth.every((v) => v === 0)).toBe(true);
  });

  it("counts entries correctly across months", () => {
    const dates = new Set([
      "2026-01-01",
      "2026-01-02",
      "2026-06-15",
      "2026-12-31",
    ]);
    const result = calculateYearStats(dates, 2026);
    expect(result.total).toBe(4);
    expect(result.byMonth[0]).toBe(2); // January
    expect(result.byMonth[5]).toBe(1); // June
    expect(result.byMonth[11]).toBe(1); // December
  });

  it("ignores dates from other years", () => {
    const dates = new Set(["2025-12-31", "2026-01-01", "2027-01-01"]);
    const result = calculateYearStats(dates, 2026);
    expect(result.total).toBe(1);
    expect(result.byMonth[0]).toBe(1);
  });

  it("correctly uses 366 days for leap year percentage", () => {
    // 2024 is a leap year; 366 total days
    const dates = new Set<string>();
    for (let m = 1; m <= 12; m++) {
      dates.add(`2024-${String(m).padStart(2, "0")}-01`);
    }
    const result = calculateYearStats(dates, 2024);
    expect(result.total).toBe(12);
    expect(result.percentage).toBe(Math.round((12 / 366) * 100));
  });

  it("byMonth array has exactly 12 entries", () => {
    const result = calculateYearStats(new Set(["2026-07-04"]), 2026);
    expect(result.byMonth).toHaveLength(12);
    expect(result.byMonth[6]).toBe(1); // July = index 6
  });
});

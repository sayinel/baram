/**
 * §56g Journal Streaks & Stats — utility functions
 */

/**
 * Calculate current and longest consecutive day streaks.
 * Checks backwards from `today`. A day counts if it appears in `dates`.
 * Capture-only days count for streak (per spec §56g).
 *
 * @param dates - Set of "YYYY-MM-DD" strings representing journaled days
 * @param today - "YYYY-MM-DD" string for today's date
 */
export function calculateStreak(
  dates: Set<string>,
  today: string,
): { current: number; longest: number } {
  if (dates.size === 0) return { current: 0, longest: 0 };

  // Build a sorted array of all date strings (ascending)
  const sorted = Array.from(dates).sort();

  // Calculate longest streak across all dates
  let longest = 1;
  let runLen = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (daysDiff(sorted[i - 1], sorted[i]) === 1) {
      runLen++;
      if (runLen > longest) longest = runLen;
    } else {
      runLen = 1;
    }
  }

  // Calculate current streak going backwards from today
  // Today counts even if not yet journaled if yesterday onward is consecutive,
  // but the spec says "count backwards from today" — so we start from today.
  let current = 0;
  let cursor = today;
  while (dates.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  // Longest must be at least as large as current
  if (current > longest) longest = current;

  return { current, longest };
}

/**
 * Calculate stats for a specific month.
 *
 * @param dates - Set of "YYYY-MM-DD" strings
 * @param year  - full year number (e.g. 2026)
 * @param month - 0-indexed month (0=January … 11=December)
 */
export function calculateMonthStats(
  dates: Set<string>,
  year: number,
  month: number,
): { total: number; daysInMonth: number; percentage: number } {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let total = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (dates.has(dateStr)) total++;
  }
  const percentage =
    daysInMonth > 0 ? Math.round((total / daysInMonth) * 100) : 0;
  return { total, daysInMonth, percentage };
}

/**
 * Calculate stats for a full year.
 *
 * @param dates - Set of "YYYY-MM-DD" strings
 * @param year  - full year number (e.g. 2026)
 */
export function calculateYearStats(
  dates: Set<string>,
  year: number,
): { total: number; percentage: number; byMonth: number[] } {
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const byMonth: number[] = new Array(12).fill(0);
  let total = 0;
  for (let m = 0; m < 12; m++) {
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (dates.has(dateStr)) {
        byMonth[m]++;
        total++;
      }
    }
  }
  const percentage = Math.round((total / daysInYear) * 100);
  return { total, percentage, byMonth };
}

// ---- Internal helpers ----

/** Return true if year is a leap year */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Return the number of calendar days between two "YYYY-MM-DD" strings (b - a).
 * Only meaningful for adjacent-day checks (returns 1 when b is the day after a).
 */
function daysDiff(a: string, b: string): number {
  return (parseDate(b).getTime() - parseDate(a).getTime()) / 86400000;
}

/** Add `n` days to a "YYYY-MM-DD" string and return the result as "YYYY-MM-DD" */
function addDays(dateStr: string, n: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse "YYYY-MM-DD" as a local-midnight Date (avoids UTC offset issues) */
function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

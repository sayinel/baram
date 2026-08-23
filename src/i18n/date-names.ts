// Weekday and month names for the calendar-shaped UI (§56c MiniCalendar, §56g heatmap).
//
// These come from `Intl`, not from the locale files. They used to be hardcoded arrays —
// Korean in MiniCalendar, English in the heatmap — so each one was wrong in the other
// language. Keys would work but would put 19 hand-translated names in every locale file for
// something the platform already knows, and two independent copies drift: the calendar and
// the heatmap would stop agreeing on what to call a Tuesday.

/**
 * ‼️ A SUNDAY. Both callers lay their grid out Sunday-first (`getFirstDayOfWeek` counts from
 * Sunday, and the heatmap's `dayOfWeek` is `Date.getDay()`), so names derived from any other
 * starting weekday would silently rotate the header off the column it labels.
 *
 * 2026-02-01 is a Sunday. Month is 0-based: 1 = February.
 */
const REFERENCE_SUNDAY = new Date(2026, 1, 1);

/** Short month names, January first — `["Jan", …]` / `["1월", …]`. */
export function monthShortNames(intl: string): string[] {
  const format = new Intl.DateTimeFormat(intl, { month: "short" });
  // Day 1 of each month: a month-only format never reads the day, but a day-28+ date would
  // land outside a short February if the year were ever varied.
  return Array.from({ length: 12 }, (_, i) =>
    format.format(new Date(2026, i, 1)),
  );
}

/** Short weekday names, Sunday first — `["Sun", …]` / `["일", …]`. */
export function weekdayShortNames(intl: string): string[] {
  const format = new Intl.DateTimeFormat(intl, { weekday: "short" });
  return Array.from({ length: 7 }, (_, i) =>
    format.format(
      new Date(
        REFERENCE_SUNDAY.getFullYear(),
        REFERENCE_SUNDAY.getMonth(),
        REFERENCE_SUNDAY.getDate() + i,
      ),
    ),
  );
}

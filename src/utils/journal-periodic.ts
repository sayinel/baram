/**
 * §56f — Periodic note (weekly / monthly / yearly) template generation
 */
import {
  formatJournalDate,
  getISOWeekNumber,
  getWeekStartDate,
} from "./journal";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Apply periodic template variables (extends daily template vars) */
export function applyPeriodicTemplate(template: string, date: Date): string {
  const weekNum = getISOWeekNumber(date);
  const weekStart = getWeekStartDate(date);
  const weekEnd = getWeekEndDate(date);
  const y = date.getFullYear();
  const m = date.getMonth();

  return (
    template
      // Weekly variables
      .replace(/\{\{week_number\}\}/g, `W${String(weekNum).padStart(2, "0")}`)
      .replace(/\{\{week_start\}\}/g, formatJournalDate(weekStart))
      .replace(/\{\{week_end\}\}/g, formatJournalDate(weekEnd))
      // Monthly variables
      .replace(/\{\{month_name\}\}/g, MONTH_NAMES[m])
      // Shared variables
      .replace(/\{\{date\}\}/g, formatJournalDate(date))
      .replace(/\{\{year\}\}/g, String(y))
      .replace(/\{\{month\}\}/g, String(m + 1).padStart(2, "0"))
  );
}

/** Generate default monthly note content */
export function generateDefaultMonthly(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  const monthName = MONTH_NAMES[m];

  return `---
type: monthly
month: ${String(m + 1).padStart(2, "0")}
year: ${y}
---

# ${monthName} ${y}

## Summary

## Highlights

## Notes

`;
}

/** Generate default weekly note content */
export function generateDefaultWeekly(date: Date): string {
  const weekNum = getISOWeekNumber(date);
  const start = getWeekStartDate(date);
  const end = getWeekEndDate(date);
  const y = date.getFullYear();

  return `---
type: weekly
week: W${String(weekNum).padStart(2, "0")}
week_start: ${formatJournalDate(start)}
week_end: ${formatJournalDate(end)}
---

# ${y} Week ${weekNum}

## Review

## Goals

## Notes

`;
}

/** Generate default yearly note content */
export function generateDefaultYearly(date: Date): string {
  const y = date.getFullYear();

  return `---
type: yearly
year: ${y}
---

# ${y} Year in Review

## Highlights

## Goals & Reflections

## Notes

`;
}

/** Get the end of ISO week (Sunday) from a given date */
export function getWeekEndDate(date: Date): Date {
  const start = getWeekStartDate(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end;
}

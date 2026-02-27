/**
 * §56 Journal / Daily Notes — utility functions
 */

/** Format a Date as "YYYY-MM-DD" */
export function formatJournalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Format filename from date + format string (e.g. "YYYY-MM-DD.md" → "2026-02-27.md") */
export function formatJournalFilename(date: Date, fmt: string): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return fmt
    .replace("YYYY", y)
    .replace("MM", m)
    .replace("DD", d);
}

/** Check if a string is a valid YYYY-MM-DD date string */
export function isDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Resolve date aliases: "today" → "2026-02-27", "yesterday" → ... */
export function resolveDateAlias(alias: string): string | null {
  const now = new Date();
  switch (alias.toLowerCase()) {
    case "today": {
      return formatJournalDate(now);
    }
    case "yesterday": {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return formatJournalDate(d);
    }
    case "tomorrow": {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return formatJournalDate(d);
    }
    default:
      return null;
  }
}

/** Generate default journal content for a given date */
export function generateDefaultJournal(date: Date): string {
  const dateStr = formatJournalDate(date);
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const dayName = dayNames[date.getDay()];
  return `---
date: ${dateStr}
---

# ${dateStr} ${dayName}

## Notes

`;
}

/** Apply template substitution: {{date}}, {{year}}, {{month}}, {{day}}, {{dayName}} */
export function applyJournalTemplate(template: string, date: Date): string {
  const dateStr = formatJournalDate(date);
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const monthNames = [
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
  return template
    .replace(/\{\{date\}\}/g, dateStr)
    .replace(/\{\{year\}\}/g, String(date.getFullYear()))
    .replace(/\{\{month\}\}/g, String(date.getMonth() + 1).padStart(2, "0"))
    .replace(/\{\{monthName\}\}/g, monthNames[date.getMonth()])
    .replace(/\{\{day\}\}/g, String(date.getDate()).padStart(2, "0"))
    .replace(/\{\{dayName\}\}/g, dayNames[date.getDay()]);
}

/** Build the full path for a journal file */
export function getJournalFilePath(
  rootPath: string,
  journalDir: string,
  date: Date,
  filenameFormat: string,
): string {
  const filename = formatJournalFilename(date, filenameFormat);
  // Normalize: no leading/trailing slashes on journalDir
  const dir = journalDir.replace(/^\/+|\/+$/g, "");
  return `${rootPath}/${dir}/${filename}`;
}

/** Get all days in a month (for calendar grid) */
export function getMonthDays(year: number, month: number): Date[] {
  const days: Date[] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(new Date(year, month, d));
  }
  return days;
}

/** Get the day-of-week (0=Sun) for the first day of a month */
export function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

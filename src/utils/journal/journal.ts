/**
 * §56 Journal / Daily Notes — utility functions
 */

/** Simple FileEntry-like type for migration functions */
interface MigrationEntry {
  isDir: boolean;
  name: string;
  path: string;
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
  return (
    template
      .replace(/\{\{date\}\}/g, dateStr)
      .replace(/\{\{year\}\}/g, String(date.getFullYear()))
      .replace(/\{\{month\}\}/g, String(date.getMonth() + 1).padStart(2, "0"))
      .replace(/\{\{monthName\}\}/g, monthNames[date.getMonth()])
      .replace(/\{\{day\}\}/g, String(date.getDate()).padStart(2, "0"))
      .replace(/\{\{dayName\}\}/g, dayNames[date.getDay()])
      // §P1: '오늘의 질문' 프롬프트 제거 — 잔류 플레이스홀더는 빈 문자열로 치환
      .replace(/\{\{daily_prompt\}\}/g, "")
  );
}

/**
 * Build a reverse migration plan: hierarchy → flat.
 */
export function buildFlattenPlan(
  journalDir: string,
  hierarchicalFiles: MigrationEntry[],
): { from: string; to: string }[] {
  const plan: { from: string; to: string }[] = [];
  for (const file of hierarchicalFiles) {
    const to = hierarchicalToFlatPath(journalDir, file.path);
    if (to) {
      plan.push({ from: file.path, to });
    }
  }
  return plan;
}

/**
 * Build a migration plan: list of { from, to } path pairs.
 */
export function buildMigrationPlan(
  journalDir: string,
  flatFiles: MigrationEntry[],
): { from: string; to: string }[] {
  const plan: { from: string; to: string }[] = [];
  for (const file of flatFiles) {
    const to = flatToHierarchicalPath(journalDir, file.path);
    if (to) {
      plan.push({ from: file.path, to });
    }
  }
  return plan;
}

/**
 * Detect flat YYYY-MM-DD.md journal files in the root of journalDir.
 * These are candidates for migration to hierarchical structure.
 */
export function detectFlatJournalFiles(
  entries: MigrationEntry[],
): MigrationEntry[] {
  return entries.filter((e) => {
    if (e.isDir) return false;
    const basename = e.name.replace(/\.md$/, "");
    return isDateString(basename);
  });
}

/**
 * Detect hierarchical journal files (daily/YYYY/MM/YYYY-MM-DD.md) for reverse migration.
 */
export function detectHierarchicalJournalFiles(
  journalDir: string,
  entries: MigrationEntry[],
): MigrationEntry[] {
  return entries.filter((e) => {
    if (e.isDir) return false;
    return hierarchicalToFlatPath(journalDir, e.path) !== null;
  });
}

/**
 * Convert a flat journal path (root/YYYY-MM-DD.md) to hierarchical (root/daily/YYYY/MM/YYYY-MM-DD.md).
 * Returns null if the filename isn't a date or is already in daily/ structure.
 */
export function flatToHierarchicalPath(
  journalDir: string,
  flatPath: string,
): null | string {
  // Skip files already in subdirectories
  const relative = flatPath.slice(journalDir.length + 1);
  if (relative.includes("/")) return null;

  const basename = relative.replace(/\.md$/, "");
  if (!isDateString(basename)) return null;

  const [y, m] = basename.split("-");
  return `${journalDir}/daily/${y}/${m}/${relative}`;
}

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
  return fmt.replace("YYYY", y).replace("MM", m).replace("DD", d);
}

/** Format a date as "January 1st (Thursday), 2026" */
export function formatReadableDate(date: Date): string {
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
  const day = date.getDate();
  return `${monthNames[date.getMonth()]} ${day}${getOrdinalSuffix(day)} (${dayNames[date.getDay()]}), ${date.getFullYear()}`;
}

/** Generate default journal content for a given date */
export function generateDefaultJournal(date: Date): string {
  const dateStr = formatJournalDate(date);
  return `---
date: ${dateStr}
---

# ${formatReadableDate(date)}

## Diary



## Notes

`;
}

/** Get the day-of-week (0=Sun) for the first day of a month */
export function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

// --- §56a Hierarchical Journal Paths ---

/**
 * Build a hierarchical journal file path: daily/YYYY/MM/YYYY-MM-DD.md
 */
export function getHierarchicalJournalPath(
  journalDir: string,
  date: Date,
  filenameFormat: string,
): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const filename = formatJournalFilename(date, filenameFormat);
  return `${journalDir}/daily/${y}/${m}/${filename}`;
}

/** Get ISO 8601 week number (Monday-based) */
export function getISOWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Build the full path for a journal file */
export function getJournalFilePath(
  rootPath: null | string,
  journalDir: string,
  date: Date,
  filenameFormat: string,
): null | string {
  const dir = resolveJournalDir(rootPath, journalDir);
  if (!dir) return null;
  return `${dir}/${formatJournalFilename(date, filenameFormat)}`;
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

/** Build monthly journal path: monthly/YYYY/YYYY-MM.md */
export function getMonthlyJournalPath(journalDir: string, date: Date): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${journalDir}/monthly/${y}/${y}-${m}.md`;
}

/** Get English ordinal suffix for a day number (1st, 2nd, 3rd, 4th...) */
export function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** Build weekly journal path: weekly/YYYY/YYYY-Www.md */
export function getWeeklyJournalPath(journalDir: string, date: Date): string {
  const y = String(date.getFullYear());
  const w = String(getISOWeekNumber(date)).padStart(2, "0");
  return `${journalDir}/weekly/${y}/${y}-W${w}.md`;
}

/** Get the Monday of the ISO week containing the given date */
export function getWeekStartDate(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

// --- §56a Periodic Note Paths (weekly / monthly / yearly) ---

/** Build yearly journal path: yearly/YYYY.md */
export function getYearlyJournalPath(journalDir: string, date: Date): string {
  const y = String(date.getFullYear());
  return `${journalDir}/yearly/${y}.md`;
}

/**
 * Convert a hierarchical journal path (root/daily/YYYY/MM/YYYY-MM-DD.md) to flat (root/YYYY-MM-DD.md).
 * Returns null if the file isn't in a daily/ hierarchy or isn't a date-named file.
 */
export function hierarchicalToFlatPath(
  journalDir: string,
  filePath: string,
): null | string {
  const relative = filePath.slice(journalDir.length + 1);
  // Must be in daily/YYYY/MM/filename.md structure
  const match = relative.match(/^daily\/\d{4}\/\d{2}\/(.+\.md)$/);
  if (!match) return null;
  const filename = match[1];
  const basename = filename.replace(/\.md$/, "");
  if (!isDateString(basename)) return null;
  return `${journalDir}/${filename}`;
}

/** Check if a string is a valid YYYY-MM-DD date string */
export function isDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Resolve date aliases: "today" → "2026-02-27", "yesterday" → ... */
export function resolveDateAlias(alias: string): null | string {
  const now = new Date();
  switch (alias.toLowerCase()) {
    case "today": {
      return formatJournalDate(now);
    }
    case "tomorrow": {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return formatJournalDate(d);
    }
    case "yesterday": {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return formatJournalDate(d);
    }
    default:
      return null;
  }
}

/**
 * Resolve journal directory to an absolute path.
 * Only absolute paths are accepted — relative paths return null.
 */
export function resolveJournalDir(
  _rootPath: null | string,
  journalDir: string,
): null | string {
  if (!journalDir) return null;
  if (journalDir.startsWith("/") || /^[A-Z]:\\/.test(journalDir)) {
    return journalDir;
  }
  return null; // relative path not supported
}

// --- §56a Journal Hidden Entries ---

/** Regex matching flat daily journal filenames: YYYY-MM-DD.md */
export const JOURNAL_FILENAME_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

/** Capturing variant: groups are [year, month, day] */
export const JOURNAL_DATE_PARTS_RE = /^(\d{4})-(\d{2})-(\d{2})\.md$/;

/** Regex matching compact daily journal filenames: YYYYMMDD.md */
export const JOURNAL_FILENAME_COMPACT_RE = /^\d{8}\.md$/;

/** Entries hidden from FileTree when journal-scoped */
export const JOURNAL_HIDDEN_ENTRIES = [".journal.json", "assets"];

/** Check if a file/folder name should be hidden in journal FileTree */
export function isJournalHiddenEntry(name: string): boolean {
  return JOURNAL_HIDDEN_ENTRIES.includes(name);
}

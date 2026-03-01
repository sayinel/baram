// §56j AI Reflection — journal entry analysis utilities

export interface JournalEntry {
  date: string;
  content: string;
}

export interface ReflectionDateRange {
  startDate: Date;
  endDate: Date;
  filePattern: string;
}

/**
 * Build system+user prompt for LLM reflection of journal entries.
 */
export function buildReflectionPrompt(
  entries: JournalEntry[],
  period: "week" | "month",
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt =
    "You are a thoughtful journal reflection assistant. Analyze the following journal entries and provide insights. Write in Korean. Be warm and encouraging.";

  const instruction =
    period === "week"
      ? "이번 주 일기를 분석해서 주요 패턴, 감정 흐름, 성장 포인트를 정리해주세요."
      : "이번 달 일기를 분석해서 주요 테마, 감정 변화, 목표 달성도, 성찰을 정리해주세요.";

  if (entries.length === 0) {
    const userPrompt = `${instruction}\n\n(작성된 일기가 없습니다.)`;
    return { systemPrompt, userPrompt };
  }

  const entriesText = entries
    .map((e) => `### ${e.date}\n\n${e.content.trim()}`)
    .join("\n\n---\n\n");

  const userPrompt = `${instruction}\n\n## 일기 목록\n\n${entriesText}`;
  return { systemPrompt, userPrompt };
}

/**
 * Returns date range and file glob pattern for the reflection period.
 * Week: 7 days ending on (and including) the given date's day.
 * Month: full calendar month of the given date.
 */
export function extractReflectionEntries(
  _dir: string,
  period: "week" | "month",
  date: Date,
): ReflectionDateRange {
  if (period === "week") {
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date(date);
    startDate.setDate(date.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);

    const startYYYY = startDate.getFullYear();
    const startMM = String(startDate.getMonth() + 1).padStart(2, "0");
    const endMM = String(endDate.getMonth() + 1).padStart(2, "0");
    const filePattern =
      startMM === endMM
        ? `${startYYYY}-${startMM}-*.md`
        : `${startYYYY}-{${startMM},${endMM}}-*.md`;

    return { startDate, endDate, filePattern };
  } else {
    // month
    const startDate = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
    const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const filePattern = `${yyyy}-${mm}-*.md`;

    return { startDate, endDate, filePattern };
  }
}

/**
 * Wraps AI reflection output in a markdown note with frontmatter.
 */
export function formatReflectionMarkdown(
  reflection: string,
  period: "week" | "month",
  startDate: Date,
  endDate: Date,
): string {
  const now = new Date();
  const createdAt = formatDate(now);
  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);
  const periodLabel = period === "week" ? "주간 회고" : "월간 회고";

  const frontmatter = [
    "---",
    `type: reflection`,
    `period: ${period}`,
    `start: ${startStr}`,
    `end: ${endStr}`,
    `created: ${createdAt}`,
    "---",
  ].join("\n");

  const title = `# ${periodLabel} (${startStr} ~ ${endStr})`;

  return `${frontmatter}\n\n${title}\n\n${reflection.trim()}\n`;
}

/** Format Date as YYYY-MM-DD */
function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

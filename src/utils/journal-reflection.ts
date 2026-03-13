// §56j AI Reflection — journal entry analysis utilities

export interface JournalEntry {
  content: string;
  date: string;
}

export interface ReflectionDateRange {
  endDate: Date;
  filePattern: string;
  startDate: Date;
}

/**
 * §56j Emotion Inference — build prompt for mood inference from diary text.
 */
export function buildEmotionInferencePrompt(diaryText: string): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt =
    "일기 텍스트에서 감정을 분석합니다. 반드시 deep, calm, neutral, warm, bright 중 하나만 답변하세요. 다른 말은 하지 마세요.";

  const trimmed = diaryText.trim();
  if (!trimmed) {
    return { systemPrompt, userPrompt: "(일기 내용이 비어 있습니다.)" };
  }

  const userPrompt = `다음 일기의 전체적인 감정을 분석해주세요.\n\n${trimmed}`;
  return { systemPrompt, userPrompt };
}

/**
 * §56j Auto Follow-Up — build prompt for follow-up questions after diary writing.
 */
export function buildFollowUpPrompt(diaryText: string): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    "You are a thoughtful journal companion.",
    "Your ONLY task is to generate 1-2 follow-up questions that help the writer reflect more deeply on their diary entry.",
    "",
    "Rules:",
    "- Output ONLY questions, nothing else. No summaries, no analysis, no commentary.",
    "- Each question must end with a question mark (?).",
    "- Questions should encourage deeper self-reflection, not just repeat what was written.",
    "- Match the language of the diary entry (if written in Korean, ask in Korean; if in English, ask in English).",
    "- Keep questions concise (1-2 sentences each).",
    "- Separate multiple questions with a blank line.",
  ].join("\n");

  const trimmed = diaryText.trim();
  if (!trimmed) {
    return { systemPrompt, userPrompt: "(No diary content provided.)" };
  }

  const userPrompt = `Read the following diary entry and suggest 1-2 follow-up questions for deeper reflection.\n\n---\n${trimmed}\n---`;
  return { systemPrompt, userPrompt };
}

/**
 * §56j §11.2 Monthly Summary — build prompt for auto summary suggestion on monthly notes.
 */
export function buildMonthlySummaryPrompt(
  entries: { content: string; date: string }[],
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt =
    "당신은 저널 분석 도우미입니다. 사용자의 이번 달 일기를 3줄로 요약하세요. 주요 사건, 감정 흐름, 성장 포인트를 포함하세요. 한국어로 답변하세요.";

  if (entries.length === 0) {
    return { systemPrompt, userPrompt: "이번 달 작성된 일기가 없습니다." };
  }

  const entriesText = entries
    .map((e) => `### ${e.date}\n\n${e.content.trim()}`)
    .join("\n\n---\n\n");

  const userPrompt = `이번 달 일기를 3줄로 요약해주세요. 주요 사건, 감정 흐름, 성장 포인트를 포함하세요.\n\n## 일기 목록\n\n${entriesText}`;
  return { systemPrompt, userPrompt };
}

/**
 * Build system+user prompt for LLM reflection of journal entries.
 */
export function buildReflectionPrompt(
  entries: JournalEntry[],
  period: "month" | "week",
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
 * §56j §11.2 Weekly Pattern Analysis — build prompt for auto pattern suggestion on weekly notes.
 */
export function buildWeeklyPatternPrompt(
  entries: { content: string; date: string }[],
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt =
    "당신은 저널 분석 도우미입니다. 사용자의 이번 주 일기를 분석하여 발견되는 패턴, 반복되는 주제, 감정 변화를 3줄 이내로 요약하세요. 한국어로 답변하세요.";

  if (entries.length === 0) {
    return { systemPrompt, userPrompt: "이번 주 작성된 일기가 없습니다." };
  }

  const entriesText = entries
    .map((e) => `### ${e.date}\n\n${e.content.trim()}`)
    .join("\n\n---\n\n");

  const userPrompt = `이번 주 일기를 분석하여 패턴, 반복 주제, 감정 변화를 3줄 이내로 요약해주세요.\n\n## 일기 목록\n\n${entriesText}`;
  return { systemPrompt, userPrompt };
}

/**
 * Returns date range and file glob pattern for the reflection period.
 * Week: 7 days ending on (and including) the given date's day.
 * Month: full calendar month of the given date.
 */
export function extractReflectionEntries(
  _dir: string,
  period: "month" | "week",
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
    const startDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      1,
      0,
      0,
      0,
      0,
    );
    const endDate = new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

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
  period: "month" | "week",
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

/** Valid mood values for emotion inference */
const VALID_MOODS = ["deep", "calm", "neutral", "warm", "bright"] as const;

/**
 * §56j Emotion Inference — parse LLM response to extract a MoodValue.
 * Handles noisy responses by scanning for the first valid mood keyword.
 */
export function parseEmotionResponse(
  text: string,
): "bright" | "calm" | "deep" | "neutral" | "warm" | null {
  const lower = text.trim().toLowerCase();
  for (const mood of VALID_MOODS) {
    if (lower.includes(mood)) {
      return mood;
    }
  }
  return null;
}

/** Format Date as YYYY-MM-DD */
function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

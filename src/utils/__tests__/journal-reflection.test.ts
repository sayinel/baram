/**
 * §56j AI Reflection utility tests
 */
import { describe, it, expect } from "vitest";
import {
  buildReflectionPrompt,
  extractReflectionEntries,
  formatReflectionMarkdown,
} from "../journal-reflection";

// ─── buildReflectionPrompt ──────────────────────────────────────────────────

describe("buildReflectionPrompt — week", () => {
  it("returns system prompt about reflection assistant", () => {
    const { systemPrompt } = buildReflectionPrompt([], "week");
    expect(systemPrompt).toContain("journal reflection assistant");
    expect(systemPrompt).toContain("Korean");
  });

  it("includes week instruction for period=week", () => {
    const { userPrompt } = buildReflectionPrompt([], "week");
    expect(userPrompt).toContain("이번 주 일기");
    expect(userPrompt).toContain("패턴");
  });

  it("includes month instruction for period=month", () => {
    const { userPrompt } = buildReflectionPrompt([], "month");
    expect(userPrompt).toContain("이번 달 일기");
    expect(userPrompt).toContain("테마");
  });

  it("handles empty entries gracefully", () => {
    const { userPrompt } = buildReflectionPrompt([], "week");
    expect(userPrompt).toContain("작성된 일기가 없습니다");
  });

  it("includes entry dates and content in prompt", () => {
    const entries = [
      { date: "2026-02-23", content: "오늘은 코딩을 많이 했다." },
      { date: "2026-02-24", content: "좋은 하루였다." },
    ];
    const { userPrompt } = buildReflectionPrompt(entries, "week");
    expect(userPrompt).toContain("2026-02-23");
    expect(userPrompt).toContain("오늘은 코딩을 많이 했다.");
    expect(userPrompt).toContain("2026-02-24");
    expect(userPrompt).toContain("좋은 하루였다.");
  });

  it("separates multiple entries with dividers", () => {
    const entries = [
      { date: "2026-02-23", content: "Entry A" },
      { date: "2026-02-24", content: "Entry B" },
    ];
    const { userPrompt } = buildReflectionPrompt(entries, "week");
    expect(userPrompt).toContain("---");
  });

  it("single entry — no extra dividers needed, still contains the content", () => {
    const entries = [{ date: "2026-02-23", content: "단일 항목" }];
    const { userPrompt } = buildReflectionPrompt(entries, "week");
    expect(userPrompt).toContain("단일 항목");
  });
});

// ─── extractReflectionEntries ───────────────────────────────────────────────

describe("extractReflectionEntries — week", () => {
  it("week period returns 7-day range ending on the given date", () => {
    const date = new Date(2026, 1, 28); // 2026-02-28
    const { startDate, endDate } = extractReflectionEntries("/journal", "week", date);

    expect(endDate.getFullYear()).toBe(2026);
    expect(endDate.getMonth()).toBe(1); // Feb
    expect(endDate.getDate()).toBe(28);

    expect(startDate.getFullYear()).toBe(2026);
    expect(startDate.getMonth()).toBe(1);
    expect(startDate.getDate()).toBe(22); // 28 - 6 = 22
  });

  it("week period: startDate is at midnight, endDate is end-of-day", () => {
    const date = new Date(2026, 1, 28);
    const { startDate, endDate } = extractReflectionEntries("/journal", "week", date);
    expect(startDate.getHours()).toBe(0);
    expect(startDate.getMinutes()).toBe(0);
    expect(endDate.getHours()).toBe(23);
    expect(endDate.getMinutes()).toBe(59);
  });

  it("week spanning two months returns cross-month file pattern", () => {
    // 2026-03-04: 7-day window spans Feb and Mar
    const date = new Date(2026, 2, 4); // March 4
    const { startDate, filePattern } = extractReflectionEntries("/journal", "week", date);
    expect(startDate.getDate()).toBe(26); // March 4 - 6 = Feb 26
    // Pattern includes both months
    expect(filePattern).toMatch(/02|03/);
  });
});

describe("extractReflectionEntries — month", () => {
  it("month period returns full calendar month range", () => {
    const date = new Date(2026, 1, 15); // mid-Feb
    const { startDate, endDate } = extractReflectionEntries("/journal", "month", date);

    expect(startDate.getDate()).toBe(1);
    expect(startDate.getMonth()).toBe(1); // Feb
    expect(startDate.getFullYear()).toBe(2026);

    expect(endDate.getDate()).toBe(28); // Feb 2026 has 28 days
    expect(endDate.getMonth()).toBe(1);
  });

  it("month period returns YYYY-MM-*.md file pattern", () => {
    const date = new Date(2026, 1, 15);
    const { filePattern } = extractReflectionEntries("/journal", "month", date);
    expect(filePattern).toBe("2026-02-*.md");
  });
});

// ─── formatReflectionMarkdown ────────────────────────────────────────────────

describe("formatReflectionMarkdown", () => {
  const startDate = new Date(2026, 1, 22); // Feb 22
  const endDate = new Date(2026, 1, 28);   // Feb 28
  const reflection = "이번 주 많이 성장했습니다.";

  it("includes frontmatter with type=reflection", () => {
    const md = formatReflectionMarkdown(reflection, "week", startDate, endDate);
    expect(md).toContain("type: reflection");
    expect(md).toContain("period: week");
  });

  it("includes start and end dates in frontmatter", () => {
    const md = formatReflectionMarkdown(reflection, "week", startDate, endDate);
    expect(md).toContain("start: 2026-02-22");
    expect(md).toContain("end: 2026-02-28");
  });

  it("includes h1 title with 주간 회고 for week", () => {
    const md = formatReflectionMarkdown(reflection, "week", startDate, endDate);
    expect(md).toContain("# 주간 회고");
  });

  it("includes h1 title with 월간 회고 for month", () => {
    const start = new Date(2026, 1, 1);
    const end = new Date(2026, 1, 28);
    const md = formatReflectionMarkdown(reflection, "month", start, end);
    expect(md).toContain("# 월간 회고");
    expect(md).toContain("period: month");
  });

  it("wraps reflection body in the output", () => {
    const md = formatReflectionMarkdown(reflection, "week", startDate, endDate);
    expect(md).toContain("이번 주 많이 성장했습니다.");
  });

  it("output starts with frontmatter delimiter", () => {
    const md = formatReflectionMarkdown(reflection, "week", startDate, endDate);
    expect(md.startsWith("---")).toBe(true);
  });
});

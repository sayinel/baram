/**
 * §56c Phase B — Memories View utility tests
 * TDD Red Phase: all tests should FAIL before implementation
 */
import { describe, it, expect } from "vitest";
import { extractOneLine, groupMemoriesByYear } from "../journal-memories";

describe("§56c extractOneLine", () => {
  it("returns frontmatter oneline field if present", () => {
    const content = `---
date: 2026-02-28
oneline: "봄이 시작되는 느낌의 하루"
---

# 2026-02-28 Friday

## Diary

오늘은 따뜻했다.`;
    expect(extractOneLine(content)).toBe("봄이 시작되는 느낌의 하루");
  });

  it("extracts from Diary section when no oneline field", () => {
    const content = `---
date: 2026-02-28
---

# 2026-02-28 Friday

## Diary

첫 출근. 설렘과 긴장이 공존하는 하루.

다음 문장은 무시.

## Captures

- ✦ 아이디어 메모`;
    expect(extractOneLine(content)).toBe("첫 출근. 설렘과 긴장이 공존하는 하루.");
  });

  it("skips Captures section content", () => {
    const content = `---
date: 2026-02-28
---

# 2026-02-28

## Captures

- ✦ 이것은 캡처 아이템

## Diary

실제 일기 내용입니다.`;
    expect(extractOneLine(content)).toBe("실제 일기 내용입니다.");
  });

  it("falls back to full body when no ## Diary heading", () => {
    const content = `---
date: 2026-02-28
---

# 2026-02-28 Friday

카페에서 책 읽으며 하루 보냄.`;
    expect(extractOneLine(content)).toBe("카페에서 책 읽으며 하루 보냄.");
  });

  it("skips headings and empty lines", () => {
    const content = `---
date: 2026-02-28
---

# 2026-02-28

## Diary

### 오전

드디어 좋은 소식이 왔다.`;
    expect(extractOneLine(content)).toBe("드디어 좋은 소식이 왔다.");
  });

  it("truncates at 100 characters with ellipsis", () => {
    const longText = "가".repeat(120);
    const content = `---
date: 2026-02-28
---

# 2026-02-28

## Diary

${longText}`;
    const result = extractOneLine(content);
    expect(result.length).toBeLessThanOrEqual(101); // 100 chars + …
    expect(result.endsWith("…")).toBe(true);
  });

  it("extracts first sentence ending with period", () => {
    const content = `---
date: 2026-02-28
---

## Diary

좋은 하루였다. 내일도 기대된다.`;
    expect(extractOneLine(content)).toBe("좋은 하루였다.");
  });

  it("returns empty string for empty content", () => {
    expect(extractOneLine("")).toBe("");
  });

  it("returns empty string for frontmatter-only content", () => {
    const content = `---
date: 2026-02-28
---`;
    expect(extractOneLine(content)).toBe("");
  });
});

describe("§56c groupMemoriesByYear", () => {
  it("groups entries by year in reverse order", () => {
    const entries = [
      { year: 2024, path: "/j/daily/2024/02/2024-02-28.md", content: "내용1" },
      { year: 2026, path: "/j/daily/2026/02/2026-02-28.md", content: "내용2" },
      { year: 2025, path: "/j/daily/2025/02/2025-02-28.md", content: "내용3" },
    ];
    const result = groupMemoriesByYear(entries);
    expect(result.map((g) => g.year)).toEqual([2026, 2025, 2024]);
  });

  it("returns empty array for no entries", () => {
    expect(groupMemoriesByYear([])).toEqual([]);
  });

  it("includes path and content in each group", () => {
    const entries = [
      { year: 2025, path: "/j/2025.md", content: "테스트" },
    ];
    const result = groupMemoriesByYear(entries);
    expect(result[0]).toEqual({ year: 2025, path: "/j/2025.md", content: "테스트" });
  });
});

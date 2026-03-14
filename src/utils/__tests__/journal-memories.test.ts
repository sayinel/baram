/**
 * §56c Phase B — Memories View utility tests
 * TDD Red Phase: all tests should FAIL before implementation
 */
import { describe, expect, it } from "vitest";

import {
  extractDiarySection,
  extractImages,
  extractOneLine,
  groupMemoriesByYear,
  renderSimpleMarkdown,
  updateOneLineFrontmatter,
} from "../journal/journal-memories";

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
    expect(extractOneLine(content)).toBe(
      "첫 출근. 설렘과 긴장이 공존하는 하루.",
    );
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

describe("§56c extractDiarySection", () => {
  it("extracts content between ## Diary and next ## heading", () => {
    const content = `---
date: 2026-02-28
---

# February 28th (Saturday), 2026

## Diary

오늘 날씨가 좋았다.
카페에서 코딩했다.

## Notes

메모 내용`;
    expect(extractDiarySection(content)).toBe(
      "오늘 날씨가 좋았다.\n카페에서 코딩했다.",
    );
  });

  it("extracts to end if no next section", () => {
    const content = `---
date: 2026-02-28
---

# Title

## Diary

일기 내용만 있음.`;
    expect(extractDiarySection(content)).toBe("일기 내용만 있음.");
  });

  it("returns empty string when no Diary section", () => {
    const content = `---
date: 2026-02-28
---

# Title

그냥 내용.`;
    expect(extractDiarySection(content)).toBe("");
  });

  it("returns empty string for empty content", () => {
    expect(extractDiarySection("")).toBe("");
  });
});

describe("§56c renderSimpleMarkdown", () => {
  it("renders paragraphs", () => {
    expect(renderSimpleMarkdown("Hello world")).toContain("<p>Hello world</p>");
  });

  it("renders bold and italic", () => {
    const html = renderSimpleMarkdown("**bold** and *italic*");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders inline code", () => {
    expect(renderSimpleMarkdown("use `console.log`")).toContain(
      "<code>console.log</code>",
    );
  });

  it("renders links", () => {
    expect(renderSimpleMarkdown("[click](https://example.com)")).toContain(
      '<a href="https://example.com">click</a>',
    );
  });

  it("renders headings", () => {
    expect(renderSimpleMarkdown("### Title")).toContain("<h3>Title</h3>");
  });

  it("renders unordered lists", () => {
    const html = renderSimpleMarkdown("- item 1\n- item 2");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>item 1</li>");
    expect(html).toContain("<li>item 2</li>");
  });

  it("renders ordered lists", () => {
    const html = renderSimpleMarkdown("1. first\n2. second");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
  });

  it("renders blockquotes", () => {
    const html = renderSimpleMarkdown("> quoted text");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("quoted text");
  });

  it("renders strikethrough", () => {
    expect(renderSimpleMarkdown("~~deleted~~")).toContain("<del>deleted</del>");
  });

  it("escapes HTML entities", () => {
    const html = renderSimpleMarkdown("a < b & c > d");
    expect(html).toContain("&lt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&gt;");
  });

  it("returns empty string for empty input", () => {
    expect(renderSimpleMarkdown("")).toBe("");
  });

  it("renders images with relative paths", () => {
    const html = renderSimpleMarkdown("![sunset](assets/sunset.jpg)");
    expect(html).toContain('<img alt="sunset" src="assets/sunset.jpg"/>');
  });

  it("renders images with underscores in filename", () => {
    const html = renderSimpleMarkdown(
      "![20260301\\_162051](./assets/20260301_162051.jpg)",
    );
    expect(html).toContain('src="./assets/20260301_162051.jpg"');
    expect(html).not.toContain("<em>");
  });

  it("renders image in diary context", () => {
    const diary = extractDiarySection(`---
date: 2026-03-07
---

# March 7th (Saturday), 2026

## Diary

오늘의 사진:

![카페](assets/cafe.jpg)

## Notes
`);
    expect(diary).toContain("![카페](assets/cafe.jpg)");
    const html = renderSimpleMarkdown(diary);
    expect(html).toContain('<img alt="카페" src="assets/cafe.jpg"/>');
  });
});

describe("§56c extractImages", () => {
  it("extracts markdown image references", () => {
    const content = `# Journal

![sunset](photos/sunset.jpg)

Some text.

![](https://example.com/img.png)`;
    const result = extractImages(content);
    expect(result).toEqual([
      { alt: "sunset", src: "photos/sunset.jpg" },
      { alt: "", src: "https://example.com/img.png" },
    ]);
  });

  it("returns empty array for content without images", () => {
    expect(extractImages("No images here.")).toEqual([]);
  });

  it("returns empty array for empty content", () => {
    expect(extractImages("")).toEqual([]);
  });

  it("handles multiple images on same line", () => {
    const content = "![a](1.png) ![b](2.png)";
    expect(extractImages(content)).toEqual([
      { alt: "a", src: "1.png" },
      { alt: "b", src: "2.png" },
    ]);
  });
});

describe("§56c updateOneLineFrontmatter", () => {
  it("updates existing oneline in frontmatter", () => {
    const content = `---
date: 2026-03-01
oneline: "이전 한 줄"
---

# 2026-03-01`;
    const result = updateOneLineFrontmatter(content, "새로운 한 줄");
    expect(result).toContain('oneline: "새로운 한 줄"');
    expect(result).not.toContain("이전 한 줄");
    expect(result).toContain("date: 2026-03-01");
  });

  it("appends oneline to existing frontmatter without it", () => {
    const content = `---
date: 2026-03-01
---

# 2026-03-01`;
    const result = updateOneLineFrontmatter(content, "새 요약");
    expect(result).toContain('oneline: "새 요약"');
    expect(result).toContain("date: 2026-03-01");
    // Frontmatter should still be properly delimited
    expect(result.startsWith("---\n")).toBe(true);
    expect(result).toContain("\n---\n");
  });

  it("creates frontmatter if none exists", () => {
    const content = "# 2026-03-01\n\nNo frontmatter here.";
    const result = updateOneLineFrontmatter(content, "첫 요약");
    expect(result).toBe(
      `---\noneline: "첫 요약"\n---\n# 2026-03-01\n\nNo frontmatter here.`,
    );
  });

  it("preserves content after frontmatter", () => {
    const content = `---
date: 2026-03-01
oneline: "old"
---

## Diary

오늘의 내용.`;
    const result = updateOneLineFrontmatter(content, "new");
    expect(result).toContain('oneline: "new"');
    expect(result).toContain("## Diary");
    expect(result).toContain("오늘의 내용.");
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
    const entries = [{ year: 2025, path: "/j/2025.md", content: "테스트" }];
    const result = groupMemoriesByYear(entries);
    expect(result[0]).toEqual({
      year: 2025,
      path: "/j/2025.md",
      content: "테스트",
    });
  });
});

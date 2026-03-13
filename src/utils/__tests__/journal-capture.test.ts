/**
 * §56l Phase B — Daily Capture utility tests
 * TDD Red Phase: all tests should FAIL before implementation
 */
import { describe, expect, it } from "vitest";

import {
  buildNoteFromCapture,
  buildPromotedCaptureLink,
  CAPTURE_ICONS,
  CAPTURE_TYPES,
  type CaptureItem,
  extractCapturesSection,
  insertCaptureIntoContent,
  parseCapturesFromMarkdown,
  serializeCaptureToMarkdown,
} from "../journal-capture";

describe("§56l Capture types and constants", () => {
  it("has 4 capture types", () => {
    expect(CAPTURE_TYPES).toEqual(["idea", "link", "quote", "note"]);
  });

  it("maps types to icons", () => {
    expect(CAPTURE_ICONS.idea).toBe("✦");
    expect(CAPTURE_ICONS.link).toBe("↗");
    expect(CAPTURE_ICONS.quote).toBe("❝");
    expect(CAPTURE_ICONS.note).toBe("☰");
  });
});

describe("§56l parseCapturesFromMarkdown", () => {
  it("parses idea capture", () => {
    const md = `## Captures

- ✦ **새 프로젝트**: CLI 기반 저널 도구 #아이디어`;
    const items = parseCapturesFromMarkdown(md);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("idea");
    expect(items[0].title).toBe("새 프로젝트");
    expect(items[0].body).toBe("CLI 기반 저널 도구 #아이디어");
  });

  it("parses link capture", () => {
    const md = `## Captures

- ↗ [Tiptap 릴리즈](https://tiptap.dev) — 업그레이드 참고`;
    const items = parseCapturesFromMarkdown(md);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("link");
    expect(items[0].title).toBe("Tiptap 릴리즈");
    expect(items[0].url).toBe("https://tiptap.dev");
    expect(items[0].body).toBe("업그레이드 참고");
  });

  it("parses quote capture", () => {
    const md = `## Captures

- ❝ "The best way to predict the future is to invent it." — Alan Kay`;
    const items = parseCapturesFromMarkdown(md);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("quote");
    expect(items[0].body).toContain("The best way to predict the future");
  });

  it("parses note capture", () => {
    const md = `## Captures

- ☰ 내일 회의 전에 디자인 문서 검토 필요`;
    const items = parseCapturesFromMarkdown(md);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("note");
    expect(items[0].body).toBe("내일 회의 전에 디자인 문서 검토 필요");
  });

  it("parses multiple captures", () => {
    const md = `## Captures

- ✦ **아이디어**: 뭔가 좋은 것
- ↗ [링크](https://example.com) — 설명
- ❝ "인용" — 출처
- ☰ 메모`;
    const items = parseCapturesFromMarkdown(md);
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.type)).toEqual(["idea", "link", "quote", "note"]);
  });

  it("returns empty array when no Captures section", () => {
    const md = `## Diary

오늘의 일기`;
    expect(parseCapturesFromMarkdown(md)).toEqual([]);
  });

  it("returns empty array for empty captures section", () => {
    const md = `## Captures

## Diary

일기 내용`;
    expect(parseCapturesFromMarkdown(md)).toEqual([]);
  });
});

describe("§56l serializeCaptureToMarkdown", () => {
  it("serializes idea capture", () => {
    const item: CaptureItem = {
      type: "idea",
      title: "새 프로젝트",
      body: "CLI 저널 도구",
      tags: ["아이디어"],
    };
    expect(serializeCaptureToMarkdown(item)).toBe(
      "- ✦ **새 프로젝트**: CLI 저널 도구 #아이디어",
    );
  });

  it("serializes link capture", () => {
    const item: CaptureItem = {
      type: "link",
      title: "Tiptap",
      url: "https://tiptap.dev",
      body: "릴리즈 노트",
    };
    expect(serializeCaptureToMarkdown(item)).toBe(
      "- ↗ [Tiptap](https://tiptap.dev) — 릴리즈 노트",
    );
  });

  it("serializes quote capture", () => {
    const item: CaptureItem = {
      type: "quote",
      body: "Invent the future",
      source: "Alan Kay",
    };
    expect(serializeCaptureToMarkdown(item)).toBe(
      '- ❝ "Invent the future" — Alan Kay',
    );
  });

  it("serializes note capture", () => {
    const item: CaptureItem = { type: "note", body: "간단 메모" };
    expect(serializeCaptureToMarkdown(item)).toBe("- ☰ 간단 메모");
  });

  it("serializes idea without title", () => {
    const item: CaptureItem = { type: "idea", body: "간단 아이디어" };
    expect(serializeCaptureToMarkdown(item)).toBe("- ✦ 간단 아이디어");
  });

  it("serializes multiple tags", () => {
    const item: CaptureItem = {
      type: "note",
      body: "할 일",
      tags: ["업무", "중요"],
    };
    expect(serializeCaptureToMarkdown(item)).toBe("- ☰ 할 일 #업무 #중요");
  });
});

describe("§56l extractCapturesSection", () => {
  it("extracts text between ## Captures and next ##", () => {
    const content = `## Diary

일기

## Captures

- ✦ 아이템1
- ☰ 아이템2

## Notes

기타`;
    const section = extractCapturesSection(content);
    expect(section).toContain("✦ 아이템1");
    expect(section).toContain("☰ 아이템2");
    expect(section).not.toContain("일기");
    expect(section).not.toContain("기타");
  });

  it("returns empty string when no Captures section", () => {
    expect(extractCapturesSection("## Diary\n\n일기")).toBe("");
  });

  it("handles Captures at end of file", () => {
    const content = `## Diary

일기

## Captures

- ☰ 마지막 캡처`;
    const section = extractCapturesSection(content);
    expect(section).toContain("마지막 캡처");
  });
});

describe("§56l insertCaptureIntoContent", () => {
  it("appends to existing Captures section", () => {
    const content = `---
date: 2026-02-28
---

# 2026-02-28

## Diary

일기 내용

## Captures

- ✦ 기존 캡처`;
    const item: CaptureItem = { type: "note", body: "새 메모" };
    const result = insertCaptureIntoContent(content, item);
    expect(result).toContain("- ✦ 기존 캡처");
    expect(result).toContain("- ☰ 새 메모");
  });

  it("creates Captures section when missing", () => {
    const content = `---
date: 2026-02-28
---

# 2026-02-28

## Diary

일기 내용`;
    const item: CaptureItem = { type: "idea", title: "아이디어", body: "내용" };
    const result = insertCaptureIntoContent(content, item);
    expect(result).toContain("## Captures");
    expect(result).toContain("- ✦ **아이디어**: 내용");
    // Captures should come after Diary
    const diaryIdx = result.indexOf("## Diary");
    const capturesIdx = result.indexOf("## Captures");
    expect(capturesIdx).toBeGreaterThan(diaryIdx);
  });

  it("strips empty list items (lone `-`) from existing Captures", () => {
    const content = `## Captures

- ☰ Note #note
-
- ✦ **idea**: idea #tag1
- sdfa
- asdlfka
-
- ☰ note #note
-`;
    const item: CaptureItem = { type: "note", body: "새 메모" };
    const result = insertCaptureIntoContent(content, item);
    // Lone `-` lines should be removed
    const lines = result.split("\n");
    const loneDashes = lines.filter((l) => l.trim() === "-");
    expect(loneDashes).toHaveLength(0);
    // All real items should be preserved
    expect(result).toContain("- ☰ Note #note");
    expect(result).toContain("- ✦ **idea**: idea #tag1");
    expect(result).toContain("- sdfa");
    expect(result).toContain("- asdlfka");
    expect(result).toContain("- ☰ note #note");
    expect(result).toContain("- ☰ 새 메모");
  });

  it("strips empty list items when Captures is before next section", () => {
    const content = `## Captures

- ☰ existing
-

## Notes

content`;
    const item: CaptureItem = { type: "note", body: "새 메모" };
    const result = insertCaptureIntoContent(content, item);
    const lines = result.split("\n");
    const loneDashes = lines.filter((l) => l.trim() === "-");
    expect(loneDashes).toHaveLength(0);
    expect(result).toContain("- ☰ existing");
    expect(result).toContain("- ☰ 새 메모");
    expect(result).toContain("## Notes");
  });

  it("creates both Diary and Captures when content is minimal", () => {
    const content = `---
date: 2026-02-28
---

# 2026-02-28`;
    const item: CaptureItem = { type: "note", body: "메모" };
    const result = insertCaptureIntoContent(content, item);
    expect(result).toContain("## Captures");
    expect(result).toContain("- ☰ 메모");
  });
});

describe("§56l buildNoteFromCapture", () => {
  it("builds note from idea capture with title", () => {
    const item: CaptureItem = {
      type: "idea",
      title: "CLI 기반 저널 도구",
      body: "터미널에서 바로 저널을 쓸 수 있으면 좋겠다",
      tags: ["아이디어", "CLI"],
    };
    const { filename, content } = buildNoteFromCapture(item);
    expect(filename).toBe("cli-기반-저널-도구.md");
    expect(content).toContain("# CLI 기반 저널 도구");
    expect(content).toContain("터미널에서 바로 저널을 쓸 수 있으면 좋겠다");
    expect(content).toContain("#아이디어 #CLI");
  });

  it("builds note from link capture with URL", () => {
    const item: CaptureItem = {
      type: "link",
      title: "Tauri Guide",
      url: "https://tauri.app/guide",
      body: "Good reference",
    };
    const { filename, content } = buildNoteFromCapture(item);
    expect(filename).toBe("tauri-guide.md");
    expect(content).toContain("# Tauri Guide");
    expect(content).toContain("Source: https://tauri.app/guide");
    expect(content).toContain("Good reference");
  });

  it("uses body first line as title when no title", () => {
    const item: CaptureItem = {
      type: "note",
      body: "Quick thought about architecture\nMore details here",
    };
    const { filename, content } = buildNoteFromCapture(item);
    expect(filename).toBe("quick-thought-about-architecture.md");
    expect(content).toContain("# Quick thought about architecture");
  });

  it("sanitizes special characters in filename", () => {
    const item: CaptureItem = {
      type: "idea",
      title: 'File: "test" <dir>/path',
    };
    const { filename } = buildNoteFromCapture(item);
    expect(filename).not.toMatch(/[/\\:*?"<>|#]/);
    expect(filename).toMatch(/\.md$/);
  });

  it("returns Untitled for empty capture", () => {
    const item: CaptureItem = { type: "note" };
    const { filename, content } = buildNoteFromCapture(item);
    expect(filename).toBe("untitled.md");
    expect(content).toContain("# Untitled");
  });
});

describe("§56l buildPromotedCaptureLink", () => {
  it("builds wikilink with idea icon", () => {
    const item: CaptureItem = { type: "idea", title: "My Idea" };
    const result = buildPromotedCaptureLink(item, "my-idea");
    expect(result).toBe("- ✦ [[my-idea|My Idea]]");
  });

  it("builds wikilink with link icon", () => {
    const item: CaptureItem = { type: "link", title: "Tauri" };
    const result = buildPromotedCaptureLink(item, "tauri");
    expect(result).toBe("- ↗ [[tauri|Tauri]]");
  });

  it("builds wikilink with quote icon", () => {
    const item: CaptureItem = { type: "quote", body: "Some wisdom" };
    const result = buildPromotedCaptureLink(item, "some-wisdom");
    expect(result).toBe("- ❝ [[some-wisdom|Some wisdom]]");
  });

  it("builds wikilink with note icon", () => {
    const item: CaptureItem = { type: "note", body: "A note" };
    const result = buildPromotedCaptureLink(item, "a-note");
    expect(result).toBe("- ☰ [[a-note|A note]]");
  });
});

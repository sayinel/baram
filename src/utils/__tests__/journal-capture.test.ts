/**
 * §56l Phase B — Daily Capture utility tests
 * TDD Red Phase: all tests should FAIL before implementation
 */
import { describe, expect, it } from "vitest";

import {
  CAPTURE_ICONS,
  CAPTURE_TYPES,
  type CaptureItem,
  serializeCaptureToMarkdown,
} from "../journal/journal-capture";

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

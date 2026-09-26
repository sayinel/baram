// §365 다이얼 6 — 본문 타이포 다이얼 넷과 서체 이름 검증(스펙 0060 §3).
import { describe, expect, it } from "vitest";

import { DIALS } from "../dials";
import { FONT_FAMILY_MAX_LENGTH, parseFontFamily } from "../typography-dials";

describe("parseFontFamily", () => {
  it("앞뒤 공백을 걷는다", () => {
    expect(parseFontFamily("  Noto Sans KR ")).toBe("Noto Sans KR");
  });

  // `""` 는 "설정 없음" 이다. 테마가 서체를 정한 상태에서 사용자가 앱 기본으로 돌아가려면
  // 사용자 층에 이 값을 명시해야 하므로 거부하면 안 된다.
  it("빈 문자열은 유효하다", () => {
    expect(parseFontFamily("")).toBe("");
  });

  // 무엇이 이것을 실패시키는가: 제어 문자 검사를 빼면 줄바꿈이 섞인 이름이 저장되고,
  // `quoteFamily` 가 만든 CSS 문자열이 깨져 서체가 조용히 적용되지 않는다.
  it("이름 안의 줄바꿈 · 탭 · DEL 을 거부한다", () => {
    expect(parseFontFamily("Noto\nSans")).toBeUndefined();
    expect(parseFontFamily("Noto\tSans")).toBeUndefined();
    expect(parseFontFamily("Noto\u007fSans")).toBeUndefined();
  });

  it("길이 상한은 공백을 걷은 뒤의 길이다", () => {
    const max = "a".repeat(FONT_FAMILY_MAX_LENGTH);
    expect(parseFontFamily(max)).toBe(max);
    expect(parseFontFamily(` ${max} `)).toBe(max);
    expect(parseFontFamily(`${max}a`)).toBeUndefined();
  });

  it("문자열이 아니면 거부한다", () => {
    expect(parseFontFamily(16)).toBeUndefined();
    expect(parseFontFamily(null)).toBeUndefined();
    expect(parseFontFamily(undefined)).toBeUndefined();
  });
});

describe("본문 타이포 다이얼 넷", () => {
  // 기본값은 옮기기 전 `editor-settings.ts` 의 초기값이다 — 같아야 v28 마이그레이션이
  // 기본값과 다른 값만 옮기고 희소성(§364.2)이 선다.
  it.each([
    ["editorFontFamily", "text", ""],
    ["editorCodeFontFamily", "text", ""],
    ["editorFontSize", "number", 16],
    ["editorLineHeight", "number", 1.75],
  ] as const)("%s — 종류 %s · 기본값 %s · 채널 editor", (id, kind, value) => {
    const dial = DIALS.find((d) => d.id === id);
    expect(dial?.kind).toBe(kind);
    expect(dial?.defaultValue).toBe(value);
    expect(dial?.channel).toBe("editor");
  });

  it("서체 다이얼은 parseFontFamily 로 검증한다", () => {
    const dial = DIALS.find((d) => d.id === "editorFontFamily");
    expect(dial?.parse(" Inter ")).toBe("Inter");
    expect(dial?.parse("a\nb")).toBeUndefined();
  });
});

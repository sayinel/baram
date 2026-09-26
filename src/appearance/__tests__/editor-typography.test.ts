// §365 다이얼 6 — 병합된 본문 타이포(스펙 0060 §4.1).
import type { ResolvedDial } from "../merge";

import { describe, expect, it } from "vitest";

import { DIALS } from "../dials";
import {
  editorTypographyOf,
  resolveEditorTypography,
} from "../editor-typography";
import { resolveDials } from "../merge";

const defaultOf = (id: string) => DIALS.find((d) => d.id === id)?.defaultValue;

describe("resolveEditorTypography", () => {
  it("층이 없으면 다이얼 기본값", () => {
    expect(resolveEditorTypography({}, {})).toEqual({
      codeFontFamily: defaultOf("editorCodeFontFamily"),
      fontFamily: defaultOf("editorFontFamily"),
      fontSize: defaultOf("editorFontSize"),
      lineHeight: defaultOf("editorLineHeight"),
    });
  });

  it("테마가 기본을, 사용자가 테마를 이긴다", () => {
    const theme = { editorFontFamily: "Theme Serif", editorFontSize: 18 };
    expect(resolveEditorTypography(theme, {}).fontSize).toBe(18);
    expect(
      resolveEditorTypography(theme, { editorFontSize: 20 }).fontSize,
    ).toBe(20);
    // 사용자의 `""` 는 "앱 기본으로" 라는 명시다 — 테마 서체를 이긴다.
    expect(
      resolveEditorTypography(theme, { editorFontFamily: "" }).fontFamily,
    ).toBe("");
  });

  it("parse 에 실패한 층은 말하지 않은 것으로 친다", () => {
    expect(resolveEditorTypography({ editorFontSize: 99 }, {}).fontSize).toBe(
      16,
    );
  });
});

describe("editorTypographyOf", () => {
  // 구조상 일어나지 않는 갈래(병합 값은 그 다이얼의 parse 를 지났다)지만, 그 갈래의 값이
  // 다이얼 기본값과 **같다**는 것을 고정한다 — 리터럴로 적힌 대체값이 다이얼과 어긋나지 않게.
  it("종류가 어긋난 값은 다이얼 기본값으로 떨어진다", () => {
    const resolved = resolveDials({}, {});
    const broken: Record<string, ResolvedDial> = {
      ...resolved,
      editorCodeFontFamily: { origin: "user", value: 3 },
      editorFontFamily: { origin: "user", value: 3 },
      editorFontSize: { origin: "user", value: "big" },
      editorLineHeight: { origin: "user", value: "tall" },
    };
    expect(editorTypographyOf(broken as typeof resolved)).toEqual(
      resolveEditorTypography({}, {}),
    );
  });
});

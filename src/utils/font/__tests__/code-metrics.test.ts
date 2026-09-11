// §354 — 코드 크기·줄 높이를 본문에서 파생하는 규칙.
//
// 이 파일이 지키는 핵심 주장은 하나다: **연동을 켜 둔 사용자의 화면은 이 설정이
// 생기기 전과 같다.** 그 전에는 `.tiptap code` 와 코드블록 편집기가
// `font-size: 0.875em` 이었고 줄 높이는 본문에서 상속됐다. 그래서 파생값은
// "그럴듯한 숫자"가 아니라 그 CSS 를 값으로 옮긴 것이어야 하고, 특히 반올림하면
// 안 된다 — 본문 17px 에서 예전 `em` 은 14.875px 를 만든다.
import { describe, expect, it } from "vitest";

import {
  CODE_FONT_SIZE_RATIO,
  derivedCodeFontSize,
  resolveCodeMetrics,
} from "../code-metrics";

/** store 의 기본값 — 여기 숫자를 적어 두면 낡으므로 의미를 이름으로 남긴다. */
const LINKED_DEFAULTS = {
  codeFontSize: 14,
  codeLineHeight: 1.75,
  fontSize: 16,
  lineHeight: 1.75,
  linkFontMetrics: true,
};

describe("§354 code metrics", () => {
  it("derives the size from the body with the ratio the old CSS used", () => {
    expect(CODE_FONT_SIZE_RATIO).toBe(0.875);
    expect(resolveCodeMetrics(LINKED_DEFAULTS).fontSize).toBe(14);
  });

  // 반올림 금지의 판정. `Math.round` 를 파생 안으로 들이면 여기서만 깨진다 —
  // 기본 16px 는 반올림해도 14 라서 위 테스트는 통과한다.
  it("does not round, so a body size that had a fractional code size keeps it", () => {
    expect(derivedCodeFontSize(17)).toBe(14.875);
    expect(
      resolveCodeMetrics({ ...LINKED_DEFAULTS, fontSize: 17 }).fontSize,
    ).toBe(14.875);
  });

  it("gives code the body's line height while linked", () => {
    expect(
      resolveCodeMetrics({ ...LINKED_DEFAULTS, lineHeight: 2.1 }).lineHeight,
    ).toBe(2.1);
  });

  // 연동 중에는 저장된 코드 값이 **읽히지 않는다** — 이것이 "다시 켜면 버린다"의
  // 구현이다. 값이 남아 있어도 화면에 나오지 않으므로 지우는 것과 차이가 없다.
  it("ignores the stored code values entirely while linked", () => {
    const out = resolveCodeMetrics({
      ...LINKED_DEFAULTS,
      codeFontSize: 30,
      codeLineHeight: 3,
    });
    expect(out).toEqual({ fontSize: 14, lineHeight: 1.75 });
  });

  it("uses the stored code values, and only those, once unlinked", () => {
    const out = resolveCodeMetrics({
      codeFontSize: 11,
      codeLineHeight: 1.3,
      fontSize: 24,
      lineHeight: 2.5,
      linkFontMetrics: false,
    });
    expect(out).toEqual({ fontSize: 11, lineHeight: 1.3 });
  });
});

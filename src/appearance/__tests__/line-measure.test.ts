// §365 다이얼 8 — px 와 줄당 글자 수의 환산(스펙 0060 §8.2).
import { describe, expect, it } from "vitest";

import { CHARS_RANGE, charsForWidth, widthForChars } from "../line-measure";

/** Pretendard Variable — `가` 1770/2048(한글 음절 11,172자 전부 같은 폭), `a`–`z` 평균. 2026-09-26 fontTools 실측. */
const KO = 1770 / 2048;
const EN = 0.5062725360576923;

describe("charsForWidth", () => {
  it("기본 800px · 여백 4rem · 16px — ko 49자 · en 83", () => {
    const base = { fontSizePx: 16, letterSpacingEm: 0, paddingPx: 64 };
    expect(charsForWidth(800, { ...base, advanceRatio: KO })).toBe(49);
    expect(charsForWidth(800, { ...base, advanceRatio: EN })).toBe(83);
  });

  it("레퍼런스 테마 720px · 5rem · −0.01em · 17px — 39자", () => {
    expect(
      charsForWidth(720, {
        advanceRatio: KO,
        fontSizePx: 17,
        letterSpacingEm: -0.01,
        paddingPx: 80,
      }),
    ).toBe(39);
  });

  // Fix round 1 (Important 1) — `box-sizing: border-box` 에서 여백이 폭보다 크면 콘텐츠 폭은
  // 0 에서 바닥을 친다(CSS Box Sizing 명세). 무엇이 이것을 실패시키는가: `Math.max(0, …)` 를
  // 빼면 폭이 여백의 두 배보다 작을 때 음수 글자 수("-8자" 등)가 나온다.
  it("여백의 두 배보다 좁으면 0으로 바닥을 친다", () => {
    const base = {
      advanceRatio: KO,
      fontSizePx: 16,
      letterSpacingEm: 0,
      paddingPx: 64,
    };
    expect(charsForWidth(20, base)).toBe(0);
    expect(charsForWidth(0, base)).toBe(0);
  });

  // 경계 — 정확히 여백의 두 배(콘텐츠 폭 0)도 0이지 반올림 방향에 따라 -1/+1로 흔들리지 않는다.
  it("경계 — 폭이 정확히 여백의 두 배면 0", () => {
    expect(
      charsForWidth(128, {
        advanceRatio: KO,
        fontSizePx: 16,
        letterSpacingEm: 0,
        paddingPx: 64,
      }),
    ).toBe(0);
  });
});

describe("widthForChars", () => {
  // 무엇이 이것을 실패시키는가: 두 함수의 여백 처리가 갈리거나(한쪽만 2배) 반올림 방향이 어긋나면
  // 슬라이더가 40 에 놓였는데 값 칸이 39 를 보인다.
  it("자르지 않는 구간에서 글자 수가 왕복한다", () => {
    for (const fontSizePx of [8, 16, 32]) {
      for (const advanceRatio of [EN, KO]) {
        for (const letterSpacingEm of [-0.05, 0, 0.1]) {
          for (const paddingPx of [0, 64, 256]) {
            const input = {
              advanceRatio,
              fontSizePx,
              letterSpacingEm,
              paddingPx,
            };
            for (let n = CHARS_RANGE.min; n <= CHARS_RANGE.max; n++) {
              const px = widthForChars(n, input, Number.POSITIVE_INFINITY);
              expect(
                charsForWidth(px, input),
                `${JSON.stringify(input)} n=${n}`,
              ).toBe(n);
            }
          }
        }
      }
    }
  });

  // `editorMaxWidth` 의 parse 는 4000 을 넘는 값을 버린다 — 자르지 않으면 사용자 층이 조용히 사라진다.
  it("상한으로 자른다", () => {
    expect(
      widthForChars(
        120,
        {
          advanceRatio: KO,
          fontSizePx: 32,
          letterSpacingEm: 0.1,
          paddingPx: 256,
        },
        4000,
      ),
    ).toBe(4000);
  });
});

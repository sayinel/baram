// §365 다이얼 8 — 본문 폭(px)과 줄당 글자 수의 환산(스펙 0060 §8.2). 저장값은 px 하나이고 글자
// 수는 표현이다(0055 §7.3 정정). 두 함수의 왕복(자르지 않는 구간)은 `line-measure.test.ts` 가
// 격자 전체로 고정한다.
//
// ‼️ 이 모듈은 아무것도 import 하지 않는다.

/** 한 글자의 폭을 정하는 입력 — 전부 병합값이다. */
export interface MeasureInput {
  /** 본문 서체의 표본 글자 폭 ÷ 글자 크기(em). `utils/font/char-advance.ts` 가 잰다. */
  readonly advanceRatio: number;
  readonly fontSizePx: number;
  /** 자간 다이얼(`editorLetterSpacing`, em). */
  readonly letterSpacingEm: number;
  /** 좌우 여백 **한쪽**(px) — `editorPadding`(rem) × 루트 글자 크기. */
  readonly paddingPx: number;
}

/** 자 슬라이더의 범위(글자). */
export const CHARS_RANGE = { max: 120, min: 20, step: 1 } as const;

/** 한 글자의 폭(px). */
export function charWidthPx(input: MeasureInput): number {
  return input.fontSizePx * (input.advanceRatio + input.letterSpacingEm);
}

/**
 * px → 글자 수. `max-width` 는 좌우 여백을 **포함한다**(`src/styles/base.css` 의
 * `@import "tailwindcss"` 가 preflight 의 `box-sizing: border-box` 를 싣고, `.tiptap` 은
 * `padding: 2rem var(--editor-padding)` 이다) — 그래서 여백 둘을 뺀다. 폭 0("제한 없음")은 호출자가
 * 따로 다룬다.
 */
export function charsForWidth(widthPx: number, input: MeasureInput): number {
  const perChar = charWidthPx(input);
  if (perChar <= 0) return 0;
  return Math.round((widthPx - 2 * input.paddingPx) / perChar);
}

/**
 * 글자 수 → px. 정수 px 로 반올림하고 `maxPx` 로 자른다 — `editorMaxWidth` 의 `parse` 는 최솟값 ·
 * 최댓값만 보고(간격 20 은 보지 않는다), 상한을 넘으면 그 값을 버려 사용자 층이 조용히 사라진다.
 */
export function widthForChars(
  chars: number,
  input: MeasureInput,
  maxPx: number,
): number {
  return Math.min(
    maxPx,
    Math.round(chars * charWidthPx(input) + 2 * input.paddingPx),
  );
}

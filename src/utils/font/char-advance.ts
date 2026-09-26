// §365 다이얼 8 — 한 글자의 폭을 잰다(스펙 0060 §8.1). 표본은 언어별이다: ko 는 `가`(Pretendard 는
// 한글 음절 11,172자가 전부 같은 폭 0.864em), en 은 `a`–`z` 평균(0.506em). 둘 다 2026-09-26 fontTools
// 실측. CSS `ic` · `ch` 로는 잴 수 없다 — Pretendard 에 한자가 없어 `ic` 가 1em 으로 떨어지고,
// `ch`(숫자 0)는 굵기마다 다르다.

import type { Locale } from "../../i18n";

export const ADVANCE_SAMPLES: Readonly<Record<Locale, string>> = {
  en: "abcdefghijklmnopqrstuvwxyz",
  ko: "가",
};

/** 재는 글자 크기 — 비율은 크기와 무관하므로 오차가 작은 큰 값으로 잰다. */
const PROBE_PX = 100;

/**
 * 표본 한 글자의 평균 폭 ÷ 글자 크기(em 비율).
 *
 * 서체가 로드된 **뒤에** 잰다 — 로드 전에 재면 대체 서체의 폭이 잡힌다. 잴 수 없으면(`document.fonts`
 * 나 canvas 측정이 없는 환경) `null` 이고, 부르는 쪽은 글자 수 표현을 잠근다.
 */
export async function measureAdvanceRatio(
  stack: string,
  sample: string,
): Promise<null | number> {
  const font = `${PROBE_PX}px ${stack}`;
  try {
    await document.fonts.load(font, sample);
  } catch {
    return null;
  }
  const context = document.createElement("canvas").getContext("2d");
  if (context === null) return null;
  context.font = font;
  const width = context.measureText(sample).width;
  const count = [...sample].length;
  return width > 0 && count > 0 ? width / count / PROBE_PX : null;
}

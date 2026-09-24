// §365 밀도·모서리 다이얼의 스케일 쪽 — 곱하지 않는 토큰(`FIXED_SCALE_TOKENS`), 다이얼이
// 움직이는 스케일(`MOVING_SPACE` · `MOVING_RADIUS`), 단 이름과 곱수(`DENSITY_OPTIONS` ·
// `DENSITY_FACTOR` · `CORNER_OPTIONS` · `CORNER_FACTOR`), 스케일에 곱수를 거는 `scaleVars`.
// `dials.ts` 의 `DIALS` 가 `density` · `cornerRadius` 두 항목에서 이것을 읽는다.
//
// ‼️ 이 모듈이 import 하는 것은 Style Dictionary 가 내는 `types/generated/scale.ts` 하나뿐이다
// (생성 포맷 `ts/scale` 이 import 문을 쓰지 않는다 — `style-dictionary.config.ts`). 그래서
// 이 모듈의 import 는 거기서 끝나고, `dials.ts` 가 이것을 import 해도 순환이 생길 수 없다
// (그 파일 머리주석). 여기에 import 를 더하면 그 주장을 다시 재야 한다.

import { RADIUS_SCALE, SPACE_SCALE } from "../types/generated/scale";

/**
 * §365 밀도·모서리가 **곱하지 않는** 토큰. 0 은 곱해도 0 이라 곱하는 의미가 없고,
 * `--radius-full` 은 알약·원 sentinel 이다 — 0097 R-C 가 그렇게 정했고
 * `stylelint.config.mjs` 의 규칙 위 주석이 같은 말을 적는다. 곱하면 "각지게" 에서
 * 토글이 사각형이 된다(9999 × 0 = 0).
 *
 * `--space-px` 헤어라인을 빼는 이유는 곱수가 그 값을 바꾸기 때문이 아니다 — ties-down
 * 반올림에서 compact(×0.75)·spacious(×1.25) 는 둘 다 1px 그대로다
 * (`Math.ceil(1 × 0.75 − 0.5)` = `Math.ceil(1 × 1.25 − 0.5)` = 1). 빼는 이유는 셋이다:
 * 곱해도 안 바뀌는 값을 인라인으로 다시 쓰면 cascade 를 누르고, ×0.5 이하에서는 선이
 * 지워지며(예: ×0.5 는 `Math.ceil(1 × 0.5 − 0.5)` = `Math.ceil(0)` = 0), 헤어라인은
 * 애초에 밀도 값이 아니라 스트로크다(0097 R-C).
 */
const FIXED_SCALE_TOKENS: ReadonlySet<string> = new Set([
  "--radius-full",
  "--radius-none",
  "--space-0",
  "--space-px",
]);

/** 다이얼이 움직이는 스케일 — 생성 순서(값 오름차순)를 그대로 지킨다. */
export const MOVING_SPACE = SPACE_SCALE.filter(
  ([name]) => !FIXED_SCALE_TOKENS.has(name),
);
export const MOVING_RADIUS = RADIUS_SCALE.filter(
  ([name]) => !FIXED_SCALE_TOKENS.has(name),
);

// §365 단별 곱수(스펙 0057 D4). ‼️ 전부 2진 소수로 정확히 표현되는 값이다
// (0.75 · 1.25 · 1.5) — 기준 px 와의 곱에 부동소수 오차가 끼지 않아, 한가운데 값
// (예: 6 × 0.75 = 4.5)이 정확히 한가운데로 남고 ties-down 이 그대로 작동한다.
// 0.7 같은 값을 넣으면 그 성질이 깨진다.
export const DENSITY_OPTIONS = ["compact", "default", "spacious"] as const;
export const DENSITY_FACTOR: Record<(typeof DENSITY_OPTIONS)[number], number> =
  {
    compact: 0.75,
    default: 1,
    spacious: 1.25,
  };
export const CORNER_OPTIONS = ["sharp", "default", "round"] as const;
export const CORNER_FACTOR: Record<(typeof CORNER_OPTIONS)[number], number> = {
  default: 1,
  round: 1.5,
  sharp: 0,
};

/**
 * 스케일 전체를 한 곱수로. 곱수 1 은 빈 맵이다 — 희소성(§364.2)이 기본 단의 계약이다.
 *
 * 반올림은 ties-down(`Math.ceil(x - 0.5)`) — 0097 R-A 의 스냅과 같은 방향이다
 * (한가운데 값은 작은 쪽으로). `Math.round` 는 한가운데를 **위로** 올린다.
 * `Math.ceil(-0.5)` 는 `-0` 이지만 템플릿 문자열이 `"0"` 으로 쓴다.
 */
export const scaleVars = (
  scale: readonly (readonly [name: string, px: number])[],
  factor: number,
): Record<string, string> => {
  if (factor === 1) return {};
  const out: Record<string, string> = {};
  for (const [name, px] of scale)
    out[name] = `${Math.ceil(px * factor - 0.5)}px`;
  return out;
};

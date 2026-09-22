// §367.3 설치 시점 대비 관문 — **거부가 아니라 경고**다.
//
// ‼️ `utils/theme-css/` 가 아니라 여기 있는 이유를 스펙이 직접 적는다: "보안 경계인
// 위생 파이프라인과 혼동하지 않도록 별도 단계로 둔다". 저쪽의 거부는 보안 결정이고,
// 이것은 미학 판단이다. 거부하면 저대비를 의도한 정당한 팔레트(예: Solarized)를 막는다.
//
// 실측(2026-09-22, 이 브랜치 HEAD 04224ae5): 아래 여섯 쌍으로 내장 8개를 재면
// `solarized-light`(6쌍) · `solarized-dark`(3쌍) · `tokyo-night`(1쌍) ·
// `default-light`(1쌍) · `baram-garden-light`(1쌍)이 경고하고 나머지 셋
// (`default-dark` · `nord` · `baram-garden-dark`)은 통과한다. `default-light` 는
// `text-secondary`/`bg-panel` 이 4.346 으로 AA(4.5) 를 근소하게 밑돈다 — 거부하는
// 관문이었다면 이 앱이 자기 기본 팔레트조차 설치하지 못한다는 뜻이고, 이 관문이
// 경고에 그쳐야 하는 이유가 Solarized 뿐 아니라 기본 팔레트에도 있다는 실물이다.
// (기본 팔레트의 그 쌍 자체를 고치는 것은 이 관문의 범위 밖이다 — 여기서는 있는
// 그대로 보고할 뿐이다.)
//
// ‼️ `--color-text-disabled` 는 **일부러 빠져 있다**. WCAG 1.4.3 이 비활성 UI 요소를
// 면제하고, 실측상 내장 8개 팔레트 **전부**가 그 쌍에서 AA 미달이다(2.23~3.58).
// 넣으면 경고가 항상 켜져 있어 아무 정보도 주지 않는다.

import type { ThemeMode } from "../types/theme";

import { AA_TEXT_RATIO, contrastRatio } from "../utils/color-contrast";

export interface ContrastWarning {
  readonly background: string;
  readonly foreground: string;
  readonly mode: ThemeMode;
  readonly ratio: number;
}

/**
 * AA 에 못 미치는 텍스트 쌍을 **보고한다**. 설치를 막지 않는다.
 *
 * 값이 없거나 읽을 수 없는 쌍은 건너뛴다 — 경고가 "색을 못 읽었다" 를 "대비가
 * 나쁘다" 로 바꿔 말하면 저자가 엉뚱한 곳을 고친다.
 */
export function contrastWarningsFor(
  mode: ThemeMode,
  colors: Readonly<Partial<Record<string, string>>>,
): ContrastWarning[] {
  const out: ContrastWarning[] = [];
  for (const [foreground, background] of TEXT_PAIRS) {
    const fg = colors[foreground];
    const bg = colors[background];
    if (fg === undefined || bg === undefined) continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio === null || ratio >= AA_TEXT_RATIO) continue;
    out.push({ background, foreground, mode, ratio });
  }
  return out;
}

/** 실제로 글자가 놓이는 쌍만. 순서가 경고의 순서다. */
const TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ["--color-text-primary", "--color-bg-default"],
  ["--color-text-primary", "--color-bg-panel"],
  ["--color-text-primary", "--color-bg-elevated"],
  ["--color-text-secondary", "--color-bg-default"],
  ["--color-text-secondary", "--color-bg-panel"],
  ["--color-editor-text", "--color-editor-bg"],
];

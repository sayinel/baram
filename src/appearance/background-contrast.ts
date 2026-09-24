// §365 다이얼 2a·2b — 배경 대비(스펙 0059). 크롬(사이드바·액티비티 바·오른쪽 패널)과 바
// (탭·상태·컨텍스트 탭)가 본문과 얼마나 다른 배경을 쓰는지를, 새 색을 계산하지 않고 테마
// 자신의 시드를 역할 사이에서 다시 연결해 정한다.
//
// ‼️ 이 모듈은 아무것도 import 하지 않는다. 이것을 값으로 import 하는 모듈(`utils/theme-vars.ts`
// 등)의 순환 논증이 이 파일이 잎이라는 데 기대므로, 여기서 무엇이든 import 하면 그 파일들
// 머리주석의 논증을 다시 재야 한다.

/**
 * 배경 대비 다이얼이 쓰는 **역할 토큰** 둘. 시드(`THEME_COLOR_KEYS`)가 아니다(스펙 0059 D6) —
 * `tokens/semantic/color-*.json` 에서 `bg.subtle` · `bg.default` 의 별칭으로 정의되므로,
 * 다이얼이 기본이면 인라인에 없고 cascade 가 오늘의 색을 준다.
 *
 * 시드가 아니라서 `applyThemeVars` 의 첫 화이트리스트에서 떨어진다. 그래서 이 배열이
 * 그 함수의 **둘째 화이트리스트**이고, `clearThemeVars` 가 같은 배열로 지운다 — 쓰는
 * 목록과 지우는 목록이 한 배열이어야 #330 이 되풀이되지 않는다(`theme-vars.ts` 머리주석).
 */
export const BG_ROLE_KEYS = [
  "--color-bg-bar",
  "--color-bg-chrome-fill",
] as const;

export type BgRoleKey = (typeof BG_ROLE_KEYS)[number];

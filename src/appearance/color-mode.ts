// §367 색 파생이 쓰는 모드. `types/theme.ts` 의 `resolveThemeMode` 과 **다른
// 질문에 답한다**: 저쪽은 "이 테마의 어느 모드 자산을 적용하는가" 라 자산이
// 없으면 `undefined` 가 정답이고, 이쪽은 "지금 화면이 밝은가 어두운가" 라
// 답이 언제나 둘 중 하나다. 파생식은 명도 방향을 그 답에서 가져오므로
// `undefined` 를 받을 자리가 없다.

import type { ThemeDef } from "../types/theme";

import { resolveThemeMode } from "../types/theme";

/** 지금 화면의 밝기. `ThemeMode` 와 같은 두 값이고, 이 모듈은 그것을 재export 하지 않는다 —
 *  `types/theme.ts` 는 팔레트 생성물을 import 하므로 잎이 아니다. */
export type ColorMode = "dark" | "light";

/**
 * 지금 화면이 라이트인가 다크인가 — **언제나 답한다**.
 *
 * 한 모드짜리 테마가 OS 를 무시하는 규칙은 {@link resolveThemeMode} 이 이미 갖고
 * 있으므로 여기서 다시 적지 않는다. 이 함수가 더하는 것은 그 함수가 말하지 않는
 * 갈래 하나뿐이다: 적용할 모드 자산이 없을 때(`system`, 그리고 모드를 선언하지
 * 않은 테마) 화면의 밝기는 OS 가 정한다.
 */
export function resolveColorMode(
  theme: ThemeDef | undefined,
  prefersDark: boolean,
): ColorMode {
  const resolved =
    theme === undefined ? undefined : resolveThemeMode(theme, prefersDark);
  return resolved ?? (prefersDark ? "dark" : "light");
}

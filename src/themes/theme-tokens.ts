// §360 · §371 — 테마 패키지의 `tokens.json` 을 색으로 읽는 한 곳.
//
// 설치 경로(`theme-install.ts` 의 `readModeColors`)와 게시 경로(`scripts/theme-package.ts` 의
// 미리보기 추출)가 함께 부른다. 스펙 0063 §5.3 의 "찾아보기 카드의 그림 = 설치 뒤 갤러리 카드의
// 그림" 은 이 공유에 선다 — 두 경로가 색을 따로 읽으면 두 그림이 갈라진다.

import type { ThemeColors } from "../types/theme";

import {
  fillAliasedColors,
  THEME_COLOR_KEYS,
  THEME_COLOR_VALUE_RE,
} from "../types/theme";

export type ThemeTokensResult =
  { colors: ThemeColors; ok: true } | { key: null | string; ok: false };

/**
 * 파싱된 `tokens.json` 을 {@link ThemeColors} 로.
 *
 * 화이트리스트 키만으로 객체를 **재구성**한다 — `use-theme-import.ts` 가 감사 BLOCKER
 * 로 고친 것과 같은 규칙이고, 이유도 같다: 존재만 검사하고 객체를 그대로 저장하면 JSON
 * 에 끼어든 여분 키(진짜 CSS 속성명 포함)가 `applyThemeVars` 까지 흘러가 `<html>` 의
 * inline style 에 영구 주입된다.
 *
 * 키가 하나라도 빠지거나 형식이 틀리면 실패이고 `key` 가 그 키다 — 최상위가 평범한 객체가
 * 아니면 `null`. 부분 팔레트를 기본값으로 메우지 않는다. 가져오기 경로는 `base` 를 알기 때문에
 * 그 모드의 기본 팔레트로 메울 수 있지만, 패키지 테마는 두 모드를 함께 실을 수 있어 "이 모드의
 * 기본값" 이 하나로 정해지지 않는다.
 *
 * 단 **포맷보다 늦게 생긴 키**는 빠진 것으로 세지 않는다 — 검사 전에 `fillAliasedColors`
 * 가 그 키를 이 팔레트 안의 별칭 값으로 채운다. v0.7.4 가 내보낸 24키 패키지가 25키 빌드에서
 * 팔레트를 통째로 잃던 것(#722 의 범위 밖 1)이 그 이유다. 채우는 값이 기본 팔레트가 아니라
 * 같은 팔레트에서 오므로 위 규칙("기본값으로 메우지 않는다")은 그대로다.
 */
export function parseThemeTokens(parsed: unknown): ThemeTokensResult {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { key: null, ok: false };
  }
  const source = fillAliasedColors(parsed as Record<string, unknown>);
  const colors = {} as ThemeColors;
  for (const { key } of THEME_COLOR_KEYS) {
    const value = source[key];
    if (typeof value !== "string" || !THEME_COLOR_VALUE_RE.test(value)) {
      return { key, ok: false };
    }
    colors[key] = value;
  }
  return { colors, ok: true };
}

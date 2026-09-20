// §362 — 활성 테마의 토큰을 standalone 페이지가 읽을 수 있는 :root 블록으로.
//
// ‼️ 값만 나간다. 레이아웃도, 테마가 실은 CSS 도 아니다 — `full` 이 후속인 이유는
// 스펙 §3.5 에 있다(`rescopeEditorCSS` 는 정규식 문자열 변환이고 신뢰할 수 없는
// CSS 에 쓸 수 없다).
import type { ThemeDef, ThemeMode } from "../../types/theme";

import { derivedVars } from "../theme-vars";

export function themeTokensBlock(
  theme: ThemeDef | undefined,
  mode: ThemeMode,
): string {
  const colors = theme?.modes[mode]?.colors;
  if (colors === undefined) return "";
  // ‼️ `derivedVars` 는 인자 둘이다 — `(colors, base)`(`theme-vars.ts`의 export). base 가
  // 필요한 이유는 accent 의 solid fill 계산이 모드에 따라 다르기 때문이고, 여기서는
  // 내보내는 모드가 곧 base 다.
  const all = { ...colors, ...derivedVars(colors, mode) };
  const body = Object.entries(all)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `:root {\n${body}\n}`;
}

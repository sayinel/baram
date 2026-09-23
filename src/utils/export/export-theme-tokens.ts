// §362 — 활성 테마의 토큰을 standalone 페이지가 읽을 수 있는 :root 블록으로.
//
// ‼️ 값만 나간다. 레이아웃도, 테마가 실은 CSS 도 아니다 — `full` 이 후속인 이유는
// 스펙 §3.5 에 있다(`rescopeEditorCSS` 는 정규식 문자열 변환이고 신뢰할 수 없는
// CSS 에 쓸 수 없다).
import type { ThemeDef, ThemeMode } from "../../types/theme";

import { deriveColorVars } from "../../appearance/color-derive";
import { THEME_COLOR_KEYS, THEME_COLOR_VALUE_RE } from "../../types/theme";
import { derivedVars } from "../theme-vars";

/**
 * §362 final review MEDIUM-3 — 이 함수의 sink 가 `applyThemeVars`
 * (`theme-vars.ts`, "최후 방어선" audit BLOCKER 주석)보다 **약하다**.
 * `applyThemeVars` 는 `root.style.setProperty(key, value)` 로 DOM API 에 쓴다 —
 * `value` 안에 `</style>` 가 있어도 하나의 커스텀 프로퍼티 값일 뿐 문서를
 * 벗어나지 못한다. 여기는 그 문자열을 그대로 `<style>` 태그의 텍스트로
 * 직렬화한다(`generateStandaloneHTML`) — `</style>` 를 담은 값은 element 를
 * 벗어나고, export 의 CSP(`script-src 'none'`) 는 스크립트만 막지 `<iframe>`·
 * `<meta http-equiv=refresh>`·앵커는 막지 않으며, 앵커 스크럽
 * (`export-html.ts` 의 `stripDisallowedLinkHrefs`) 은 에디터 클론 위에서
 * 돌지 이 스타일시트 문자열 위에서 돌지 않는다.
 *
 * **오늘은 뚫리지 않는다** — `ThemeDef.modes.*.colors` 를 쓰는 프로덕션 코드
 * 전부를 확인했다: `theme-install.ts`의 `readModeColors`,
 * `use-theme-import.ts`, `store.ts`의 v22 재수화 보수, `ThemeEditor`의
 * `<input type="color">`(브라우저가 `#rrggbb` 로 정규화), `BUILT_IN_THEMES` —
 * 다섯 모두 `THEME_COLOR_VALUE_RE` 화이트리스트를 거치거나 애초에 리터럴이다.
 * 하지만 이 파일 자신은 "모든 입구가 걸러 준다"는 전칭에 기대고 있었고, 그
 * 전칭은 코드로 강제되지 않았다 — 다섯 곳 중 하나(가져온 `customThemes`)는
 * 한 번뿐인 마이그레이션으로만 재검증된다. 그래서 여기서도 같은 화이트리스트로
 * KEY 와 VALUE 를 둘 다 다시 거른다: KEY 는 `THEME_COLOR_KEYS` 로만(임의
 * 키 — 예: 진짜 CSS 프로퍼티인 `display` — 가 색 객체에 끼어들어도 `:root`
 * 블록에 새지 않는다, `applyThemeVars`가 막는 것과 같은 위협), VALUE 는
 * `THEME_COLOR_VALUE_RE` 로(육각 색 리터럴이 아니면 그 줄 자체를 쓰지 않는다).
 * 통과하는 값은 다섯 입구 어디서 왔든 항상 유효한 `#rrggbb`/`#rgb` 이므로,
 * 정상적인 테마의 출력은 이 필터로 바뀌지 않는다.
 */
export function themeTokensBlock(
  theme: ThemeDef | undefined,
  mode: ThemeMode,
): string {
  const colors = theme?.modes[mode]?.colors;
  if (colors === undefined) return "";
  // ‼️ `derivedVars` 는 인자 둘이다 — `(colors, base)`(`theme-vars.ts`의 export). base 가
  // 필요한 이유는 accent 의 solid fill 계산이 모드에 따라 다르기 때문이고, 여기서는
  // 내보내는 모드가 곧 base 다.
  //
  // ‼️ 원본 `colors` 를 그대로 넘긴다 — `derivedVars` 안의 `accentSolidFill`은
  // dark 모드에서 `accent` 를 검증 없이 그대로 돌려주고(color-contrast.ts),
  // `solidHoverFill` 도 `shiftToward` 가 파싱하지 못하면 입력을 그대로 돌려준다
  // (`?? solid`) — 즉 RAW `colors` 의 값이 파생 값으로 그대로 흘러들 수 있다.
  // 그래서 화이트리스트는 원본 팔레트 키와 파생 9키 **양쪽 다**, 최종 직렬화
  // 직전에 건다(아래 루프) — derivedVars 호출 자체를 거르는 대신.
  //
  // ‼️ §367 파생 29키도 **같은 자리에서** 나가야 한다. 앱에서는 `applyThemeVars` 가
  // 시드와 `derivedVars` 바로 뒤에 `deriveColorVars` 를 쓰는데(`theme-vars.ts`),
  // 여기서 그것을 빠뜨리면 내보낸 문서는 `export-editor-css.ts` 가 번들하는
  // `semantic-light.css` 의 기본 팔레트 값을 쓴다 — 이 `:root` 블록이 그 29키를
  // 덮지 않기 때문이다. 증상: 테마를 깔고 HTML·PDF 로 내보내면 callout 이 앱에서는
  // 테마 색인데 출력물에서는 stock 파랑·에메랄드로 나온다(`--color-bg-hover` ·
  // `--color-bg-selection` 도 같은 집합이다). 이 갈래가 생긴 것은 §367 이고, 그 전에는
  // 양쪽이 모두 기본값이라 우연히 일치했다.
  //
  // 위 두 이유가 이 호출에도 그대로 걸린다: 원본 `colors` 를 넘기고(파생 안에서
  // 값이 그대로 흘러나올 수 있다), 걸러내는 것은 직렬화 직전의 아래 루프다.
  const derived = { ...derivedVars(colors, mode), ...deriveColorVars(colors) };
  const lines: string[] = [];
  for (const { key } of THEME_COLOR_KEYS) {
    const value = colors[key];
    if (value !== undefined && THEME_COLOR_VALUE_RE.test(value)) {
      lines.push(`  ${key}: ${value};`);
    }
  }
  for (const [key, value] of Object.entries(derived)) {
    // derived 의 KEY 는 `derivedVars` 와 `deriveColorVars` 가 **각자 고정된 리터럴**
    // 에서 만드므로(저쪽은 `DERIVED_KEYS` 의 문자열, 이쪽은 `RULES[].key`; 둘 다
    // 사용자 색 객체의 임의 키가 섞여 들 통로가 없다 — `deriveColorVars` 는 입력이
    // 아니라 규칙표를 순회한다) 화이트리스트가 필요 없다 — VALUE 만 같은 정규식으로
    // 거른다.
    if (THEME_COLOR_VALUE_RE.test(value)) {
      lines.push(`  ${key}: ${value};`);
    }
  }
  return `:root {\n${lines.join("\n")}\n}`;
}

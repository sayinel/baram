// §365 다이얼 2a·2b — 배경 대비(스펙 0059). 크롬(사이드바·액티비티 바·오른쪽 패널)과 바
// (탭·상태·컨텍스트 탭)가 본문과 얼마나 다른 배경을 쓰는지를, 새 색을 계산하지 않고 테마
// 자신의 시드를 역할 사이에서 다시 연결해 정한다. `dials.ts` 의 `DIALS` 가 두 항목에서
// 옵션·`BACKGROUND_CONTRAST_VARS` · `backgroundContrastVars` 를 읽고, `utils/theme-vars.ts`
// 가 `BG_ROLE_KEYS` 를 쓰고 지운다.
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

// §365 두 다이얼의 값(스펙 0059 §3.1). 둘이 갈라져 있는 것이 D1 이다 — 라이트 다이얼에
// `black` 이 없어서, 지금 모드에 없는 값을 골라 저장만 되는 일이 구조적으로 없다.
export const BACKGROUND_CONTRAST_LIGHT_OPTIONS = [
  "default",
  "flat",
  "white",
] as const;
export const BACKGROUND_CONTRAST_DARK_OPTIONS = [
  "default",
  "flat",
  "black",
] as const;

/**
 * 두 다이얼이 어떤 값에서든 쓸 수 있는 변수 전부 — `DialBase.vars`. 리터럴인 이유:
 * `...BG_ROLE_KEYS` 로 짓으면 선언 순서가 모듈 초기화의 TDZ 에 걸리고, perfectionist 가
 * 순서를 바꾸자고 할 때 그 위험을 다시 재야 한다. 역할 토큰 둘을 담는지는
 * `background-contrast-dials.test.ts` 의 "vars 는 다섯 키 …" 가 고정한다.
 */
export const BACKGROUND_CONTRAST_VARS = [
  "--color-bg-default",
  "--color-editor-bg",
  "--color-bg-panel",
  "--color-bg-bar",
  "--color-bg-chrome-fill",
] as const;

type BackgroundContrastOption =
  | (typeof BACKGROUND_CONTRAST_DARK_OPTIONS)[number]
  | (typeof BACKGROUND_CONTRAST_LIGHT_OPTIONS)[number];

/**
 * 스펙 0059 §3.2 의 재배선 표. 모드 판정은 호출자(`dials.ts` 의 `toVars`)가 한다.
 *
 * 새 색을 계산하지 않는다 — 크롬·바·채움이 받는 것은 테마 자신의 시드이거나 `white`·
 * `black` 의 극값뿐이다. 필요한 시드가 없으면 그 시드에 기대는 키만 내지 않는다:
 * 저장분은 런타임 캐스트라 키가 빠질 수 있고(`applyThemeVars` 의 같은 가드), 그때
 * 추측으로 채우지 않는 것이 `deriveColorVars` 의 "계산할 수 있는 것만" 과 같은 규칙이다.
 *
 * 채움이 받는 색의 대비는 오늘 아래로 떨어지지 않는다 — `flat` 은 오늘의 쌍을 맞바꾼 것이라
 * 정의상 같고, `white`·`black` 은 내장 테마 8개에서 오늘 이상이다(스펙 0059 §3.3 의 표).
 */
export function backgroundContrastVars(
  option: BackgroundContrastOption,
  seeds: Readonly<Partial<Record<string, string>>>,
): Record<string, string> {
  const page = seeds["--color-bg-default"];
  const chrome = seeds["--color-bg-panel"];
  switch (option) {
    case "black":
      return extremeVars("#000000", page);
    case "default":
      return {};
    case "flat": {
      // 크롬이 본문 색으로 **내려온다**. 본문은 그대로다.
      const out: Record<string, string> = {};
      if (page !== undefined) {
        out["--color-bg-bar"] = page;
        out["--color-bg-panel"] = page;
      }
      if (chrome !== undefined) out["--color-bg-chrome-fill"] = chrome;
      return out;
    }
    case "white":
      return extremeVars("#ffffff", chrome);
  }
}

/** `white`·`black` — 표면 넷을 극값으로, 채움을 테마가 준 색 하나로. */
function extremeVars(
  surface: string,
  fill: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {
    "--color-bg-bar": surface,
    "--color-bg-default": surface,
    "--color-bg-panel": surface,
    "--color-editor-bg": surface,
  };
  if (fill !== undefined) out["--color-bg-chrome-fill"] = fill;
  return out;
}

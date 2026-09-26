// §364 외관 다이얼의 단일 출처 — 타입·병합·적용·설정 UI 가 전부 이 배열에서 파생한다.
//
// ‼️ 이 모듈이 값으로 import 하는 것은 **모듈 넷**뿐이다 — 잎 모듈 `color-hsl.ts`(그 파일
// 머리주석이 "아무것도 import 하지 않는다" 를 계약으로 적는다)와 `scale-dials.ts`(그 머리주석대로
// Style Dictionary 가 내는 `types/generated/scale.ts` 만 import 하고, 생성 포맷 `ts/scale` 은
// import 문을 쓰지 않는다 — `style-dictionary.config.ts`)와 `background-contrast.ts` ·
// `typography-dials.ts`(둘 다 그 머리주석대로 아무것도 import 하지 않는다). 값 import 는 그
// 다섯 파일에서 멈춘다.
// `settings/store.ts` 가 이것을 import 하므로, 여기서 스토어를 알면 순환이
// 된다(`settings/feature-keys.ts` 가 같은 이유로 잎 모듈이다) — import 가 잎에서
// 끝나는 모듈을 거치는 것은 순환을 만들 수 없다. `ColorMode` 의 `import type` 은
// `verbatimModuleSyntax`(CLAUDE.md · `tsconfig`) 하에서 컴파일 시 지워지고
// 런타임 간선을 만들지 않으므로 그 순환에 참여할 수 없다.

import type { ColorMode } from "./color-mode";

import {
  BACKGROUND_CONTRAST_DARK_OPTIONS,
  BACKGROUND_CONTRAST_LIGHT_OPTIONS,
  BACKGROUND_CONTRAST_VARS,
  backgroundContrastVars,
} from "./background-contrast";
import { hexToHsl, hslToHex } from "./color-hsl";
import {
  CORNER_FACTOR,
  CORNER_OPTIONS,
  DENSITY_FACTOR,
  DENSITY_OPTIONS,
  MOVING_RADIUS,
  MOVING_SPACE,
  scaleVars,
} from "./scale-dials";
import {
  EDITOR_FONT_SIZE_RANGE,
  EDITOR_LINE_HEIGHT_RANGE,
  parseFontFamily,
} from "./typography-dials";

export type DialDef = EnumDialDef | NumberDialDef | TextDialDef;

export type DialValue = number | string;

/**
 * `toVars` 가 값 말고 읽는 것.
 *
 * `seeds` 는 지금 `<html>` 에 실릴 시드 집합이다 — 설치 테마면 그 테마의
 * `modes[mode].colors`, cascade 가 소유하는 테마(`system` · 기본 둘)면 그 모드의
 * 기본 팔레트다. 색 다이얼이 채도·명도를 **물려받는** 출처이고, 그래서 같은
 * 다이얼 값이 테마마다·모드마다 다른 hex 를 낸다. 배경 대비 다이얼(스펙 0059)은
 * 여기서 본문·크롬 색을 읽어 **다른 역할에 옮겨 싣는다**.
 *
 * 레이아웃 다이얼은 둘 다 읽지 않는다. 그럼에도 인자에 있는 이유는 `DIALS` 를
 * 순회하는 소비자가 갈래를 좁히지 않고 `toVars` 를 부를 수 있어야 하기 때문이다 —
 * 0094 가 `toVars` 를 `DialValue` 로 넓힌 것과 같은 이유다.
 */
export interface DialContext {
  readonly mode: ColorMode;
  readonly seeds: Readonly<Partial<Record<string, string>>>;
}

export interface EnumDialDef extends DialBase {
  /** 이 다이얼이 없을 때의 값. 출처가 `default` 면 변수를 쓰지 않는다. */
  readonly defaultValue: string;
  readonly kind: "enum";
  /** 이 다이얼이 받아들이는 값 전부. 설정 UI 의 select 와 `parse` 가 같은 배열에서 파생한다. */
  readonly options: readonly string[];
  /**
   * 저장분·매니페스트에서 온 unknown 을 검증한다. 실패는 `undefined` 이고,
   * 그 층은 없었던 것으로 친다 — 그래야 낡거나 적대적인 값이 cascade 를 가리지 않는다.
   */
  parse: (raw: unknown) => string | undefined;
  /**
   * 값 → CSS 변수 맵. 비어 있는 맵은 "변수를 쓰지 말라" 는 뜻이고,
   * 그때 CSS 의 fallback 이 지배한다.
   *
   * `ctx` 를 받는 이유: 같은 다이얼 값이 모드마다·테마마다 다른 색을 내야 한다
   * (§367 — 강조색). 색을 내지 않는 다이얼은 이 인자를 무시한다.
   */
  toVars: (value: DialValue, ctx: DialContext) => Record<string, string>;
}

export interface NumberDialDef extends DialBase {
  /** 이 다이얼이 없을 때의 값. 출처가 `default` 면 변수를 쓰지 않는다. */
  readonly defaultValue: number;
  readonly kind: "number";
  /**
   * 저장분·매니페스트에서 온 unknown 을 검증한다. 실패는 `undefined` 이고,
   * 그 층은 없었던 것으로 친다 — 그래야 낡거나 적대적인 값이 cascade 를 가리지 않는다.
   */
  parse: (raw: unknown) => number | undefined;
  /**
   * 슬라이더가 읽는 범위. `parse` 가 **같은 상수**에서 파생하므로 설정 UI 가 범위를
   * 두 번 적지 않는다 — 두 번 적으면 슬라이더 끝에서 값이 조용히 버려진다.
   * `dials.test.ts` 의 경계 테스트가 그 일치를 고정한다.
   */
  readonly range: {
    readonly max: number;
    readonly min: number;
    readonly step: number;
  };
  /**
   * 값 → CSS 변수 맵. 비어 있는 맵은 "변수를 쓰지 말라" 는 뜻이고,
   * 그때 CSS 의 fallback 이 지배한다.
   *
   * `ctx` 를 받는 이유: 같은 다이얼 값이 모드마다·테마마다 다른 색을 내야 한다
   * (§367 — 강조색). 색을 내지 않는 다이얼은 이 인자를 무시한다.
   */
  toVars: (value: DialValue, ctx: DialContext) => Record<string, string>;
}

/**
 * §365 자유 문자열 다이얼 — 서체 이름처럼 열거할 수 없는 값(스펙 0060 D7). 테마가
 * `@font-face` 로 제 서체를 실어 올 수 있어 목록을 앱이 알 수 없다.
 */
export interface TextDialDef extends DialBase {
  /** 이 다이얼이 없을 때의 값. 출처가 `default` 면 변수를 쓰지 않는다. */
  readonly defaultValue: string;
  readonly kind: "text";
  /**
   * 저장분 · 매니페스트에서 온 unknown 을 검증한다. 실패는 `undefined` 이고, 그 층은 없었던
   * 것으로 친다.
   */
  parse: (raw: unknown) => string | undefined;
  toVars: (value: DialValue, ctx: DialContext) => Record<string, string>;
}

interface DialBase {
  /**
   * 이 다이얼의 변수를 **누가 `<html>` 에 쓰는가**.
   *
   * `"layout"` 은 `applyDialVars` 가 쓴다. `"color"` 는 쓰지 않는다 — `--color-*`
   * 인라인의 작성자는 테마 이펙트 하나이고, 그 이유는 실측이다: `applyDialVars`
   * 가 먼저 돌고 `clearThemeVars` 가 나중에 돈다(Task 4 의 회귀 테스트가 그
   * 순서를 고정한다). 다이얼이 `--color-*` 를 직접 쓰면 그 다음 줄에서 지워진다.
   *
   * `"editor"` 는 **아무도** `<html>` 에 쓰지 않는다 — 값이 CSS 변수가 아니라 소비자(활성
   * 편집기의 인라인 · §349 표면 변수 · 코드 크기 계산)가 읽는 입력이다. 그래서 `toVars` 는 빈
   * 맵, `vars` 는 빈 배열이다(스펙 0060 D3). 소비자는 `hooks/use-editor-typography.ts` 로
   * 병합값을 읽는다.
   */
  readonly channel: "color" | "editor" | "layout";
  readonly id: string;
  /**
   * 이 다이얼이 **어떤 값에서든** 쓸 수 있는 변수 전부. `clearDialVars` 가 이 목록을
   * 지우므로, `toVars` 가 여기 없는 키를 내보내면 되돌리기가 그 값을 남긴다.
   */
  readonly vars: readonly string[];
}

const WIDTH_RANGE = { max: 4000, min: 0, step: 20 } as const;
const PADDING_RANGE = { max: 16, min: 0, step: 0.5 } as const;
// §368 자간. 한글 본문은 약간의 음수 자간이 관례다 — `tokens/primitive/typography.json`
// 에 letter-spacing 계열이 **없어서**(실측) 토큰 승격이 아니라 새 축이다.
const LETTER_SPACING_RANGE = { max: 0.1, min: -0.05, step: 0.005 } as const;
// §368 문단 간격. `blocks.css` 의 `.tiptap p { margin: 0.5em 0 }` 이 기본값의 출처다.
const PARAGRAPH_SPACING_RANGE = { max: 2, min: 0, step: 0.05 } as const;
// §369 리스트 들여쓰기 가이드의 농도(%). 상한이 40 인 것은 가이드가 **배경 쪽으로**
// 섞이는 값이기 때문이다 — 100 은 본문 글자와 같은 색이 되어 중첩 리스트마다
// 검은 세로줄이 서고, 그 구간은 고를 이유가 없는 구간이다. `lists.css` 의 fallback
// 22% 가 기본값의 출처이고, 둘의 일치는 `styles/__tests__/list-styling.test.ts` 가
// 두 파일을 함께 읽어 고정한다.
const GUIDE_STRENGTH_RANGE = { max: 40, min: 0, step: 1 } as const;

/**
 * §5.1 순서 있는 리스트의 마커 정렬. 값 이름은 **무엇이 줄 맞춰지는가** 이지
 * 어느 쪽으로 미는가가 아니다 — `left`/`right` 로 이름 지으면 `toVars` 가 항등함수가
 * 되어, 이름과 CSS 값이 갈라질 수 있다는 사실 자체가 코드에서 사라진다.
 *
 *   number — 숫자의 시작점이 고정되고 마침표가 뒤로 밀린다(Logseq). CSS `text-align: left`
 *   period — 마침표가 고정되고 숫자가 앞으로 자란다. `text-align: right`
 *
 * 기본은 `number` 다. 다이얼이 생기기 전 화면(`period`)과 다른 쪽을 기본으로 고른
 * 것이고, 그 근거는 기하에 있다 — 마침표 기준에서 마커가 접기 화살표에서 떨어진 거리는
 * 그 항목의 **자릿수를 따라가서**, 한 리스트 안의 `1.` 과 `10.` 이 서로 다른 자리에서
 * 시작한다(실측: 16px 에서 21.43px 대 11.34px, 0.63em 차이). 숫자 기준은 시작점을
 * 고정해 그 차이를 없앤다. ‼️ 기본값을 바꾸는 것은 기존 사용자의 화면을 바꾸는 것이라
 * 릴리스 노트에 적을 변경이고, 되돌리기(backfill)는 하지 않는다 — 모두를 옛 모양에
 * 고정시키면 이 선택이 무효가 된다.
 * ‼️ "닿는다" 고는 쓰지 말 것 — 거터 공식이 가장 넓은 마커에도 여유를 남기므로 실제로
 * 닿지는 않고, 안내선은 마커에서 1.3em 넘게 떨어져 있다(`lists.css` 의 `left: -1em` 을
 * 전사해 계산).
 */
const ORDERED_MARKER_ALIGN_OPTIONS = ["number", "period"] as const;

/**
 * §367 강조 계열의 시드 네 키. 다이얼이 **함께** 돌리므로 팔레트가 갖고 있던
 * 관계가 유지된다 — 실측: `accent-ai` 는 `accent-default` 보다 라이트에서
 * +41.1°, 다크에서 +42.0° 다(2026-09-22, `src/types/generated/palette-*.ts`).
 * 하나만 돌리면 그 관계가 깨진다.
 */
const ACCENT_SEED_KEYS = [
  "--color-accent-ai",
  "--color-accent-default",
  "--color-accent-hover",
  "--color-accent-subtle",
] as const;

/**
 * §367 강조의 두 축이 **어느 다이얼인가**. 색상과 채도는 다이얼이 둘이지만 색은
 * 하나이고, `colorDialVars`(`apply.ts`)가 그 둘만 순회에서 빼내 {@link accentFamilyVars}
 * 로 함께 계산한다 — 그 자리 주석이 왜인지를 적는다.
 *
 * 색 다이얼을 새로 더할 때 여기 넣을지 말지가 곧 "그것이 같은 색의 또 한 축인가" 라는
 * 질문이다. 아니라면 넣지 않는다 — 그러면 `colorDialVars` 의 일반 순회가 맡는다.
 */
export const ACCENT_AXIS_DIAL_IDS = {
  h: "accentHueShift",
  s: "accentSaturationShift",
} as const satisfies Record<"h" | "s", DialId>;

// ‼️ 아래 두 범위가 담는 것은 **이동량**이지 절대값이 아니다. 절대값이면 기본값을
// 정할 수 없다 — 슬라이더가 217 에 서 있는데 지금 테마의 강조가 다른 색상이면 그
// 숫자는 거짓말이고, 테마를 갈아탈 때마다 사용자가 만진 적 없는 값을 가리킨다.
// 0 은 모든 테마에서 참이다.
const ACCENT_HUE_RANGE = { max: 180, min: -180, step: 1 } as const;
// 위 주석이 이 상수도 지배한다 — 채도 역시 이동량(퍼센트 포인트)이다.
const ACCENT_SATURATION_RANGE = { max: 50, min: -50, step: 1 } as const;

/**
 * §368.2 강조 렌더링. 값 셋 전부가 **CSS 변수만** 낸다 — 이것이 계약이다.
 *
 * `italic` 이 빈 맵인 것은 희소성이면서 동시에 "오늘과 같다" 는 뜻이다. `color`·
 * `weight` 는 `font-style: normal` 을 **반드시 함께** 내야 한다. 내지 않으면 기울임
 * 위에 색이 얹혀 둘 다 적용된 상태가 되고, 그것은 어느 사용자도 고른 적 없는 값이다.
 */
const EMPHASIS_OPTIONS = ["italic", "color", "weight"] as const;

const inRange =
  (range: { readonly max: number; readonly min: number }) =>
  (raw: unknown): number | undefined =>
    typeof raw === "number" &&
    Number.isFinite(raw) &&
    raw >= range.min &&
    raw <= range.max
      ? raw
      : undefined;

const oneOf =
  <T extends string>(options: readonly T[]) =>
  (raw: unknown): T | undefined =>
    typeof raw === "string" && (options as readonly string[]).includes(raw)
      ? (raw as T)
      : undefined;

/** `editor` 채널 다이얼의 `toVars` — 무엇도 내지 않는다(`DialBase.channel` 의 주석). */
const noVars = (
  _value: DialValue,
  _ctx: DialContext,
): Record<string, string> => ({});

/**
 * §367 강조 시드를 HSL 두 축에서 다시 쓴다. 두 이동량이 모두 0 이면 빈 맵 — 희소성(§364.2).
 *
 * ‼️ **두 축을 한 번에 받는 것이 계약이다.** 색상 다이얼과 채도 다이얼은 둘 다
 * {@link ACCENT_SEED_KEYS} **전부**를 내므로, 축마다 따로 계산해 결과를 합치면 나중
 * 것이 앞 것을 통째로 덮는다 — 그것이 리뷰 C1 이 실측한 결함이다(채도를 이미 옮긴
 * 상태에서 색상 슬라이더를 끌면 값은 저장되고 화면은 한 픽셀도 변하지 않았다).
 *
 * 축을 차례로 적용하는 누산기도 답이 아니다. 두 축은 직교해 보이지만 {@link hslToHex}
 * 가 채도를 0~100 으로 자르고 8비트로 양자화하므로 교환법칙을 따르지 않고, 그러면
 * {@link DIALS} 의 **순서**가 결과를 정하게 된다 — 눈에 보이는 무동작을 조용한 순서
 * 의존으로 바꾸는 거래다.
 *
 * 모드 분기가 **없다**. 같은 값이 모드마다 다른 hex 를 내는 것은 `ctx.seeds` 가
 * 그 모드의 팔레트이기 때문이고, 채도·명도를 시드에서 물려받는 것이 그 통로다.
 */
export const accentFamilyVars = (
  shift: { readonly h: number; readonly s: number },
  ctx: DialContext,
): Record<string, string> => {
  if (shift.h === 0 && shift.s === 0) return {};
  const out: Record<string, string> = {};
  for (const key of ACCENT_SEED_KEYS) {
    const hsl = hexToHsl(ctx.seeds[key] ?? "");
    // 시드가 없거나 읽을 수 없으면 그 키는 계산할 수 없다 — 내지 않는다.
    if (hsl === null) continue;
    out[key] = hslToHex({ h: hsl.h + shift.h, l: hsl.l, s: hsl.s + shift.s });
  }
  return out;
};

/**
 * 한 축짜리 어댑터 — `DialDef.toVars` 는 다이얼 **하나**의 값만 받기 때문이다.
 *
 * ‼️ **적용 경로는 이것을 부르지 않는다.** 이 함수가 내는 것은 "다른 축이 0 일 때" 의
 * 강조 계열이고, `<html>` 에 실제로 쓰이는 값은 `colorDialVars` 가 두 축을 함께 읽어
 * {@link accentFamilyVars} 에서 얻는다. 여기 남아 있는 이유는 `DIALS` 를 다이얼 단위로
 * 순회하는 소비자 — `dials.test.ts` 의 `vars` 전수 검사와 `accent-dials.test.ts` 의
 * 축별 테스트 — 가 `toVars` 를 부를 수 있어야 하기 때문이다.
 */
const shiftAccent = (
  shift: DialValue,
  ctx: DialContext,
  axis: "h" | "s",
): Record<string, string> => {
  if (typeof shift !== "number") return {};
  return accentFamilyVars(
    axis === "h" ? { h: shift, s: 0 } : { h: 0, s: shift },
    ctx,
  );
};

/**
 * §368 줄바꿈 규칙. 기본값 `normal` 은 브라우저 기본이고, 그때 `toVars` 가 빈 맵을
 * 돌려주므로 CSS 의 fallback 이 지배한다 — 오늘 화면과 픽셀 단위로 같다.
 *
 * `keepAll` 이 변수를 **둘** 내는 이유: `word-break: keep-all` 만 걸면 한글 단어는
 * 지켜지지만 긴 라틴 문자열(URL · 식별자)이 컨테이너를 넘어간다. `overflow-wrap`
 * 을 짝지어야 한글 규칙과 오버플로 방지가 동시에 선다.
 */
const LINE_BREAK_OPTIONS = ["normal", "keepAll"] as const;

// ‼️ `toVars` 는 두 갈래 모두 `DialValue` 를 받는다. 좁게 적고 싶어지지만
// (`(value: number) => …`), 그러면 `as const satisfies readonly DialDef[]` 가
// **선언 시점에** 거부한다 — 실측(스크래치 컴파일):
//   Type '(v: number) => Record<string, string>' is not assignable to type
//   '(value: DialValue) => Record<string, string>'
// 이것은 불편이 아니라 이득이다. 넓히기 전에는 같은 어긋남이 선언을 통과하고
// `apply.ts` 가 유니온 원소의 `toVars` 를 부를 때 TS7053 으로 터졌다(0093 Task 5).
// 이제 한 자리에서 잡힌다.
//
// 대신 좁히기는 각 다이얼의 `toVars` 안에서 한다 — `typeof value === "number"`.
// 그 갈래는 죽은 코드가 아니다: `parse` 와 `toVars` 를 짝지어 주는 타입은 없고,
// 저장분이 낡았거나 매니페스트가 적대적이면 다른 종류의 값이 도달할 수 있다.
// 그때 빈 맵을 돌려주는 것이 옳다 — cascade 가 지배한다.
//
// 반환 타입은 여전히 명시한다. 삼항의 두 갈래가
// `{} | { "--x": string }` 유니온으로 추론되어 `Record<string, string>` 에
// 대입되지 않는다(TS2322).
export const DIALS = [
  {
    // 기본값 800 은 `editor-settings.ts` 의 `editorMaxWidth` 와 같아야 한다 —
    // 마이그레이션(Task 4)이 기존 값을 사용자 층으로 옮기고, 그때 기본과 같은
    // 값은 옮기지 않기 때문이다.
    channel: "layout",
    defaultValue: 800,
    id: "editorMaxWidth",
    kind: "number",
    parse: inRange(WIDTH_RANGE),
    range: WIDTH_RANGE,
    toVars: (value: DialValue, _ctx: DialContext): Record<string, string> =>
      typeof value === "number" && value > 0
        ? { "--editor-max-width": `${value}px` }
        : {},
    vars: ["--editor-max-width"],
  },
  {
    // `src/styles/base.css` 의 `--editor-padding: 4rem` 과 같은 값·같은 단위.
    channel: "layout",
    defaultValue: 4,
    id: "editorPadding",
    kind: "number",
    parse: inRange(PADDING_RANGE),
    range: PADDING_RANGE,
    toVars: (value: DialValue, _ctx: DialContext): Record<string, string> =>
      typeof value === "number" ? { "--editor-padding": `${value}rem` } : {},
    vars: ["--editor-padding"],
  },
  {
    channel: "layout",
    defaultValue: "normal",
    id: "editorLineBreak",
    kind: "enum",
    options: LINE_BREAK_OPTIONS,
    parse: oneOf(LINE_BREAK_OPTIONS),
    toVars: (value: DialValue, _ctx: DialContext): Record<string, string> =>
      value === "keepAll"
        ? {
            "--editor-overflow-wrap": "break-word",
            "--editor-word-break": "keep-all",
          }
        : {},
    vars: ["--editor-overflow-wrap", "--editor-word-break"],
  },
  {
    channel: "layout",
    defaultValue: 0,
    id: "editorLetterSpacing",
    kind: "number",
    parse: inRange(LETTER_SPACING_RANGE),
    range: LETTER_SPACING_RANGE,
    // ‼️ `value !== 0` 갈래가 있는 이유: `letter-spacing: 0em` 과 `letter-spacing:
    // normal` 은 **같지 않다**(`normal` 은 폰트/조판 엔진이 자간을 조정할 여지를
    // 남긴다). 기본값에서 아무것도 내지 않아야 오늘 화면과 같다.
    toVars: (value: DialValue, _ctx: DialContext): Record<string, string> =>
      typeof value === "number" && value !== 0
        ? { "--editor-letter-spacing": `${value}em` }
        : {},
    vars: ["--editor-letter-spacing"],
  },
  {
    // `blocks.css` 의 `.tiptap p { margin: 0.5em 0 }` 과 같은 값·같은 단위.
    channel: "layout",
    defaultValue: 0.5,
    id: "editorParagraphSpacing",
    kind: "number",
    parse: inRange(PARAGRAPH_SPACING_RANGE),
    range: PARAGRAPH_SPACING_RANGE,
    toVars: (value: DialValue, _ctx: DialContext): Record<string, string> =>
      typeof value === "number"
        ? { "--editor-paragraph-spacing": `${value}em` }
        : {},
    vars: ["--editor-paragraph-spacing"],
  },
  {
    // `lists.css` 의 `var(--editor-guide-strength, 22%)` 와 같은 수·같은 단위.
    channel: "layout",
    defaultValue: 22,
    id: "editorListGuideStrength",
    kind: "number",
    parse: inRange(GUIDE_STRENGTH_RANGE),
    range: GUIDE_STRENGTH_RANGE,
    // ‼️ 0 에서 빈 맵을 돌려주지 **않는다**. `editorMaxWidth` 는 0 을 "무제한" 으로
    // 읽어 비우지만, 여기서 0 은 "배경색 100%" 즉 사용자가 고른 끄기다 — 비우면
    // fallback 22% 가 지배해서 끄기가 켜기가 된다.
    //
    // 끄기를 불투명도로 만들지 않은 것도 같은 자리의 결정이다. `lists.css` 가 알파
    // 대신 `color-mix` 를 쓰는 이유를 그 파일이 적어 두었다 — 레일이 불투명해야
    // 선택 영역이 그 위를 지나가도 물들지 않는다. 0% 혼합은 배경색과 같은 색이면서
    // 여전히 불투명하므로 그 성질을 지키면서 보이지 않게 한다.
    toVars: (value: DialValue): Record<string, string> =>
      typeof value === "number"
        ? { "--editor-guide-strength": `${value}%` }
        : {},
    vars: ["--editor-guide-strength"],
  },
  {
    // `lists.css` 의 `var(--editor-ordered-marker-align, left)` 와 같은 쪽.
    // 둘의 일치는 `styles/__tests__/list-styling.test.ts` 가 두 파일을 함께 읽어
    // 고정한다 — 기본 출처의 다이얼은 변수를 쓰지 않으므로(`apply.ts`), 갈리면
    // 사용자가 select 를 처음 건드리는 순간 화면이 튄다.
    channel: "layout",
    defaultValue: "number",
    id: "editorOrderedMarkerAlign",
    kind: "enum",
    options: ORDERED_MARKER_ALIGN_OPTIONS,
    parse: oneOf(ORDERED_MARKER_ALIGN_OPTIONS),
    toVars: (value: DialValue): Record<string, string> =>
      value === "period" ? { "--editor-ordered-marker-align": "right" } : {},
    vars: ["--editor-ordered-marker-align"],
  },
  {
    channel: "layout",
    defaultValue: "italic",
    id: "editorEmphasisStyle",
    kind: "enum",
    options: EMPHASIS_OPTIONS,
    parse: oneOf(EMPHASIS_OPTIONS),
    toVars: (value: DialValue, _ctx: DialContext): Record<string, string> => {
      if (value === "color") {
        return {
          "--editor-emphasis-color": "var(--color-accent-default)",
          "--editor-emphasis-font-style": "normal",
        };
      }
      if (value === "weight") {
        return {
          "--editor-emphasis-font-style": "normal",
          "--editor-emphasis-font-weight": "var(--font-weight-semibold)",
          // `.tiptap strong em`(media.css) 전용 — `***x***`(<strong><em>)에서
          // 절대값 semibold(600)가 strong 의 700보다 가벼워 "강조"가 "덜
          // 굵게"로 뒤집히는 것을 막는다. `bolder`는 물려받은 계산값 기준
          // 상대값이라 부모(여기서는 700)보다 항상 무겁게 계산된다.
          "--editor-emphasis-font-weight-nested": "bolder",
        };
      }
      return {};
    },
    // 넷 전부. 한 값이 내지 않는 변수도 여기 있어야 `clearDialVars` 와
    // `applyDialVars` 의 removeProperty 가 값을 남기지 않는다.
    vars: [
      "--editor-emphasis-color",
      "--editor-emphasis-font-style",
      "--editor-emphasis-font-weight",
      "--editor-emphasis-font-weight-nested",
    ],
  },
  // §365 다이얼 6 — 본문 타이포(스펙 0060). `channel: "editor"` 라 `<html>` 에 아무것도 쓰지
  // 않는다 — 소비자가 병합값을 읽어 제 경로(활성 편집기의 인라인 · §349 표면 변수)로 적용한다.
  // 기본값은 옮기기 전 `editor-settings.ts` 의 초기값이고, v28 마이그레이션(`store.ts`)이 그와
  // 다른 저장값만 사용자 층으로 옮긴다. `""` 는 "설정 없음" — 토큰 스택(`--font-family-editor` ·
  // `--font-family-mono`)을 그대로 쓴다.
  {
    channel: "editor",
    defaultValue: "",
    id: "editorFontFamily",
    kind: "text",
    parse: parseFontFamily,
    toVars: noVars,
    vars: [],
  },
  {
    channel: "editor",
    defaultValue: "",
    id: "editorCodeFontFamily",
    kind: "text",
    parse: parseFontFamily,
    toVars: noVars,
    vars: [],
  },
  {
    channel: "editor",
    defaultValue: 16,
    id: "editorFontSize",
    kind: "number",
    parse: inRange(EDITOR_FONT_SIZE_RANGE),
    range: EDITOR_FONT_SIZE_RANGE,
    toVars: noVars,
    vars: [],
  },
  {
    channel: "editor",
    defaultValue: 1.75,
    id: "editorLineHeight",
    kind: "number",
    parse: inRange(EDITOR_LINE_HEIGHT_RANGE),
    range: EDITOR_LINE_HEIGHT_RANGE,
    toVars: noVars,
    vars: [],
  },
  // ‼️ 아래 둘이 첫 `channel: "color"` 다이얼이다 — `applyDialVars` 가 쓰지 않고
  // 테마 이펙트가 가져간다(`apply.ts` 의 채널 주석이 그 이유를 적는다).
  {
    channel: "color",
    defaultValue: 0,
    id: "accentHueShift",
    kind: "number",
    parse: inRange(ACCENT_HUE_RANGE),
    range: ACCENT_HUE_RANGE,
    toVars: (value: DialValue, ctx: DialContext): Record<string, string> =>
      shiftAccent(value, ctx, "h"),
    vars: [...ACCENT_SEED_KEYS],
  },
  // ‼️ `hslToHex` 는 채도를 0~100 으로 자르므로(`color-hsl.ts`), 채도 100 인 시드에
  // `+50` 을 줘도 100 에서 멈춘다. `parse` 의 범위는 **저장값**의 범위이고 자르기는
  // **계산**의 일이다 — 둘을 한 곳에 몰면 "왜 슬라이더를 더 올려도 안 변하지" 가
  // 저장 문제로 보인다.
  {
    channel: "color",
    defaultValue: 0,
    id: "accentSaturationShift",
    kind: "number",
    parse: inRange(ACCENT_SATURATION_RANGE),
    range: ACCENT_SATURATION_RANGE,
    toVars: (value: DialValue, ctx: DialContext): Record<string, string> =>
      shiftAccent(value, ctx, "s"),
    vars: [...ACCENT_SEED_KEYS],
  },
  // §365 다이얼 2a·2b — 배경 대비(스펙 0059). 모드마다 하나이고 제 모드가 아니면 아무것도
  // 내지 않는다 — 한 다이얼에 5값을 두면 지금 모드에 없는 값을 골랐을 때 저장만 되고 화면이
  // 바뀌지 않는다(D1). 모드는 `ctx.mode`(`resolveColorMode`)라 라이트 전용 테마에서는 다크
  // 다이얼이 언제나 빈 맵이다. 재배선 표는 `background-contrast.ts` 에 있다.
  {
    channel: "color",
    defaultValue: "default",
    id: "backgroundContrastLight",
    kind: "enum",
    options: BACKGROUND_CONTRAST_LIGHT_OPTIONS,
    parse: oneOf(BACKGROUND_CONTRAST_LIGHT_OPTIONS),
    toVars: (value: DialValue, ctx: DialContext): Record<string, string> => {
      if (ctx.mode !== "light") return {};
      const option = oneOf(BACKGROUND_CONTRAST_LIGHT_OPTIONS)(value);
      return option === undefined
        ? {}
        : backgroundContrastVars(option, ctx.seeds);
    },
    vars: BACKGROUND_CONTRAST_VARS,
  },
  {
    channel: "color",
    defaultValue: "default",
    id: "backgroundContrastDark",
    kind: "enum",
    options: BACKGROUND_CONTRAST_DARK_OPTIONS,
    parse: oneOf(BACKGROUND_CONTRAST_DARK_OPTIONS),
    toVars: (value: DialValue, ctx: DialContext): Record<string, string> => {
      if (ctx.mode !== "dark") return {};
      const option = oneOf(BACKGROUND_CONTRAST_DARK_OPTIONS)(value);
      return option === undefined
        ? {}
        : backgroundContrastVars(option, ctx.seeds);
    },
    vars: BACKGROUND_CONTRAST_VARS,
  },
  // §365 다이얼 4·5 — 스케일 전체를 한 곱수로(스펙 0057). 행은 외관 탭이다
  // (0055 §4.4: 앱 전체의 겉모습).
  {
    channel: "layout",
    defaultValue: "default",
    id: "density",
    kind: "enum",
    options: DENSITY_OPTIONS,
    parse: oneOf(DENSITY_OPTIONS),
    toVars: (value: DialValue, _ctx: DialContext): Record<string, string> => {
      const option = oneOf(DENSITY_OPTIONS)(value);
      return option === undefined
        ? {}
        : scaleVars(MOVING_SPACE, DENSITY_FACTOR[option]);
    },
    vars: MOVING_SPACE.map(([name]) => name),
  },
  {
    channel: "layout",
    defaultValue: "default",
    id: "cornerRadius",
    kind: "enum",
    options: CORNER_OPTIONS,
    parse: oneOf(CORNER_OPTIONS),
    toVars: (value: DialValue, _ctx: DialContext): Record<string, string> => {
      const option = oneOf(CORNER_OPTIONS)(value);
      return option === undefined
        ? {}
        : scaleVars(MOVING_RADIUS, CORNER_FACTOR[option]);
    },
    vars: MOVING_RADIUS.map(([name]) => name),
  },
] as const satisfies readonly DialDef[];

export type DialId = (typeof DIALS)[number]["id"];

/** 층 하나가 싣는 값. 희소하다 — 그 층이 말하지 않는 다이얼은 키가 없다. */
export type DialValues = Partial<Record<DialId, DialValue>>;

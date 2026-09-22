// §364 외관 다이얼의 단일 출처 — 타입·병합·적용·설정 UI 가 전부 이 배열에서 파생한다.
//
// ‼️ 이 모듈이 값으로 import 하는 것은 `color-hsl.ts` **하나**뿐이고, 그 모듈은
// 아무것도 import 하지 않는다(그 파일 머리주석이 그것을 계약으로 적는다).
// `settings/store.ts` 가 이것을 import 하므로, 여기서 스토어를 알면 순환이
// 된다(`settings/feature-keys.ts` 가 같은 이유로 잎 모듈이다) — 잎 하나를 거치는
// 것은 순환을 만들 수 없다. `ColorMode` 의 `import type` 은
// `verbatimModuleSyntax`(CLAUDE.md · `tsconfig`) 하에서 컴파일 시 지워지고
// 런타임 간선을 만들지 않으므로 그 순환에 참여할 수 없다.

import type { ColorMode } from "./color-mode";

import { hexToHsl, hslToHex } from "./color-hsl";

export type DialDef = EnumDialDef | NumberDialDef;

export type DialValue = number | string;

/**
 * `toVars` 가 값 말고 읽는 것.
 *
 * `seeds` 는 지금 `<html>` 에 실릴 시드 집합이다 — 설치 테마면 그 테마의
 * `modes[mode].colors`, cascade 가 소유하는 테마(`system` · 기본 둘)면 그 모드의
 * 기본 팔레트다. 색 다이얼이 채도·명도를 **물려받는** 출처이고, 그래서 같은
 * 다이얼 값이 테마마다·모드마다 다른 hex 를 낸다.
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

interface DialBase {
  /**
   * 이 다이얼의 변수를 **누가 `<html>` 에 쓰는가**.
   *
   * `"layout"` 은 `applyDialVars` 가 쓴다. `"color"` 는 쓰지 않는다 — `--color-*`
   * 인라인의 작성자는 테마 이펙트 하나이고, 그 이유는 실측이다: `applyDialVars`
   * 가 먼저 돌고 `clearThemeVars` 가 나중에 돈다(Task 4 의 회귀 테스트가 그
   * 순서를 고정한다). 다이얼이 `--color-*` 를 직접 쓰면 그 다음 줄에서 지워진다.
   */
  readonly channel: "color" | "layout";
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
] as const satisfies readonly DialDef[];

export type DialId = (typeof DIALS)[number]["id"];

/** 층 하나가 싣는 값. 희소하다 — 그 층이 말하지 않는 다이얼은 키가 없다. */
export type DialValues = Partial<Record<DialId, DialValue>>;

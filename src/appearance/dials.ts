// §364 외관 다이얼의 단일 출처 — 타입·병합·적용·설정 UI 가 전부 이 배열에서 파생한다.
//
// ‼️ 이 모듈은 아무것도 import 하지 않는다. `settings/store.ts` 가 이것을 import
// 하므로, 여기서 스토어를 알면 순환이 된다 — `settings/feature-keys.ts` 가 같은
// 이유로 잎 모듈이다.

export type DialDef = EnumDialDef | NumberDialDef;

export type DialValue = number | string;

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
   */
  toVars: (value: DialValue) => Record<string, string>;
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
   */
  toVars: (value: DialValue) => Record<string, string>;
}

interface DialBase {
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
    defaultValue: 800,
    id: "editorMaxWidth",
    kind: "number",
    parse: inRange(WIDTH_RANGE),
    range: WIDTH_RANGE,
    toVars: (value: DialValue): Record<string, string> =>
      typeof value === "number" && value > 0
        ? { "--editor-max-width": `${value}px` }
        : {},
    vars: ["--editor-max-width"],
  },
  {
    // `src/styles/base.css` 의 `--editor-padding: 4rem` 과 같은 값·같은 단위.
    defaultValue: 4,
    id: "editorPadding",
    kind: "number",
    parse: inRange(PADDING_RANGE),
    range: PADDING_RANGE,
    toVars: (value: DialValue): Record<string, string> =>
      typeof value === "number" ? { "--editor-padding": `${value}rem` } : {},
    vars: ["--editor-padding"],
  },
  {
    defaultValue: "normal",
    id: "editorLineBreak",
    kind: "enum",
    options: LINE_BREAK_OPTIONS,
    parse: oneOf(LINE_BREAK_OPTIONS),
    toVars: (value: DialValue): Record<string, string> =>
      value === "keepAll"
        ? {
            "--editor-overflow-wrap": "break-word",
            "--editor-word-break": "keep-all",
          }
        : {},
    vars: ["--editor-overflow-wrap", "--editor-word-break"],
  },
  {
    defaultValue: 0,
    id: "editorLetterSpacing",
    kind: "number",
    parse: inRange(LETTER_SPACING_RANGE),
    range: LETTER_SPACING_RANGE,
    // ‼️ `value !== 0` 갈래가 있는 이유: `letter-spacing: 0em` 과 `letter-spacing:
    // normal` 은 **같지 않다**(`normal` 은 폰트/조판 엔진이 자간을 조정할 여지를
    // 남긴다). 기본값에서 아무것도 내지 않아야 오늘 화면과 같다.
    toVars: (value: DialValue): Record<string, string> =>
      typeof value === "number" && value !== 0
        ? { "--editor-letter-spacing": `${value}em` }
        : {},
    vars: ["--editor-letter-spacing"],
  },
  {
    // `blocks.css` 의 `.tiptap p { margin: 0.5em 0 }` 과 같은 값·같은 단위.
    defaultValue: 0.5,
    id: "editorParagraphSpacing",
    kind: "number",
    parse: inRange(PARAGRAPH_SPACING_RANGE),
    range: PARAGRAPH_SPACING_RANGE,
    toVars: (value: DialValue): Record<string, string> =>
      typeof value === "number"
        ? { "--editor-paragraph-spacing": `${value}em` }
        : {},
    vars: ["--editor-paragraph-spacing"],
  },
  {
    // `lists.css` 의 `var(--editor-guide-strength, 22%)` 와 같은 수·같은 단위.
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
    defaultValue: "italic",
    id: "editorEmphasisStyle",
    kind: "enum",
    options: EMPHASIS_OPTIONS,
    parse: oneOf(EMPHASIS_OPTIONS),
    toVars: (value: DialValue): Record<string, string> => {
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
] as const satisfies readonly DialDef[];

export type DialId = (typeof DIALS)[number]["id"];

/** 층 하나가 싣는 값. 희소하다 — 그 층이 말하지 않는 다이얼은 키가 없다. */
export type DialValues = Partial<Record<DialId, DialValue>>;

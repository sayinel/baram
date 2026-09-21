// §364 외관 다이얼의 단일 출처 — 타입·병합·적용·설정 UI 가 전부 이 배열에서 파생한다.
//
// ‼️ 이 모듈은 아무것도 import 하지 않는다. `settings/store.ts` 가 이것을 import
// 하므로, 여기서 스토어를 알면 순환이 된다 — `settings/feature-keys.ts` 가 같은
// 이유로 잎 모듈이다.
//
// 값 타입이 전부 number 인 것은 지금 두 다이얼이 그렇기 때문이다. 열거형 다이얼
// (배경 대비 등)이 오면 그때 넓힌다 — 쓰지 않을 일반성을 미리 만들지 않는다.

export interface DialDef {
  /** 이 다이얼이 없을 때의 값. 출처가 `default` 면 변수를 쓰지 않는다. */
  readonly defaultValue: number;
  readonly id: string;
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
  toVars: (value: number) => Record<string, string>;
  /**
   * 이 다이얼이 쓸 수 있는 변수 **전부**. `clearDialVars` 가 이 목록을 지우므로,
   * `toVars` 가 여기 없는 키를 내보내면 되돌리기가 그 값을 남긴다.
   */
  readonly vars: readonly string[];
}

const WIDTH_RANGE = { max: 4000, min: 0, step: 20 } as const;
const PADDING_RANGE = { max: 16, min: 0, step: 0.5 } as const;

const inRange =
  (range: { readonly max: number; readonly min: number }) =>
  (raw: unknown): number | undefined =>
    typeof raw === "number" &&
    Number.isFinite(raw) &&
    raw >= range.min &&
    raw <= range.max
      ? raw
      : undefined;

// ‼️ 모든 다이얼의 `toVars` 는 반환 타입을 명시한다. 두 가지 이유가 있고 둘 다
// 실측으로 확인됐다. (a) 조건부로 다른 객체를 돌려주면 TS 가 삼항의 두 갈래를
// `{} | { "--editor-max-width": string }` 유니온으로 추론해 `Record<string,
// string>` 에 대입되지 않는다(TS2322). (b) 다이얼마다 반환 타입이 갈라지면
// `DIALS` 를 순회하는 소비자가 `dial.toVars(...)` 의 결과를 인덱싱할 때
// TS7053 이 난다 — `apply.ts` 가 실제로 그렇게 깨졌다. `readonly` 조절로는
// 어느 쪽도 고쳐지지 않는다.
export const DIALS = [
  {
    // 기본값 800 은 `editor-settings.ts` 의 `editorMaxWidth` 와 같아야 한다 —
    // 마이그레이션(Task 4)이 기존 값을 사용자 층으로 옮기고, 그때 기본과 같은
    // 값은 옮기지 않기 때문이다.
    defaultValue: 800,
    id: "editorMaxWidth",
    parse: inRange(WIDTH_RANGE),
    range: WIDTH_RANGE,
    toVars: (value: number): Record<string, string> =>
      value > 0 ? { "--editor-max-width": `${value}px` } : {},
    vars: ["--editor-max-width"],
  },
  {
    // `src/styles/base.css` 의 `--editor-padding: 4rem` 과 같은 값·같은 단위.
    defaultValue: 4,
    id: "editorPadding",
    parse: inRange(PADDING_RANGE),
    range: PADDING_RANGE,
    toVars: (value: number): Record<string, string> => ({
      "--editor-padding": `${value}rem`,
    }),
    vars: ["--editor-padding"],
  },
] as const satisfies readonly DialDef[];

export type DialId = (typeof DIALS)[number]["id"];

/** 층 하나가 싣는 값. 희소하다 — 그 층이 말하지 않는 다이얼은 키가 없다. */
export type DialValues = Partial<Record<DialId, number>>;

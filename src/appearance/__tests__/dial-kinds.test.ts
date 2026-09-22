// §368 Task 1 — 열거 다이얼이 가능해졌다는 것과, 그 확장이 저장분을 깨지 않는다는 것.
import { describe, expect, it } from "vitest";

import { DIALS } from "../dials";
import { resolveDials } from "../merge";

describe("열거 다이얼", () => {
  const lineBreak = DIALS.find((d) => d.id === "editorLineBreak");

  it("options 안의 값만 통과시킨다", () => {
    expect(lineBreak?.parse("keepAll")).toBe("keepAll");
    expect(lineBreak?.parse("normal")).toBe("normal");
  });

  // 비공허성: 위 단언은 parse 가 무조건 raw 를 돌려줘도 통과한다.
  // 아래 셋이 그 구현을 배제한다.
  it("모르는 문자열·숫자·객체를 버린다", () => {
    expect(lineBreak?.parse("KEEPALL")).toBeUndefined();
    expect(lineBreak?.parse(0)).toBeUndefined();
    expect(lineBreak?.parse({ toString: () => "keepAll" })).toBeUndefined();
  });

  it("기본값에서는 변수를 하나도 내지 않는다 (희소성)", () => {
    expect(lineBreak?.toVars("normal")).toEqual({});
  });

  it("vars 는 toVars 가 낼 수 있는 키를 전부 담는다", () => {
    // 되돌리기가 값을 남기지 않는다는 것의 구조적 확인 — 다이얼이 낼 수 있는
    // 모든 값에 대해 검사한다. options 를 도는 것이 핵심이다: 한 값만 보면
    // keepAll 이 내는 둘 중 하나를 vars 에서 빠뜨려도 통과한다.
    for (const dial of DIALS) {
      if (dial.kind !== "enum") continue;
      for (const option of dial.options) {
        for (const key of Object.keys(dial.toVars(option))) {
          expect(dial.vars).toContain(key);
        }
      }
    }
  });
});

describe("§368 경계 테스트", () => {
  it("모든 숫자 다이얼의 range 양 끝이 parse 를 통과한다", () => {
    for (const dial of DIALS) {
      if (dial.kind !== "number") continue;
      expect(dial.parse(dial.range.min)).toBe(dial.range.min);
      expect(dial.parse(dial.range.max)).toBe(dial.range.max);
      // 비공허성: 바로 바깥은 거부돼야 한다. 없으면 parse 가 무조건 통과해도
      // 위가 통과한다.
      expect(dial.parse(dial.range.min - dial.range.step)).toBeUndefined();
      expect(dial.parse(dial.range.max + dial.range.step)).toBeUndefined();
    }
  });

  // 희소성의 진짜 계약: "기본값에서 변수를 내지 않거나, 내는 값이 CSS 의
  // 기본과 같다". 후자는 이 테스트로 확인할 수 없으므로(toVars 는 값만 보고
  // CSS 파일을 읽지 않는다) 아래 셋을 명시적으로 열거해 제외한다 — 열거 없는
  // 전칭은 이 리포의 규칙 위반이다(CLAUDE.md).
  //
  // ‼️ 브리프는 이 예외를 editorPadding 하나로 적었지만, 실측(이 테스트를
  // 실제로 돌려 보면)하면 editorMaxWidth 도 같은 이유로 걸린다 — 브리프가
  // 놓친 두 번째 사례다.
  const SPARSE_AT_DEFAULT_EXCEPT = new Set([
    // `toVars`가 보는 조건은 `value > 0`뿐이고 defaultValue(800)가 그 조건을
    // 만족해 기본값에서도 항상 변수를 낸다. 실제 희소성은 여기가 아니라
    // `apply.ts`의 `origin === "default"` 분기가 지킨다 — 그 분기는 origin이
    // default면 `toVars`를 아예 부르지 않고 `{}`를 쓴다. `defaultValue: 800`
    // 자체는 이 값과 다른 CSS fallback(`max-width: var(--editor-max-width,
    // none)`, 즉 무제한)을 향해 있지 않다 — 마이그레이션 비교용 숫자일 뿐이라
    // (dials.ts 주석) `toVars`와 CSS fallback의 값이 애초에 같을 필요가 없다.
    "editorMaxWidth",
    // `--editor-padding`은 `base.css`에 전역 기본(`4rem`)이 있고 `.tiptap`이
    // fallback 없이 그 변수를 읽는다(`padding: 2rem var(--editor-padding)`)
    // — 그래서 기본값 4에서도 `toVars`가 `{"--editor-padding":"4rem"}`을
    // 내야 스타일시트가 오늘과 같은 값을 얻는다. 결함이 아니라 그 채널의
    // 설계다.
    "editorPadding",
    // `blocks.css`의 `.tiptap p { margin: var(--editor-paragraph-spacing,
    // 0.5em) 0; }` — fallback이 defaultValue(0.5)와 같은 값·같은 단위라서
    // `toVars(0.5)`가 내는 `"0.5em"`도 스타일시트의 기본과 똑같다(브리프
    // §368 Step 1: "문단 간격은 0.5em 이 이미 명시값이므로 그런 구분이
    // 없다"). 자간과 달리 `0` 같은 특수 취급이 필요 없다.
    "editorParagraphSpacing",
  ]);

  it("모든 다이얼의 기본값은 변수를 내지 않는다 (희소성, 위 셋 제외)", () => {
    for (const dial of DIALS) {
      if (SPARSE_AT_DEFAULT_EXCEPT.has(dial.id)) continue;
      expect(dial.toVars(dial.defaultValue)).toEqual({});
    }
  });
});

// Add-on B — `rebuildManifest`(theme-manifest.ts)는 `DIALS`를 돌며
// `source[dial.id]`를 찾아 `parse`에 넘긴다: 매니페스트가 그 다이얼을 선언하지
// 않았으면 `source[dial.id]`는 `undefined`다. `resolveDials`(merge.ts)도 같은
// 모양으로 `dial.parse(layer[id])`를 부른다. 이 둘이 "다이얼을 도는 것"과
// "입력의 키를 도는 것"이 행동적으로 같아지는 것은, 오직 어떤 다이얼도
// "키가 없다"를 "기본값을 쓰라"로 해석하지 않을 때뿐이다 — `dials.ts`의 문서
// 주석이 그 계약을 말한다("실패는 `undefined`이고, 그 층은 없었던 것으로
// 친다"). 이 테스트가 그 계약을 고정한다: 어긴 다이얼이 하나라도 생기면,
// 매니페스트가 선언하지 않은 값을 병합 결과에 몰래 끼워 넣는다.
describe("모든 다이얼의 parse(undefined) 는 undefined 다", () => {
  it.each(DIALS.map((d) => d.id))("%s", (id) => {
    const dial = DIALS.find((d) => d.id === id);
    expect(dial?.parse(undefined)).toBeUndefined();
  });
});

describe("숫자 다이얼의 저장분은 확장을 견딘다", () => {
  it("넓히기 전에 저장된 number 가 그대로 user 층으로 해석된다", () => {
    // 마이그레이션이 필요 없다는 판단의 근거. `DialValue` 는 `number` 의
    // 상위집합이므로 기존 저장분은 재해석 없이 통과한다 — 이 테스트가
    // 실패하면 store.ts 의 version 을 올리고 마이그레이션을 써야 한다.
    const resolved = resolveDials({}, { editorMaxWidth: 0, editorPadding: 6 });
    expect(resolved.editorMaxWidth).toEqual({ origin: "user", value: 0 });
    expect(resolved.editorPadding).toEqual({ origin: "user", value: 6 });
  });

  it("숫자 다이얼에 문자열이 들어오면 그 층은 말하지 않은 것이 된다", () => {
    const resolved = resolveDials({}, {
      editorMaxWidth: "1200px",
    } as Record<string, unknown>);
    expect(resolved.editorMaxWidth.origin).toBe("default");
  });
});

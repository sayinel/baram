// §368 Task 1 — 열거 다이얼이 가능해졌다는 것과, 그 확장이 저장분을 깨지 않는다는 것.
import { describe, expect, it } from "vitest";

import { DIALS } from "../dials";
import { resolveDials } from "../merge";

const CTX = { mode: "light", seeds: {} } as const;

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
    expect(lineBreak?.toVars("normal", CTX)).toEqual({});
  });

  it("vars 는 enum 다이얼에서 toVars 가 낼 수 있는 키를 전부 담는다", () => {
    // 되돌리기가 값을 남기지 않는다는 것의 구조적 확인 — enum 다이얼이 낼 수 있는
    // 모든 값(= options 전체)에 대해 검사한다. 경계: 이 루프는 kind === "enum" 만
    // 돈다. number 다이얼은 range 가 연속이라 "모든 값"을 열거할 수 없고, 그쪽은
    // `dials.test.ts` 의 경계 테스트(양 끝 min/max)가 대신 표본을 검사한다 —
    // 이 테스트 하나가 "다이얼이 낼 수 있는 모든 값"을 전부 덮는다고 읽으면 안 된다.
    // options 를 도는 것이 핵심이다: 한 값만 보면
    // keepAll 이 내는 둘 중 하나를 vars 에서 빠뜨려도 통과한다.
    for (const dial of DIALS) {
      if (dial.kind !== "enum") continue;
      for (const option of dial.options) {
        for (const key of Object.keys(dial.toVars(option, CTX))) {
          expect(dial.vars).toContain(key);
        }
      }
    }
  });
});

describe("채널", () => {
  // 무엇이 이것을 실패시키는가: `channel: "layout"` 인 다이얼이 `--color-*` 를
  // 선언하면 `applyDialVars` 가 그것을 쓰고, 테마 이펙트가 그 다음에 지운다 —
  // 사용자에게는 "설정이 안 먹는다" 로 보이고 어느 테스트도 빨개지지 않는다.
  // 반대 방향도 함께 고정한다: `channel: "color"` 인데 `--color-*` 를 하나도
  // 선언하지 않으면 그 다이얼은 아무 데서도 적용되지 않는다(양쪽이 건너뛴다).
  // ‼️ 갈래 판정도 `!== "layout"` 이다 — `applyDialVars`·`clearDialVars` 와 같은
  // 술어를 쓴다. 이 형태로 쓰인 원래 이유(§364 당시 `DIALS` 가 전부 layout 이라
  // `=== "color"` 가 TS2367 로 멎었다)는 §367 이 색 다이얼 둘을 들이면서 사라졌다.
  // 그 둘이 생긴 지금에야 아래 `if` 의 색 갈래가 처음으로 실제로 돈다.
  it("채널과 변수 접두가 일치한다", () => {
    for (const dial of DIALS) {
      const colorVars = dial.vars.filter((v) => v.startsWith("--color-"));
      if (dial.channel !== "layout") {
        expect(
          colorVars.length,
          `${dial.id} declares no --color-* var`,
        ).toBeGreaterThan(0);
        expect(colorVars, `${dial.id} mixes channels`).toEqual([...dial.vars]);
      } else {
        expect(
          colorVars,
          `${dial.id} is layout but declares --color-*`,
        ).toEqual([]);
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
  it.each(DIALS)("$id", (dial) => {
    expect(dial.parse(undefined)).toBeUndefined();
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

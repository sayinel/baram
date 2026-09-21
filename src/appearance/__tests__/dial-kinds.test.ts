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

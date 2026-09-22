import { describe, expect, it } from "vitest";

import { DIALS } from "../dials";
import { resolveDials } from "../merge";

describe("resolveDials", () => {
  it("falls back to the dial's default when no layer speaks", () => {
    const r = resolveDials({}, {});
    expect(r.editorMaxWidth).toEqual({ origin: "default", value: 800 });
    expect(r.editorPadding).toEqual({ origin: "default", value: 4 });
  });

  it("lets the theme layer win over the default", () => {
    const r = resolveDials({ editorMaxWidth: 1200 }, {});
    expect(r.editorMaxWidth).toEqual({ origin: "theme", value: 1200 });
  });

  it("lets the user layer win over the theme", () => {
    const r = resolveDials({ editorMaxWidth: 1200 }, { editorMaxWidth: 640 });
    expect(r.editorMaxWidth).toEqual({ origin: "user", value: 640 });
  });

  it("keeps the user's pin even when it equals the default", () => {
    // 무엇이 이것을 실패시키는가: "기본값과 같으면 사용자 층을 무시" 하는 최적화를
    // 넣으면, 테마가 1200 을 주는 동안 사용자가 800(기본)으로 고정한 의도가 사라져
    // 테마 값이 되살아난다. §366 의 "기본값으로 되돌리기" 가 정확히 이 경우다.
    const r = resolveDials({ editorMaxWidth: 1200 }, { editorMaxWidth: 800 });
    expect(r.editorMaxWidth).toEqual({ origin: "user", value: 800 });
  });

  it("skips a layer whose value fails the dial's parse", () => {
    const r = resolveDials(
      { editorMaxWidth: -5 } as never,
      { editorMaxWidth: Number.NaN } as never,
    );
    expect(r.editorMaxWidth).toEqual({ origin: "default", value: 800 });
  });

  it("ignores keys that are not dials", () => {
    // 저장분·매니페스트는 외부 입력이다. 결과는 DIALS 를 순회해 만들어지므로
    // 낯선 키는 결과에 자리가 없다. 기대값을 DIALS 에서 파생시키는 이유는
    // 다이얼이 늘 때마다(이 브랜치에서 세 번, 그 뒤 계획에서도 더) 이 배열을
    // 손으로 다시 옮겨 적는 것이 매번 그대로 베끼는 일이라서다 — 그래도
    // 공허하지 않다: 입력에는 여전히 다이얼이 아닌 `display` 키가 있으므로,
    // `resolveDials` 가 DIALS 대신 입력의 키를 돌면 `display` 가 결과에
    // 남아 DIALS 파생 목록과 어긋난다.
    const r = resolveDials({ display: "none" } as never, {});
    expect(Object.keys(r).sort()).toEqual(DIALS.map((d) => d.id).sort());
  });

  it("falls back to defaults when the theme layer is null", () => {
    // 무엇이 이것을 실패시키는가: 컨테이너를 값처럼 다뤄 `theme[id]`를 바로
    // 인덱싱하면, `null["editorMaxWidth"]`가 TypeError를 던진다. zustand의
    // 기본 얕은 병합이 persisted `"appearanceOverrides": null`을 그대로
    // state에 앉히므로(store.ts에 커스텀 merge:가 없다), 이 경로는 매 앱
    // 시작마다 도는 effect 안에서 실제로 일어난다.
    const r = resolveDials(null as never, {});
    expect(r.editorMaxWidth).toEqual({ origin: "default", value: 800 });
  });

  it("falls back to defaults when the user layer is null", () => {
    const r = resolveDials({}, null as never);
    expect(r.editorMaxWidth).toEqual({ origin: "default", value: 800 });
  });

  it("falls back to defaults when a layer is undefined", () => {
    // 무엇이 이것을 실패시키는가: undefined도 null과 같은 방식으로 인덱싱하면
    // 던진다 — 가드가 null만 잡고 undefined를 놓치면 이 케이스만 따로 깨진다.
    const r = resolveDials(undefined as never, undefined as never);
    expect(r.editorMaxWidth).toEqual({ origin: "default", value: 800 });
    expect(r.editorPadding).toEqual({ origin: "default", value: 4 });
  });

  it("treats a non-object layer as speaking for nothing", () => {
    // 무엇이 이것을 실패시키는가: 가드가 "null만" 걸러내고 "객체가 아니면"을
    // 놓치면, 문자열 층을 넘겨도 죽지는 않겠지만 (인덱싱이 undefined를 주므로)
    // 이 테스트는 그 관용을 규칙으로 고정한다 — 스칼라도 컨테이너 취급을
    // 받지 않는다는 것을 던짐 없이 보인다.
    const r = resolveDials("corrupt" as never, 42 as never);
    expect(r.editorMaxWidth).toEqual({ origin: "default", value: 800 });
    expect(r.editorPadding).toEqual({ origin: "default", value: 4 });
  });
});

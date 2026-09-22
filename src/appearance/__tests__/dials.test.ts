import type { DialValues } from "../dials";

import { describe, expect, it } from "vitest";

import { DIALS } from "../dials";

describe("DIALS", () => {
  it("has unique ids", () => {
    const ids = DIALS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares every variable its toVars can emit", () => {
    // 무엇이 이것을 실패시키는가: toVars 가 vars 에 없는 키를 내보내면, apply 는
    // 그것을 쓰지만 clear 는 지우지 못해 되돌려도 값이 남는다.
    for (const dial of DIALS) {
      const emitted = Object.keys(dial.toVars(dial.defaultValue));
      for (const key of emitted) expect(dial.vars).toContain(key);
    }
  });

  it("rejects values outside its range", () => {
    const width = DIALS.find((d) => d.id === "editorMaxWidth");
    expect(width?.parse(800)).toBe(800);
    expect(width?.parse(-1)).toBeUndefined();
    expect(width?.parse("800")).toBeUndefined();
    expect(width?.parse(Number.NaN)).toBeUndefined();
    expect(width?.parse(100_000)).toBeUndefined();
  });

  it("emits no variable when the width dial is unbounded", () => {
    // 0 = 무제한. 변수를 비워 두면 CSS 의 `none` fallback 이 지배한다.
    const width = DIALS.find((d) => d.id === "editorMaxWidth");
    expect(width?.toVars(0)).toEqual({});
    expect(width?.toVars(800)).toEqual({ "--editor-max-width": "800px" });
  });

  it("parses exactly the range the slider exposes", () => {
    // 무엇이 이것을 실패시키는가: parse 와 range 가 서로 다른 상수를 읽으면
    // 슬라이더 끝에서 값이 조용히 버려진다 — UI 는 움직이는데 저장은 안 된다.
    // §368: `range`는 숫자 다이얼만 갖는다 — 열거 다이얼은 여기서 건너뛴다.
    for (const dial of DIALS) {
      if (dial.kind !== "number") continue;
      expect(dial.parse(dial.range.min)).toBe(dial.range.min);
      expect(dial.parse(dial.range.max)).toBe(dial.range.max);
      expect(dial.parse(dial.range.min - dial.range.step)).toBeUndefined();
      expect(dial.parse(dial.range.max + dial.range.step)).toBeUndefined();
    }
  });

  it("emits the padding dial in rem, matching base.css's unit", () => {
    const pad = DIALS.find((d) => d.id === "editorPadding");
    expect(pad?.toVars(4)).toEqual({ "--editor-padding": "4rem" });
  });

  it("is keyed by dial ids and stays sparse", () => {
    // 무엇이 이것을 실패시키는가: DialValues 가 total `Record<DialId, number>` 로
    // 바뀌면 이 희소 리터럴이 타입 오류가 되어 파일이 컴파일되지 않는다. 희소성은
    // §364.2 의 불변식이다 — 사용자 층은 명시적으로 바꾼 다이얼만 담는다.
    const sparse: DialValues = { editorPadding: 2 };
    expect(Object.keys(sparse)).toEqual(["editorPadding"]);
    expect("editorMaxWidth" in sparse).toBe(false);
  });
});

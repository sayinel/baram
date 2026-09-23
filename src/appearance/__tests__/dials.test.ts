import type { DialValues } from "../dials";

import { describe, expect, it } from "vitest";

import { DIALS } from "../dials";

const CTX = { mode: "light", seeds: {} } as const;

describe("DIALS", () => {
  it("has unique ids", () => {
    const ids = DIALS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares every variable its toVars can emit", () => {
    // 무엇이 이것을 실패시키는가: toVars 가 vars 에 없는 키를 내보내면, apply 는
    // 그것을 쓰지만 clear 는 지우지 못해 되돌려도 값이 남는다.
    for (const dial of DIALS) {
      const emitted = Object.keys(dial.toVars(dial.defaultValue, CTX));
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
    expect(width?.toVars(0, CTX)).toEqual({});
    expect(width?.toVars(800, CTX)).toEqual({ "--editor-max-width": "800px" });
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
    expect(pad?.toVars(4, CTX)).toEqual({ "--editor-padding": "4rem" });
  });

  it("emits the list guide strength as a percentage, and emits it at zero", () => {
    // 무엇이 이것을 실패시키는가, 둘이다.
    //
    // 단위: `color-mix()` 의 비율 인자는 <percentage> 다. 맨 숫자 `22` 를 내보내면
    // 그 선언 전체가 무효가 되어 가이드가 통째로 사라진다 — 조용한 실패라서
    // 단위를 여기서 고정한다.
    //
    // 0 에서 **비우지 않는 것**: `editorMaxWidth` 는 0 을 "무제한" 으로 읽어 빈 맵을
    // 돌려주지만, 여기서 0 은 "배경색과 같은 색" 즉 끄기다. 빈 맵을 돌려주면
    // `lists.css` 의 fallback 22% 가 지배해서 끄기가 켜기가 된다.
    const guide = DIALS.find((d) => d.id === "editorListGuideStrength");
    expect(guide?.defaultValue).toBe(22);
    expect(guide?.toVars(22)).toEqual({ "--editor-guide-strength": "22%" });
    expect(guide?.toVars(0)).toEqual({ "--editor-guide-strength": "0%" });
  });

  it("emits a text-align only for the non-default marker alignment", () => {
    // §5.1 순서 있는 마커의 정렬 축. 무엇이 이것을 실패시키는가, 셋이다.
    //
    // ① 기본값이 `number` 가 아니게 되면 — `lists.css` 의 fallback 이 `left` 이고,
    //    기본 출처의 다이얼은 변수를 쓰지 않으므로(`apply.ts`) 둘이 갈리는 순간
    //    사용자가 select 를 처음 건드릴 때 화면이 튄다. 그 일치는
    //    `styles/__tests__/list-styling.test.ts` 가 두 파일을 함께 읽어 고정하고,
    //    여기서는 이쪽 절반을 고정한다.
    //
    // ② 값 이름(`number`/`period`)과 CSS 값(`left`/`right`)을 같은 것으로 쓰면,
    //    이름이 무엇을 정렬하는지가 아니라 어느 쪽으로 미는지를 말하게 된다 —
    //    그리고 `toVars` 가 항등함수가 되어 매핑이 있었다는 사실이 사라진다.
    //
    // ③ `number` 에서 빈 맵을 돌려주지 않으면 기본값이 인라인으로 굳어,
    //    테마가 이 다이얼로 말할 여지를 사용자 층 없이도 눌러 이긴다.
    const align = DIALS.find((d) => d.id === "editorOrderedMarkerAlign");
    // 이름이 바뀌면 아래 `?.` 단언들이 공허하게 통과할 수 있다 — 먼저 존재를 고정한다.
    expect(align).toBeDefined();
    expect(align?.defaultValue).toBe("number");
    expect(align?.toVars("number")).toEqual({});
    expect(align?.toVars("period")).toEqual({
      "--editor-ordered-marker-align": "right",
    });
    // CSS 값은 다이얼 값이 아니다 — 저장분에 `left` 가 있어도 그 층은 없었던 것이다.
    expect(align?.parse("left")).toBeUndefined();
    expect(align?.parse("period")).toBe("period");
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

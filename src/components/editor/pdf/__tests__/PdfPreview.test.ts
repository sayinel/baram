// §272 Fix round 1 — I1: registerPageEl must receive the wrapper's rendered
// CHILD (the real .pdf-page box), not the display:contents wrapper itself
// (which has no layout box, so getBoundingClientRect()/scrollIntoView() on
// it are always inert). jsdom returns zero rects for every element
// regardless of `display`, so the layout bug itself can't be observed here
// — this pins the DOM-tree-structure half of the fix instead.
import { describe, expect, it } from "vitest";

import { PDF_RAIL_DEFAULT_WIDTH_PX } from "../pdf-side-panel-utils";
import { availableFitWidth, resolvePageBoxEl } from "../PdfPreview";

describe("resolvePageBoxEl", () => {
  it("returns the wrapper's rendered child, not the (boxless) wrapper itself", () => {
    const wrapper = document.createElement("div");
    const pageBox = document.createElement("div");
    pageBox.className = "pdf-page";
    wrapper.append(pageBox);

    const resolved = resolvePageBoxEl(wrapper);

    expect(resolved).toBe(pageBox);
    expect(resolved).not.toBe(wrapper);
  });

  it("returns null when the wrapper has no rendered child yet", () => {
    expect(resolvePageBoxEl(document.createElement("div"))).toBeNull();
  });

  it("returns null when the wrapper itself is null (ref cleanup on unmount)", () => {
    expect(resolvePageBoxEl(null)).toBeNull();
  });
});

// §282 레일은 `.editor-area`에 붙는 오버레이라 스크롤 컨테이너의 clientWidth를
// 줄이지 않는다 — 이 함수가 그 사실을 보정하는 유일한 자리다. 보정이 빠지면
// zoom 100%에서도 페이지가 레일 폭만큼 넓어져 항상 가로 스크롤이 생긴다.
// jsdom에는 레이아웃이 없어 렌더로는 관찰할 수 없다(resolvePageBoxEl과 같은 이유).
describe("availableFitWidth", () => {
  const W = PDF_RAIL_DEFAULT_WIDTH_PX;

  it("subtracts the rail width while the rail is open", () => {
    const closed = availableFitWidth(1000, false, W);
    const open = availableFitWidth(1000, true, W);

    expect(closed - open).toBe(W);
  });

  // ‼️ §283 폭이 **인자**가 됐다. 상수를 계속 쓰면 "레일 폭을 빼기는 하는데
  // 넘겨받은 값이 아니라 기본값을 뺀다"는 회귀가 통과한다 — 드래그로 넓힌
  // 사용자에게는 zoom 100%에서 항상 가로 스크롤이 생기는 증상이다.
  it("subtracts the width it was given, not the default", () => {
    const wide = availableFitWidth(1000, true, 400);
    const narrow = availableFitWidth(1000, true, 140);

    expect(narrow - wide).toBe(260);
    expect(availableFitWidth(1000, true, 400)).not.toBe(
      availableFitWidth(1000, true, W),
    );
  });

  it("leaves the width untouched while the rail is closed", () => {
    // 게터 두 개(1000 → 952)가 아니라 gutter만 빠진 값이어야 한다 — 상수를
    // 되풀이하지 않고 "레일이 닫혔을 때는 레일 항이 0"임을 고정한다.
    expect(availableFitWidth(1000, false, W)).toBeGreaterThan(
      availableFitWidth(1000, true, W),
    );
    expect(availableFitWidth(1000, false, W)).toBeLessThan(1000);
  });

  // 레일이 닫혀 있으면 폭이 얼마든 결과가 같아야 한다.
  it("ignores the rail width entirely while the rail is closed", () => {
    expect(availableFitWidth(1000, false, 140)).toBe(
      availableFitWidth(1000, false, 400),
    );
  });

  // 레일이 열린 채로 창을 아주 좁히면 음수가 나온다. 호출부가 `avail > 0`으로
  // 거르므로 여기서 0으로 자르지 않는다 — 자르면 호출부의 가드가 통과해
  // baseScale이 0이 되고 페이지가 사라진다.
  it("reports a negative width when the rail cannot fit", () => {
    expect(availableFitWidth(W, true, W)).toBeLessThan(0);
  });
});

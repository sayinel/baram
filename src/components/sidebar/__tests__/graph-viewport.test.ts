// §286 그래프 뷰포트 기억.
//
// ‼️ 실측이 원인을 특정했다. 탭을 오갈 때 **노드는 움직이지 않고 카메라가 움직인다**:
//
//   MD-A → 그래프:  zoom=0.9033  pan=402.5,443.3   n0={"x":0,"y":0}
//   MD-B → 그래프:  zoom=0.9033  pan=407.0, 66.6   n0={"x":0,"y":0}
//   PDF  → 그래프:  zoom=1.0000  pan=  0.0,  0.0   n0={"x":0,"y":0}
//
// 마지막 줄은 cytoscape의 **초기 뷰포트**다 — 원점에서 원래 좌표로 그리니 노드가 구석에
// 뭉쳐 보인다. 그리고 그 값은 우리 `cy.resize()` **이전에** 이미 그렇다: 컨테이너가 0×0이
// 되면 cytoscape가 스스로 뷰포트를 흔들거나 되돌린다. 우리 게이트는 *우리* 호출만 막을 수
// 있고 라이브러리 내부 반응은 못 막는다.
//
// 그래서 §291과 같은 결론이다: 우리가 지킬 수 없는 상태는 **기억했다 되돌린다.**
import { describe, expect, it } from "vitest";

import { isUsableViewport, shouldRunViewportWork } from "../graph-viewport";

describe("shouldRunViewportWork", () => {
  it("is false while the surface is hidden", () => {
    expect(shouldRunViewportWork(false, { height: 800, width: 1200 })).toBe(
      false,
    );
  });

  it("is false when the container has no size, even if marked visible", () => {
    expect(shouldRunViewportWork(true, { height: 0, width: 0 })).toBe(false);
    expect(shouldRunViewportWork(true, { height: 800, width: 0 })).toBe(false);
    expect(shouldRunViewportWork(true, { height: 0, width: 1200 })).toBe(false);
  });

  it("is true only when visible with a real box", () => {
    expect(shouldRunViewportWork(true, { height: 800, width: 1200 })).toBe(
      true,
    );
  });

  it("treats a missing container as no box", () => {
    expect(shouldRunViewportWork(true, null)).toBe(false);
  });
});

describe("isUsableViewport", () => {
  it("accepts a camera the user actually placed", () => {
    expect(
      isUsableViewport({ pan: { x: 402.5, y: 443.3 }, zoom: 0.9033 }),
    ).toBe(true);
  });

  it("rejects cytoscape's untouched initial camera", () => {
    // zoom 1 / pan 0,0 is what a fresh instance reports — and what the measurement
    // showed after a PDF round trip. Remembering it would pin the broken view.
    expect(isUsableViewport({ pan: { x: 0, y: 0 }, zoom: 1 })).toBe(false);
  });

  it("rejects a degenerate zoom", () => {
    expect(isUsableViewport({ pan: { x: 10, y: 10 }, zoom: 0 })).toBe(false);
    expect(isUsableViewport({ pan: { x: 10, y: 10 }, zoom: -1 })).toBe(false);
  });

  it("accepts zoom 1 when the camera has been panned", () => {
    // Only the exact untouched pair is refused — a real 1.0 zoom is legitimate.
    expect(isUsableViewport({ pan: { x: 120, y: 0 }, zoom: 1 })).toBe(true);
  });

  it("rejects a non-finite camera", () => {
    expect(isUsableViewport({ pan: { x: Number.NaN, y: 0 }, zoom: 1 })).toBe(
      false,
    );
  });
});

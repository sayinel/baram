// §274.1 팝업 경계 물리기. 실제 보정은 getBoundingClientRect에 의존하고
// jsdom은 모든 rect를 0으로 주므로, 결정 로직만 여기서 고정한다.
import { describe, expect, it } from "vitest";

import { clampPopupToBounds, POPUP_EDGE_MARGIN } from "../pdf-popup-position";

// 창 1000×600, 팝업 250×40 — 실제 팝업(스와치 5개 + 액션 버튼)의 대략적 크기.
const bounds = { bottom: 600, left: 0, right: 1000, top: 0 };
const size = { height: 40, width: 250 };
const clamp = (left: number, top: number) =>
  clampPopupToBounds({ bounds, desired: { left, top }, size });

describe("clampPopupToBounds", () => {
  it("leaves a popup that already fits exactly where it was asked to go", () => {
    expect(clamp(300, 200)).toEqual({ left: 300, top: 200 });
  });

  it("pulls a popup back inside when it would overflow the right edge", () => {
    // 이것이 보고된 버그다: 선택이 페이지 오른쪽 끝에서 끝나면 앵커가 거의
    // 오른쪽 경계라 팝업 폭 전체가 창 밖으로 나간다.
    const { left } = clamp(900, 200);
    expect(left).toBe(1000 - POPUP_EDGE_MARGIN - 250);
    expect(left + size.width).toBeLessThanOrEqual(1000 - POPUP_EDGE_MARGIN);
  });

  it("pulls a popup back inside when it would overflow the bottom edge", () => {
    const { top } = clamp(300, 580);
    expect(top).toBe(600 - POPUP_EDGE_MARGIN - 40);
  });

  it("never places the popup past the left/top edge either", () => {
    expect(clamp(-50, -50)).toEqual({
      left: POPUP_EDGE_MARGIN,
      top: POPUP_EDGE_MARGIN,
    });
  });

  it("respects a non-zero bounds origin (the viewer pane, not the window)", () => {
    // PDF는 사이드바 오른쪽의 창(pane) 안에 산다 — 경계의 원점이 0이 아니다.
    const paneBounds = { bottom: 700, left: 300, right: 1200, top: 60 };
    const r = clampPopupToBounds({
      bounds: paneBounds,
      desired: { left: 1150, top: 690 },
      size,
    });
    expect(r.left).toBe(1200 - POPUP_EDGE_MARGIN - 250);
    expect(r.top).toBe(700 - POPUP_EDGE_MARGIN - 40);
    expect(r.left).toBeGreaterThanOrEqual(300 + POPUP_EDGE_MARGIN);
  });

  it("aligns to the start edge when the popup is wider than the bounds", () => {
    // 아주 좁은 창: 물릴 방법이 없다. 오른쪽으로 물리면 첫 컨트롤(색 스와치)이
    // 잘려 팝업이 쓸모없어지므로 왼쪽에 맞춘다.
    const narrow = { bottom: 600, left: 0, right: 100, top: 0 };
    const r = clampPopupToBounds({
      bounds: narrow,
      desired: { left: 50, top: 10 },
      size,
    });
    expect(r.left).toBe(POPUP_EDGE_MARGIN);
  });

  it("honours a caller-supplied margin", () => {
    const r = clampPopupToBounds({
      bounds,
      desired: { left: 900, top: 200 },
      margin: 20,
      size,
    });
    expect(r.left).toBe(1000 - 20 - 250);
  });

  it("clamps each axis independently — overflowing X must not move Y", () => {
    // 두 축을 하나의 분기로 묶은 구현은 이 케이스에서 어긋난다.
    expect(clamp(900, 200)).toEqual({ left: 742, top: 200 });
    expect(clamp(300, 580)).toEqual({ left: 300, top: 552 });
  });
});

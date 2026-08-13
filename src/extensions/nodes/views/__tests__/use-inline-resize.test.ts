import { describe, expect, it } from "vitest";

import { computeInlineResizePct } from "../use-inline-resize";
import { computeResizePct } from "../use-media-resize";

describe("computeInlineResizePct", () => {
  const W = 1000;
  const LEFT = 0;

  it("measures the width from the element's own left edge, never doubling it", () => {
    // ‼️ 이 파일의 이유. 300px 오른쪽으로 끌면 폭은 300px = 30%다.
    // 가운데 정렬 블록용 computeResizePct는 같은 입력에 60을 낸다 —
    // 인라인 참조에 그 식을 쓰면 폭이 두 배로 튄다.
    expect(computeInlineResizePct(300, LEFT, W)).toBe(30);
    expect(computeResizePct(300, LEFT, W)).toBe(60);
  });

  it("anchors to the element's left edge, not the container's", () => {
    // 참조가 문단 중간(200px)에서 시작해도 폭은 커서까지의 거리다.
    expect(computeInlineResizePct(500, 200, W)).toBe(30);
  });

  it("snaps to the nearest 10% within ±3%", () => {
    expect(computeInlineResizePct(570, LEFT, W)).toBe(60); // 57 → 60
    expect(computeInlineResizePct(530, LEFT, W)).toBe(50); // 53 → 50 (경계)
    expect(computeInlineResizePct(470, LEFT, W)).toBe(50); // 47 → 50 (경계)
  });

  it("leaves values outside the ±3% snap window untouched", () => {
    expect(computeInlineResizePct(540, LEFT, W)).toBe(54); // 50에서 4% → 그대로
    expect(computeInlineResizePct(660, LEFT, W)).toBe(66); // 70에서 4% → 그대로
  });

  it("clamps to a 10% minimum, including a cursor left of the anchor", () => {
    expect(computeInlineResizePct(LEFT, LEFT, W)).toBe(10); // 거리 0
    expect(computeInlineResizePct(50, LEFT, W)).toBe(10); // 5% → 10%
    expect(computeInlineResizePct(-400, LEFT, W)).toBe(10); // 음수 폭
  });

  it("clamps to a 100% maximum past the container's right edge", () => {
    expect(computeInlineResizePct(9999, LEFT, W)).toBe(100);
  });

  it("falls back to 100 for a zero-width or negative container", () => {
    expect(computeInlineResizePct(300, LEFT, 0)).toBe(100);
    expect(computeInlineResizePct(300, LEFT, -50)).toBe(100);
  });
});

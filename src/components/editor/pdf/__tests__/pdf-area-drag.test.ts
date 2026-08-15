import { describe, expect, it } from "vitest";

import {
  isMeaningfulDrag,
  localRectFromDragPoints,
  MIN_DRAG_SIZE_PX,
  rectFromDragPoints,
} from "../pdf-area-drag";
import { clientRectToPdf } from "../pdf-highlight-geom";

describe("rectFromDragPoints", () => {
  it("normalizes a down-right drag", () => {
    expect(rectFromDragPoints({ x: 10, y: 20 }, { x: 110, y: 70 })).toEqual({
      height: 50,
      left: 10,
      top: 20,
      width: 100,
    });
  });

  // §276.3 — 사용자가 어느 방향으로 드래그하든(위/아래/좌/우 뒤집혀도) 같은
  // 사각형이 나와야 한다. 4방향 전부를 개별 테스트로 고정한다 — Math.min/abs
  // 중 하나만 빠뜨려도(예: x만 정규화하고 y는 안 하는 뮤테이션) 이 중
  // 일부만 깨져서 잡힌다.
  it("normalizes an up-left drag to the identical rect", () => {
    expect(rectFromDragPoints({ x: 110, y: 70 }, { x: 10, y: 20 })).toEqual({
      height: 50,
      left: 10,
      top: 20,
      width: 100,
    });
  });

  it("normalizes an up-right drag", () => {
    expect(rectFromDragPoints({ x: 10, y: 70 }, { x: 110, y: 20 })).toEqual({
      height: 50,
      left: 10,
      top: 20,
      width: 100,
    });
  });

  it("normalizes a down-left drag", () => {
    expect(rectFromDragPoints({ x: 110, y: 20 }, { x: 10, y: 70 })).toEqual({
      height: 50,
      left: 10,
      top: 20,
      width: 100,
    });
  });

  it("collapses to a zero-size rect when both points coincide", () => {
    expect(rectFromDragPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      height: 0,
      left: 5,
      top: 5,
      width: 0,
    });
  });
});

describe("localRectFromDragPoints", () => {
  it("subtracts the page origin before normalizing", () => {
    const origin = { left: 40, top: 100 };
    expect(
      localRectFromDragPoints({ x: 50, y: 120 }, { x: 150, y: 170 }, origin),
    ).toEqual({ height: 50, left: 10, top: 20, width: 100 });
  });
});

describe("isMeaningfulDrag", () => {
  it("rejects a rect smaller than the threshold on both axes", () => {
    expect(
      isMeaningfulDrag({
        height: MIN_DRAG_SIZE_PX - 1,
        left: 0,
        top: 0,
        width: MIN_DRAG_SIZE_PX - 1,
      }),
    ).toBe(false);
  });

  it("accepts a rect at the threshold on the width axis alone", () => {
    expect(
      isMeaningfulDrag({ height: 0, left: 0, top: 0, width: MIN_DRAG_SIZE_PX }),
    ).toBe(true);
  });

  it("accepts a rect at the threshold on the height axis alone", () => {
    expect(
      isMeaningfulDrag({ height: MIN_DRAG_SIZE_PX, left: 0, top: 0, width: 0 }),
    ).toBe(true);
  });
});

// §276.3 "the rect produced by a drag converts correctly" — the full pipeline
// a real drag completion runs: two client points -> rectFromDragPoints ->
// clientRectToPdf (Task 6, already tested for its own round-trip identity).
// This pins that the composition itself is wired correctly, not clientRectToPdf
// itself.
describe("drag -> PDF rect pipeline", () => {
  it("converts a drag's two client points to the expected PDF rect", () => {
    const viewport = {
      convertToPdfPoint: (x: number, y: number) => [x / 2, y / 2],
      convertToViewportPoint: (x: number, y: number) => [x * 2, y * 2],
    };
    const pageOrigin = { left: 20, top: 30 };
    const clientRect = rectFromDragPoints({ x: 220, y: 230 }, { x: 20, y: 30 });

    const pdfRect = clientRectToPdf(clientRect, pageOrigin, viewport);

    // page-local = (0,0)-(200,200); /2 scale -> PDF rect (0,0,100,100)
    expect(pdfRect).toEqual({ h: 100, w: 100, x: 0, y: 0 });
  });
});

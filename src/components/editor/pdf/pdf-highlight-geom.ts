// §274 하이라이트 좌표 변환.
// 기하는 PDF user space(scale 1, 회전 미적용)에 저장한다 — 줌·리사이즈·
// 회전·devicePixelRatio 변화에 불변이기 때문이다.

export type DOMRectLike = {
  height: number;
  left: number;
  top: number;
  width: number;
};

/** PDF user space 사각형. */
export interface PdfRect {
  h: number;
  w: number;
  x: number;
  y: number;
}

/** pdfjs PageViewport에서 우리가 쓰는 부분만. */
export interface ViewportLike {
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

/**
 * 뷰포트 기준 client rect를 PDF user space로 변환한다.
 * pageOrigin은 .pdf-page의 getBoundingClientRect() — 페이지 로컬 좌표로
 * 만든 뒤 변환하므로 스크롤 위치와 CSS zoom 배율이 상쇄된다.
 */
export function clientRectToPdf(
  rect: DOMRectLike,
  pageOrigin: { left: number; top: number },
  viewport: ViewportLike,
): PdfRect {
  const x0 = rect.left - pageOrigin.left;
  const y0 = rect.top - pageOrigin.top;
  const [px0, py0] = viewport.convertToPdfPoint(x0, y0);
  const [px1, py1] = viewport.convertToPdfPoint(
    x0 + rect.width,
    y0 + rect.height,
  );

  // PDF는 y축이 위로 향하고 회전에서 축이 뒤바뀔 수 있다 —
  // 두 점 중 어느 쪽이 작은지 가정하지 않는다.
  return {
    h: Math.abs(py1 - py0),
    w: Math.abs(px1 - px0),
    x: Math.min(px0, px1),
    y: Math.min(py0, py1),
  };
}

/** PDF user space 사각형을 페이지 로컬 CSS 픽셀로 되돌린다. */
export function pdfRectToPageLocal(
  r: PdfRect,
  viewport: ViewportLike,
): { height: number; left: number; top: number; width: number } {
  const [vx0, vy0] = viewport.convertToViewportPoint(r.x, r.y);
  const [vx1, vy1] = viewport.convertToViewportPoint(r.x + r.w, r.y + r.h);

  return {
    height: Math.abs(vy1 - vy0),
    left: Math.min(vx0, vx1),
    top: Math.min(vy0, vy1),
    width: Math.abs(vx1 - vx0),
  };
}

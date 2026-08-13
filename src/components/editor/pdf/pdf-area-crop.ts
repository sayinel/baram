// §276.4 영역 하이라이트 프리뷰의 크롭 레이아웃 — 순수 기하만. pdfjs도
// React도 모른다(pdf-area-drag.ts와 같은 성격). PDF user space → 페이지
// 로컬 변환은 여기서 재구현하지 않는다 — pdfRectToPageLocal(Task 6,
// pdf-highlight-geom.ts)이 회전·축 뒤집힘을 이미 처리하므로 이 파일은 그
// 함수가 돌려준 "scale 1 페이지 로컬 사각형"만 입력으로 받는다.

/** computeAreaCropLayout의 결과 — 그대로 canvas와 getViewport에 넘긴다. */
export interface AreaCropLayout {
  /** 캔버스 픽셀 크기 (dpr 반영). */
  canvasHeight: number;
  canvasWidth: number;
  /** CSS 픽셀 표시 크기. */
  cssHeight: number;
  cssWidth: number;
  /** getViewport({ scale: renderScale, offsetX, offsetY })에 그대로 넘길 값. */
  offsetX: number;
  offsetY: number;
  renderScale: number;
}

export interface AreaCropLayoutInput {
  /** window.devicePixelRatio — [1, 2]로 클램프된다(메모리 상한). */
  dpr: number;
  /** 표시 폭 상한(CSS px). 넘으면 비율을 유지하며 축소한다. */
  maxCssWidth: number;
  /** pdfRectToPageLocal(rect, page.getViewport({ scale: 1 }))의 결과. */
  pageLocalAtScale1: PageLocalRect;
}

/** pdfRectToPageLocal이 돌려주는 페이지 로컬 CSS 픽셀 사각형. */
export interface PageLocalRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

/**
 * 영역 하이라이트 하나를 잘라 그리기 위한 캔버스 크기 · 렌더 스케일 ·
 * 뷰포트 오프셋을 계산한다. 입력이 그릴 수 없는 값이면 null (호출부는 글자
 * 칩으로 떨어진다).
 *
 * offsetX/offsetY의 부호가 음수인 이유: pdfjs PageViewport는 offsetX/offsetY를
 * **이미 스케일된** 뷰포트 공간에서 translation에 그대로 더한다
 * (pdf.mjs의 `offsetCanvasX = |centerX - viewBox[0]| * scale + offsetX`, 그
 * 값이 transform[4]에 들어간다). scale s의 뷰포트는 offset 0일 때 scale 1
 * 뷰포트의 정확히 s배이므로(회전·userUnit 포함 — 두 뷰포트가 같은 인자를
 * 공유한다), 크롭 좌상단 (left, top)을 캔버스 원점으로 옮기려면
 * `renderScale * left + offsetX = 0` ⇒ `offsetX = -left * renderScale`이다.
 *
 * ‼️ 유한성 검사에 `typeof x === "number"`를 쓰지 말 것 — NaN을 통과시킨다.
 * 사이드카 검증기(isPdfRect, pdf-highlight-sidecar.ts:110-117)가 바로 그
 * 검사를 쓰고 있어 NaN 좌표가 실제로 여기까지 도달할 수 있다.
 */
export function computeAreaCropLayout({
  dpr,
  maxCssWidth,
  pageLocalAtScale1,
}: AreaCropLayoutInput): AreaCropLayout | null {
  const { height, left, top, width } = pageLocalAtScale1;

  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  if (!Number.isFinite(width) || width <= 0) return null;
  if (!Number.isFinite(height) || height <= 0) return null;
  if (!Number.isFinite(maxCssWidth) || maxCssWidth <= 0) return null;

  // NaN dpr은 clamp를 그대로 통과한다(Math.max(NaN, 1) === NaN) — 클램프
  // **전에** 걸러야 캔버스 크기가 NaN이 되지 않는다.
  const clampedDpr = Number.isFinite(dpr) ? Math.min(Math.max(dpr, 1), 2) : 1;

  // 축소만 한다 — 작은 영역을 늘리면 흐려지기만 한다.
  const shrink = Math.min(1, maxCssWidth / width);
  const cssWidth = width * shrink;
  const cssHeight = height * shrink;
  const renderScale = shrink * clampedDpr;

  return {
    // 0폭/0높이 캔버스는 pdfjs가 던진다 — 반올림이 0으로 떨어져도 1은 남긴다.
    canvasHeight: Math.max(1, Math.round(height * renderScale)),
    canvasWidth: Math.max(1, Math.round(width * renderScale)),
    cssHeight,
    cssWidth,
    offsetX: -left * renderScale,
    offsetY: -top * renderScale,
    renderScale,
  };
}

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

/**
 * §274 UX fix (defect 2) — 같은 시각적 줄에 속한 client rect들을 하나로
 * 합친다. pdfjs TextLayer는 텍스트 콘텐트 아이템(보통 한 줄 전체가 아니라
 * PDF Tj/TJ 런 하나)마다 별도의 절대 위치 span을 만든다 — Range가 두 아이템
 * 이상에 걸치면 getClientRects()는 아이템(fragment)당 rect 하나씩 돌려주고,
 * 아이템 사이 여백(단어/컬럼 간격)은 어느 쪽 rect에도 안 속해 구멍으로
 * 남는다. pdfjs 자신도 같은 문제를 겪는다 — 하이라이트 주석 캡처
 * (getSelectionBoxes, pdf.mjs)가 똑같이 원시 getClientRects()를 받아
 * HighlightOutliner로 합치는 것과 같은 이유다. 여기서는 그 정도의 범용
 * 폴리곤 합집합까지는 필요 없다(회전/다열 선택 지원 없이도 충분하다) —
 * 세로로 겹치는 rect들을 하나의 스팬 사각형으로 묶는 것으로 충분하다.
 *
 * "같은 줄"의 정의는 수직 겹침(한쪽의 수직 중심이 다른 쪽의 [top, bottom]
 * 안에 들어가는지)이다 — top/height의 정확한 일치를 요구하면 위첨자·각주
 * 표기처럼 폰트 크기가 살짝 다른 아이템이 한 줄에서도 안 합쳐진다.
 *
 * 알려진 한계: 2열 레이아웃에서 두 열이 우연히 같은 화면 y에 걸리는
 * 드래그는(흔치 않다) 그 사이 여백까지 하나의 rect로 합쳐 칠할 수 있다 —
 * 이 함수는 브리프가 명시한 "같은 줄" 병합만 다루고, 다열 감지는 범위 밖.
 */
export function mergeRectsByLine(rects: readonly DOMRectLike[]): DOMRectLike[] {
  if (rects.length === 0) return [];

  const sorted = [...rects].sort((a, b) => a.top - b.top);
  const lines: DOMRectLike[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    const line = lines[lines.length - 1];
    if (verticallyOverlaps(r, line)) {
      const top = Math.min(line.top, r.top);
      const bottom = Math.max(line.top + line.height, r.top + r.height);
      const left = Math.min(line.left, r.left);
      const right = Math.max(line.left + line.width, r.left + r.width);
      lines[lines.length - 1] = {
        height: bottom - top,
        left,
        top,
        width: right - left,
      };
    } else {
      lines.push(r);
    }
  }

  return lines;
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

function verticallyOverlaps(a: DOMRectLike, b: DOMRectLike): boolean {
  const aCenter = a.top + a.height / 2;
  const bCenter = b.top + b.height / 2;
  return (
    (aCenter >= b.top && aCenter <= b.top + b.height) ||
    (bCenter >= a.top && bCenter <= a.top + a.height)
  );
}

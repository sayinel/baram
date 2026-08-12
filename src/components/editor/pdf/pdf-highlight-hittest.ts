// §274 하이라이트 히트 테스트 — 클릭 좌표가 저장된 rect들과 겹치는지, 그리고
// DOM 노드가 어느 페이지에 속하는지 판정한다. 둘 다 순수 함수로 남긴다:
// hitTestRects는 viewport를 몰라야 하고(변환은 pdf-highlight-geom.ts 몫),
// findPageForNode는 pdfjs를 몰라야 유닛 테스트가 가능하다.
import type { PdfRect } from "./pdf-highlight-geom";

/**
 * node를 포함하는 .pdf-page 엘리먼트를 찾아 페이지 번호와 함께 돌려준다.
 * 없으면 null.
 *
 * PdfPreview.tsx의 페이지 wrapper는 `display:contents`라 getBoundingClientRect
 * 등 기하 연산에는 쓸 수 없지만(resolvePageBoxEl 주석 참조), Node.contains()는
 * display와 무관하게 DOM 트리만 본다 — 이미 실 박스 엘리먼트로 등록된 맵을
 * 순회하면 그 문제를 아예 피해간다.
 */
export function findPageForNode(
  pageEls: Map<number, HTMLElement>,
  node: Node | null,
): null | { el: HTMLElement; pageNumber: number } {
  if (!node) return null;
  for (const [pageNumber, el] of pageEls) {
    if (el.contains(node)) return { el, pageNumber };
  }
  return null;
}

/**
 * point가 rects 중 하나에라도 들어가면 true. 각 rect는 [x, x+w] × [y, y+h]
 * 사각형으로 본다 (PdfRect.w/h는 항상 0 이상 — clientRectToPdf가 Math.abs로
 * 보장한다).
 *
 * 경계는 포함(inclusive)한다 — 하이라이트 가장자리를 정확히 클릭한 경우를
 * 놓치지 않기 위해서다. 인접한 두 하이라이트가 경계를 공유하면 클릭 하나가
 * 둘 다 맞힐 수 있다는 뜻인데, 호출부는 첫 매치를 쓰므로 실사용에서 체감되는
 * 폭은 1px 미만이다.
 */
export function hitTestRects(
  rects: PdfRect[],
  point: { x: number; y: number },
): boolean {
  return rects.some(
    (r) =>
      point.x >= r.x &&
      point.x <= r.x + r.w &&
      point.y >= r.y &&
      point.y <= r.y + r.h,
  );
}

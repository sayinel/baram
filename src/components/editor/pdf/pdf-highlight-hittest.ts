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
 * 둘 다 맞힐 수 있다는 뜻인데, 호출부(hitTestTopmost)는 겹치는 후보 중
 * 가장 위(배열 마지막)를 쓰므로 실사용에서 체감되는 폭은 1px 미만이다.
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

/**
 * point를 맞히는 항목들 중 배열에서 가장 나중(마지막)에 오는 것을 돌려준다.
 * 없으면 null.
 *
 * ‼️불변식: PdfPage.tsx는 highlights 배열을 정렬 없이 그대로
 * `.map()`해 그리므로, 배열에서 나중 항목일수록 나중에 그려져 시각적으로
 * 위에 쌓인다(같은 stacking context, z-index:auto — DOM 순서가 곧 페인트
 * 순서). 사이드카는 하이라이트를 생성 순서로 append하므로(pdf-highlight-
 * actions.ts) "배열 마지막 = 가장 최근 생성 = 화면에서 맨 위"가 성립한다.
 * 히트 테스트가 이 순서를 거꾸로 훑는 이유가 그것이다 — 겹친 두 하이라이트를
 * 클릭하면 눈에 보이는(맨 위) 것이 선택돼야 하기 때문이다(§274 겹침 버그).
 *
 * 이 함수를 첫 매치로 바꾸면 안 된다: 화면에 보이는 것과 클릭되는 것이
 * 다시 어긋난다. 반대로 PdfPage.tsx의 페인트 순서가 바뀌면(예: 색상별
 * 정렬) 이 함수도 그 순서에 맞춰 같이 바꿔야 한다 — pdf-page.test.tsx의
 * "paints in array order" 테스트와 이 파일의 "returns the last match"
 * 테스트가 한 쌍으로 그 관계를 고정한다.
 */
export function hitTestTopmost<T extends { rects: PdfRect[] }>(
  highlights: T[],
  point: { x: number; y: number },
): null | T {
  for (let i = highlights.length - 1; i >= 0; i--) {
    const h = highlights[i];
    if (h && hitTestRects(h.rects, point)) return h;
  }
  return null;
}

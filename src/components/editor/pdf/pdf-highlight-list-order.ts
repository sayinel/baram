// §282.2 하이라이트 목록의 순서와 기하 — 순수 함수만. pdfjs도 React도 모른다
// (pdf-area-crop.ts와 같은 성격).
import type { PdfRect, ViewportLike } from "./pdf-highlight-geom";
import type { StoredHighlight } from "./pdf-highlight-sidecar";

import { pdfRectToPageLocal } from "./pdf-highlight-geom";

/**
 * 하이라이트 하나의 rect들을 감싸는 최소 사각형(PDF user space).
 *
 * 텍스트 하이라이트는 줄마다 rect가 하나씩이라 여러 개다 — 정렬에 쓸 "이
 * 하이라이트의 위치"는 그 전체를 감싼 상자여야 한다. 영역 크롭도 같은 상자를
 * 쓴다(드래그는 보통 rect 하나지만, 하나를 가정할 이유가 없다).
 *
 * 빈 배열은 null. 사이드카 검증기가 `rects.length > 0`을 요구하므로
 * (pdf-highlight-sidecar.ts) 정상 경로에서는 오지 않지만, 이 함수가 그 검증을
 * 신뢰해 빈 배열에 -Infinity 상자를 돌려주면 정렬이 조용히 뒤집힌다.
 */
export function boundingPdfRect(rects: PdfRect[]): null | PdfRect {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { h: maxY - minY, w: maxX - minX, x: minX, y: minY };
}

/**
 * 목록에 보여줄 순서 — **읽는 순서**다. 사이드카는 생성 순서로 쌓이므로
 * 그대로 쓰면 "3페이지, 1페이지, 3페이지"처럼 나온다.
 *
 * ‼️ 정렬 기준은 PDF user space가 아니라 **뷰포트 공간**이다. 저장된 기하는
 * 일부러 회전 독립적이라(§274 — `getViewport`가 `page.rotate`를 적용하고
 * `convertToPdfPoint`가 그것을 되돌린다), `/Rotate 90` 페이지에서는 화면의
 * 위→아래 방향이 user space의 **다른 축**이다. user space의 y로 정렬하면 그런
 * 페이지에서 목록이 화면상 좌→우(또는 우→좌) 순서로 나온다.
 *
 * 뷰포트로 옮기면 그 문제가 사라지는 동시에 y축 함정도 함께 사라진다 —
 * pdfRectToPageLocal이 돌려주는 `top`은 이미 화면 좌표계(아래로 증가)라
 * **오름차순**이 곧 위에서 아래다. user space에서 직접 비교하려면 y가 위로
 * 증가하고 저장된 y가 아래 모서리라는 두 사실을 동시에 붙들어야 했다.
 *
 * 같은 줄에 나란한 두 하이라이트는 top이 같을 수 있어 left 오름차순을 마지막
 * 기준으로 둔다 — 없으면 정렬이 불안정해 리렌더마다 순서가 흔들린다.
 *
 * `getViewport`가 그 페이지에 null을 주면(프록시가 아직 로드 전) 페이지 번호만
 * 으로 정렬한다 — 페이지 내 순서만 잠깐 흔들리고, 프록시가 도착하면 바로잡힌다.
 */
export function sortHighlightsForList(
  highlights: StoredHighlight[],
  getViewport: (pageNumber: number) => null | ViewportLike,
): StoredHighlight[] {
  const anchors = new Map<string, { left: number; top: number }>();
  for (const h of highlights) {
    const bounds = boundingPdfRect(h.rects);
    const viewport = getViewport(h.page);
    if (!bounds || !viewport) continue;
    const local = pdfRectToPageLocal(bounds, viewport);
    anchors.set(h.id, { left: local.left, top: local.top });
  }

  return [...highlights].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    const pa = anchors.get(a.id);
    const pb = anchors.get(b.id);
    if (!pa || !pb) return 0;
    if (pa.top !== pb.top) return pa.top - pb.top;
    return pa.left - pb.left;
  });
}

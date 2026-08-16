// §282.2 하이라이트 목록의 순서와 기하 — 순수 함수만. pdfjs도 React도 모른다
// (pdf-area-crop.ts와 같은 성격).
import type { PdfRect } from "./pdf-highlight-geom";
import type { StoredHighlight } from "./pdf-highlight-sidecar";

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
 * ‼️ 함정은 y축이다. PDF user space는 y가 **위로** 증가하고, 저장된 `y`는
 * 사각형의 아래 모서리다(clientRectToPdf가 Math.min으로 잡는다,
 * pdf-highlight-geom.ts). 그래서 페이지 위쪽에 있는 하이라이트일수록 y가
 * **크다** — y 오름차순으로 정렬하면 페이지마다 정확히 역순이 된다. 위 모서리
 * (`y + h`)를 내림차순으로 본다.
 *
 * 같은 줄에 나란한 두 하이라이트는 위 모서리가 같을 수 있어 x 오름차순을
 * 마지막 기준으로 둔다 — 없으면 정렬이 불안정해 리렌더마다 순서가 흔들린다.
 */
export function sortHighlightsForList(
  highlights: StoredHighlight[],
): StoredHighlight[] {
  return [...highlights].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    const ba = boundingPdfRect(a.rects);
    const bb = boundingPdfRect(b.rects);
    if (!ba || !bb) return 0;
    const topA = ba.y + ba.h;
    const topB = bb.y + bb.h;
    if (topA !== topB) return topB - topA;
    return ba.x - bb.x;
  });
}

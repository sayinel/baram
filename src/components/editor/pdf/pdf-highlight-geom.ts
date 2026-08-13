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
 * §274 UX fix round 2 (defect A) — 그 관대함이 부작용을 낳는다: 문단 사이에
 * 빈 줄 간격이 없는 문서(줄 간격만으로 문단을 구분하는 논문 조판이 흔하다)나
 * 폰트의 ascent/descent 메트릭이 실제 행간보다 넉넉한 경우, 서로 다른 두
 * "온전한 줄"의 rect가 수직으로 겹쳐 같은 줄로 오판될 수 있다 — 문단 경계를
 * 건너 드래그할 때 하이라이트가 그 사이 공백까지 삼키며 "위로 튀는" 것으로
 * 보이는 원인이 이것이다(측정 근거는 selection-ux-fix-2-report.md 참조).
 * 위첨자처럼 진짜 같은 줄인 조각들은 좌우로 나란히 놓여 x축이 거의 겹치지
 * 않는 반면, 서로 다른 온전한 두 줄은(같은 문단 컬럼을 공유하므로) 보통 x축
 * 대부분이 겹친다 — 그래서 수직 겹침에 더해 "x축이 상당히 겹치지는 않아야
 * 한다"는 조건을 추가로 요구한다. 위첨자 케이스의 관대한 수직 임계값 자체는
 * 건드리지 않는다 — 건드리면 그 케이스가 깨질 위험이 있고, x축 조건은 이미
 * 이 파일의 모든 정당한 병합 픽스처가 만족하는 독립적인 성질이라 더 안전하다.
 *
 * x축 조건은 이미 병합된 그룹의 "합쳐진 bbox"가 아니라 그룹에 속한 **개별
 * 원본 rect들 각각**을 상대로 검사한다 — 처음엔 bbox를 썼더니 기존 회귀
 * 테스트가 깨졌다: 같은 줄의 단어 3개(a·b·c, 좌우로 나란히 겹치지 않음)를
 * a, c부터 합친 뒤 bbox가 이미 a와 c 사이 전체 폭을 덮게 되면, 그 사이에
 * 얌전히 들어맞는 b가 (어느 원본 조각과도 안 겹치는데도) bbox 안에 "포함"돼
 * 있다는 이유만으로 x축 조건에 걸려 잘못 분리됐다. 원본 조각들을 각각
 * 비교하면 이 문제가 없다.
 *
 * 알려진 한계: 2열 레이아웃에서 두 열이 우연히 같은 화면 y에 걸리는
 * 드래그는(흔치 않다) 그 사이 여백까지 하나의 rect로 합쳐 칠할 수 있다 —
 * 두 컬럼은 정의상 x축이 겹치지 않으므로 위 x축 조건은 이 케이스를 막지
 * 못한다. 이 함수는 브리프가 명시한 "같은 줄" 병합만 다루고, 다열 감지는
 * 범위 밖.
 */
export function mergeRectsByLine(rects: readonly DOMRectLike[]): DOMRectLike[] {
  if (rects.length === 0) return [];

  const sorted = [...rects].sort((a, b) => a.top - b.top);
  // 각 그룹은 "같은 줄"로 판정된 원본 rect들의 목록이다 — x축 검사가 이미
  // 합쳐진 bbox가 아니라 각 원본을 상대로 이뤄져야 하므로(위 doc comment),
  // 병합된 bbox 하나로 접어버리지 않고 끝까지 들고 있는다.
  const groups: DOMRectLike[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    const group = groups[groups.length - 1];
    const bbox = boundingBoxOf(group);
    // 수직 겹침은 bbox(합쳐진 범위) 기준으로 봐도 안전하다 — 두 rect가
    // verticallyOverlaps를 만족한다는 것은 실제로 좌표 하나를 공유한다는
    // 뜻이라(둘 중 한쪽의 중심이 다른 쪽 범위 안에 있음) 합집합은 항상 그
    // 둘로 완전히 덮이고 구멍이 없다 — 그래서 셋째 rect를 이 bbox에 대고
    // 검사한 결과는 "원본 rect들 중 하나에 대고 검사한 것"과 항상 같다
    // (selection-ux-fix-2-report.md의 반증 참조, 케스케이드 가설은 여기서
    // 나왔다가 기각됐다). x축은 이 성질이 성립하지 않아 원본별로 검사한다.
    const overlapsVertically = verticallyOverlaps(r, bbox);
    const overlapsHorizontally = group.some((member) =>
      overlapsHorizontallyTooMuch(r, member),
    );
    if (overlapsVertically && !overlapsHorizontally) {
      group.push(r);
    } else {
      groups.push([r]);
    }
  }

  return groups.map(boundingBoxOf);
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

function boundingBoxOf(group: readonly DOMRectLike[]): DOMRectLike {
  const top = Math.min(...group.map((r) => r.top));
  const bottom = Math.max(...group.map((r) => r.top + r.height));
  const left = Math.min(...group.map((r) => r.left));
  const right = Math.max(...group.map((r) => r.left + r.width));
  return { height: bottom - top, left, top, width: right - left };
}

function verticallyOverlaps(a: DOMRectLike, b: DOMRectLike): boolean {
  const aCenter = a.top + a.height / 2;
  const bCenter = b.top + b.height / 2;
  return (
    (aCenter >= b.top && aCenter <= b.top + b.height) ||
    (bCenter >= a.top && bCenter <= a.top + a.height)
  );
}

/** §274 UX fix round 2 (defect A) — 겹치는 x 구간이 더 좁은 rect 폭의 이
 * 비율 이상이면 "같은 줄 후보"에서 제외한다. 같은 줄의 서로 다른 텍스트
 * 조각(단어/위첨자)은 나란히 놓여 x축이 거의 안 겹치는 반면, 서로 다른 두
 * 온전한 줄은 보통 같은 문단 컬럼을 공유해 폭 대부분이 겹친다 — 이 값
 * 이상이면 "같은 줄의 조각"이 아니라 "위아래로 쌓인 별개의 줄"로 본다. */
const HORIZONTAL_OVERLAP_MERGE_LIMIT = 0.5;

function overlapsHorizontallyTooMuch(a: DOMRectLike, b: DOMRectLike): boolean {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const overlap = Math.max(0, right - left);
  const minWidth = Math.min(a.width, b.width);
  if (minWidth <= 0) return false;
  return overlap / minWidth >= HORIZONTAL_OVERLAP_MERGE_LIMIT;
}

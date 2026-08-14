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

/**
 * §276.6 백킹 이미지를 그릴 **목표 표시 폭**(CSS px). 표시 크기(cssWidth)와는
 * 다른 질문이다.
 *
 * 참조별 리사이즈가 생기면서 크롭은 자연 크기보다 크게 표시될 수 있는데,
 * 확대는 CSS가 같은 비트맵을 늘리는 것뿐이다. 예전 렌더 스케일은
 * `shrink * dpr`이었고 `shrink ≤ 1`이라 백킹은 **절대 자연 크기를 넘지
 * 않았다** — US Letter 페이지가 612pt이므로 사실상 모든 크롭이 640 상한 아래고,
 * 즉 자연 크기 위 구간(이 기능이 존재하는 이유의 절반)이 전부 흐렸다.
 * 400pt 그림은 dpr 2에서 800 device px로 그려지는데 700 CSS px 컬럼의 100%는
 * ~1400을 필요로 한다.
 *
 * pdfjs는 벡터를 요청한 스케일로 래스터화하므로, 도달 가능한 최대 표시 폭에
 * 맞춰 **한 번** 그려 두면 보간이 아니라 진짜로 선명하다. 드래그마다 다시
 * 그리는 것은 여전히 금지다(§276.6 비-범위) — 이건 렌더 1회의 예산이다.
 */
export const AREA_RENDER_TARGET_CSS_WIDTH = 900;

/**
 * 캔버스 픽셀 총량 상한(device px).
 *
 * ‼️ 폭이 아니라 **면적**으로 건다. 좁고 긴 크롭(50×700pt짜리 세로 막대)을
 * 900px 목표로 올리면 18배 스케일이 되어 ~11M 픽셀 — 한 참조가 40MB 넘는
 * 캔버스를 잡는다. 면적 예산은 종횡비와 무관하게 그 폭발을 막는다.
 */
export const MAX_AREA_CANVAS_PIXELS = 4_000_000;

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
 * ‼️ 유한성 검사는 반드시 `Number.isFinite`로 한다 — `typeof x === "number"`는
 * NaN도 Infinity도 통과시킨다. 실제 도달 경로(측정으로 확인):
 *   1. JSON에는 NaN 리터럴이 없으므로 사이드카가 NaN을 **직접** 담을 수는
 *      없다. 대신 `1e400` 같이 배정밀도를 넘는 리터럴이 `JSON.parse`에서
 *      `Infinity`가 된다.
 *   2. 사이드카 검증기 isPdfRect(pdf-highlight-sidecar.ts:108-117, typeof
 *      검사는 112-115행)는 `typeof === "number"`만 보므로 그 Infinity를
 *      그대로 통과시킨다.
 *   3. pdfjs `convertToViewportPoint`는 `p0*m[0] + p1*m[2] + m[4]`를 계산하는데
 *      (Util.applyTransform, pdf.mjs:6598-6603), 90도 배수 회전 행렬은 m[0..3]에
 *      항상 0이 두 개 있다 — 그래서 `0 * Infinity`가 나와 **회전 각도와 무관하게**
 *      (0/90/180/270 전부에서 확인) 결과 성분 하나가 NaN, 다른 하나가 ±Infinity가
 *      된다.
 * 즉 여기 도착하는 것은 NaN과 Infinity가 섞인 값이고, 둘 다 걸러야 한다.
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

  // 표시 크기는 축소만 한다 — 기본 표시 크기는 §276.4 그대로다.
  const shrink = Math.min(1, maxCssWidth / width);
  const cssWidth = width * shrink;
  const cssHeight = height * shrink;

  // 백킹 해상도는 표시 크기를 따르지 않는다(§276.6, 위 상수 참조).
  const renderScale = fitToCanvasArea(
    width,
    height,
    (AREA_RENDER_TARGET_CSS_WIDTH / width) * clampedDpr,
  );

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

/**
 * `scale`을 그대로 쓰되, 캔버스 면적이 예산을 넘으면 예산에 **딱 맞는**
 * 스케일로 낮춘다. 면적은 스케일의 제곱이므로 예산 스케일은
 * `sqrt(예산 / (width * height))`이다 — 곱셈 형태(`scale * sqrt(예산/면적)`)와
 * 값은 같지만 이 형태는 중간값이 Infinity로 넘치지 않는다(극단적 종횡비에서
 * `면적`이 넘치면 곱셈 쪽은 스케일 0을 돌려준다).
 *
 * 이 상한이 낮추는 유일한 실제 경우는 폭보다 2.4배 이상 긴 크롭인데, 그런
 * 크롭은 **예전 코드에서도** 예산을 넘는 캔버스를 잡고 있었다(640×2000 CSS px
 * 크롭 = dpr 2에서 5.1M px). 표시 크기는 어느 쪽이든 바뀌지 않는다.
 */
function fitToCanvasArea(width: number, height: number, scale: number): number {
  if (width * height * scale * scale <= MAX_AREA_CANVAS_PIXELS) return scale;
  return Math.sqrt(MAX_AREA_CANVAS_PIXELS / (width * height));
}

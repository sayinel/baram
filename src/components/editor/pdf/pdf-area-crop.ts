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
  /**
   * §282.2 백킹 해상도를 그릴 목표 표시 폭(CSS px). 기본값은
   * AREA_RENDER_TARGET_CSS_WIDTH(900) — 노트에 박힌 참조는 **리사이즈로 커질
   * 수 있어서** 도달 가능한 최대 폭에 맞춰 미리 그려 둬야 하기 때문이다
   * (§276.6, 그 상수의 doc comment).
   *
   * 레일의 하이라이트 목록은 그 전제가 성립하지 않는다 — 크기가 레일 폭으로
   * 고정이라 확대될 일이 없다. 900을 그대로 쓰면 150px 자리에 ~11배 픽셀을
   * 그리게 되므로 표시 폭을 그대로 넘긴다. 오프셋 유도(`-left * renderScale`)를
   * 복제하지 않으려고 파라미터로 열었다 — 그 계산이 이 파일의 어려운 부분이고,
   * 두 벌이 되면 한쪽만 고쳐지는 종류의 코드다.
   */
  renderTargetCssWidth?: number;
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
 * 캔버스를 잡는다. 면적 예산은 그 폭발을 종횡비와 무관하게 막는다(축별 1px
 * 바닥이 면적을 되살리는 구멍은 canvasSize가 막는다 — 그쪽 주석 참조).
 *
 * **이 상한이 무는 지점은 흔하다.** dpr 2에서 `h/w > 1.235`면 걸린다
 * (`MAX / (900² · dpr²)`) — 즉 세로가 가로의 1.24배만 넘어도 목표 900px에
 * 도달하지 못한다. 300×900pt 크롭은 canvasW 1155를 받는데, 700 CSS px 컬럼의
 * 100%는 1400을 원한다. 여전히 예전(600)보다 훨씬 낫지만 완전히 선명하지는
 * 않다 — 알려진 한계이고, 예산을 올리지 않는 이유는 메모리다(항목당 4M px는
 * 이미 디코드 15.26MB, base64 최대 12.43MB다).
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
  renderTargetCssWidth = AREA_RENDER_TARGET_CSS_WIDTH,
}: AreaCropLayoutInput): AreaCropLayout | null {
  const { height, left, top, width } = pageLocalAtScale1;

  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  if (!Number.isFinite(width) || width <= 0) return null;
  if (!Number.isFinite(height) || height <= 0) return null;
  if (!Number.isFinite(maxCssWidth) || maxCssWidth <= 0) return null;
  // maxCssWidth와 같은 이유로 걸러야 한다 — 0이나 NaN이 들어오면 renderScale이
  // 0/NaN이 되어 캔버스 크기가 무너진다.
  if (!Number.isFinite(renderTargetCssWidth) || renderTargetCssWidth <= 0) {
    return null;
  }

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
    (renderTargetCssWidth / width) * clampedDpr,
  );

  return {
    ...canvasSize(width * renderScale, height * renderScale),
    cssHeight,
    cssWidth,
    offsetX: -left * renderScale,
    offsetY: -top * renderScale,
    renderScale,
  };
}

/**
 * 스케일된 크기를 실제 캔버스 픽셀 크기로 만든다. 0폭/0높이 캔버스는 pdfjs가
 * 던지므로 각 축은 최소 1이다.
 *
 * ‼️ 그 1px 바닥은 면적 상한 **뒤에** 축별로 적용되므로, 극단적인 종횡비에서는
 * 바닥이 면적을 되살린다: w/h = 1e-8이면 폭이 0.2에서 1로 올라가는 동안 높이는
 * 상한 스케일을 그대로 유지해 **1 × 20,000,000**(예산의 5배, ~80MB)이 된다.
 * 바닥이 걸린 축이 있으면 반대 축을 예산에 맞춰 자르는 이유다. 임계는
 * `w/h < 5.63e-7` — 실제 PDF이 아니라 상한 사이드카에서나 나오는 값이지만,
 * 상한이 "종횡비와 무관"하다는 주장은 이 절이 있어야 참이 된다.
 *
 * 바닥이 걸리지 않은 일반 경로는 손대지 않는다. 축별 반올림 때문에 곱이 예산을
 * 0.1% 미만 넘길 수 있지만(50×700 크롭이 1.00085배), 거기서 한 축을 더 자르면
 * 예산을 지키는 대가로 크롭 아래쪽 몇 줄이 **잘려 나간다** — 캔버스를 줄이는
 * 것은 축소가 아니라 클리핑이기 때문이다.
 */
function canvasSize(
  scaledWidth: number,
  scaledHeight: number,
): { canvasHeight: number; canvasWidth: number } {
  const roundedWidth = Math.round(scaledWidth);
  const roundedHeight = Math.round(scaledHeight);
  if (roundedWidth >= 1 && roundedHeight >= 1) {
    return { canvasHeight: roundedHeight, canvasWidth: roundedWidth };
  }
  // 한 축이 1로 올라갔다 — 반대 축을 예산 안으로 되돌린다. 두 예산 모두
  // 클램프 **전** 값에서 계산해야 짝이 맞는다.
  const flooredWidth = Math.max(1, roundedWidth);
  const flooredHeight = Math.max(1, roundedHeight);
  return {
    canvasHeight: Math.max(
      1,
      Math.min(
        flooredHeight,
        Math.floor(MAX_AREA_CANVAS_PIXELS / flooredWidth),
      ),
    ),
    canvasWidth: Math.max(
      1,
      Math.min(
        flooredWidth,
        Math.floor(MAX_AREA_CANVAS_PIXELS / flooredHeight),
      ),
    ),
  };
}

/**
 * `scale`을 그대로 쓰되, 캔버스 면적이 예산을 넘으면 예산에 **딱 맞는**
 * 스케일로 낮춘다. 면적은 스케일의 제곱이므로 예산 스케일은
 * `sqrt(예산 / (width * height))`이다 — 곱셈 형태(`scale * sqrt(예산/면적)`)와
 * 값은 같지만 이 형태가 더 늦게 넘친다(극단적 종횡비로 **스케일된** 면적이
 * Infinity가 되면 곱셈 쪽은 스케일 0을 돌려준다). 이 형태도 `width * height`가
 * 1.8e308을 넘으면 같은 방식으로 0이 되지만, 그때도 캔버스는 1×1로 떨어질 뿐
 * pdfjs가 던지지는 않는다.
 *
 * ‼️ 두 임계를 섞지 말 것 (둘 다 dpr 2 기준, 계산해 확인함):
 *   - 상한이 **무는** 지점: `h/w > 1.235` — 드문 세로 막대가 아니라 웬만한
 *     세로 그림 전부다(MAX_AREA_CANVAS_PIXELS 주석 참조).
 *   - 새 백킹이 **예전보다 작아지는** 지점: 훨씬 위쪽인 `w·h > 1e6 pt²`
 *     (자연 폭이 640 이하일 때. 640×2000 크롭 = 1280 → 1131 device px,
 *     500×2000은 정확히 동점). 자연 폭이 640을 넘으면 `h/w > 2.44`.
 * 즉 상한에 걸리는 크롭 대부분은 그래도 예전보다 큰 백킹을 받는다
 * (300×900 크롭: 600 → 1155). 표시 크기는 어느 쪽이든 바뀌지 않는다.
 */
function fitToCanvasArea(width: number, height: number, scale: number): number {
  if (width * height * scale * scale <= MAX_AREA_CANVAS_PIXELS) return scale;
  return Math.sqrt(MAX_AREA_CANVAS_PIXELS / (width * height));
}

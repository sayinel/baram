// §276.4 잘라낸 영역 프리뷰(PNG dataURL) LRU 캐시.
//
// 훅에서 분리한 이유: 여기 있는 세 가지 결정(상한 32, FIFO가 아닌 LRU,
// 키 구성)은 캔버스가 전혀 필요 없는 순수 Map 연산인데 훅 안에 있으면
// jsdom에서 단위 테스트할 방법이 없다. pdf-doc-cache.ts가 문서 캐시를
// 따로 두는 것과 같은 이유다.
//
// 이 캐시는 **PDF 로드를 줄여주지 않는다.** 키에 들어가는 canvasWidth는
// 뷰포트 없이 알 수 없어서(회전이 반영된 크기다) 조회 시점이 문서를 연
// 뒤이기 때문이다 — 여기서 아끼는 것은 render + toDataURL뿐이다.

/**
 * 바이트 예산 — **이쪽이 실질적인 상한**이다.
 *
 * §276.6이 백킹 해상도를 표시 크기에서 떼어 내면서(pdf-area-crop.ts) 항목당
 * 비용의 범위가 30 KB(벡터 그림)~12.43 MB(면적 상한에 걸린 사진)로 **414배**가
 * 됐다. 개수 상한은 그 범위를 묶지 못한다 — 32개는 내용에 따라 1 MB일 수도,
 * 398 MB일 수도 있다. 이 캐시는 모듈 레벨이라 노트를 닫아도 살아남으므로
 * 그 숫자가 곧 **유휴 메모리**다(목표 < 100 MB).
 *
 * 24 MB = 목표의 1/4. 벡터 그림이면 ~800개가 들어가므로 흔한 경우에는 개수
 * 상한이 먼저 걸려 이 예산이 보이지도 않고, 사진이면 ~3개에서 물린다 —
 * 물려야 하는 바로 그곳이다. base64는 ASCII라 `.length`가 곧 바이트 수다.
 *
 * ‼️ 개수만 낮추는 것은 오답이다: 8개로 줄여도 최악의 경우 ~100 MB(목표 전부)가
 * 남고, 대신 값싼 벡터 크롭이 이유 없이 축출된다.
 */
export const AREA_PREVIEW_CACHE_BYTES = 24 * 1024 * 1024;

/** 개수 상한 — 바이트 예산과 함께 걸리는 2차 방어선. */
export const AREA_PREVIEW_CACHE_LIMIT = 32;

/** 테스트 전용 — 러닝 합계가 Map의 실제 내용과 어긋나지 않는지 단정하기 위해. */
export function __areaPreviewCacheBytesForTest(): number {
  return cachedBytes;
}

/** 테스트 전용 — 모듈 레벨 캐시는 파일 간에 살아남으므로 각 테스트가 비운다. */
export function __resetAreaPreviewCacheForTest(): void {
  cache.clear();
  cachedBytes = 0;
}

/**
 * 캐시 키. canvasWidth가 들어가는 이유: 같은 영역을 **다른 픽셀 크기**로 그린
 * 것은 다른 이미지이고, 그걸 재사용하면 흐리거나 계단이 진다. 지금 그 값을
 * 가르는 것은 dpr과 면적 상한이다 — §276.6 이후 renderScale은 표시 폭 상한
 * (maxCssWidth)에 의존하지 않으므로, 면적 상한에 걸리지 않는 크롭의
 * canvasWidth는 `round(900 · dpr)`로 사실상 상수다.
 */
export function areaPreviewCacheKey(
  absPdfPath: string,
  blockId: string,
  canvasWidth: number,
): string {
  return `${absPdfPath}|${blockId}|${canvasWidth}`;
}

/** 히트면 dataURL, 아니면 undefined. 히트한 항목은 가장 최근으로 올라간다. */
export function readAreaPreview(key: string): string | undefined {
  const src = cache.get(key);
  if (src === undefined) return undefined;
  // ‼️ 재삽입이 이 캐시를 LRU로 만든다. 이 두 줄이 없으면 Map의 삽입 순서가
  // 그대로 남아 FIFO가 되고, **가장 자주 보는** 프리뷰가 가장 먼저 버려진다
  // (오래 열어 둔 노트의 맨 위 그림이 스크롤할 때마다 다시 렌더된다).
  cache.delete(key);
  cache.set(key, src);
  return src;
}

export function writeAreaPreview(key: string, src: string): void {
  // 갱신 시에도 순서를 새로 잡아야 한다 — set만으로는 기존 키의 위치가
  // 유지돼 방금 쓴 항목이 가장 오래된 것으로 남는다. 덮어쓰는 경우 옛 값의
  // 바이트를 **먼저** 빼야 러닝 합계가 Map과 어긋나지 않는다.
  const previous = cache.get(key);
  if (previous !== undefined) {
    cache.delete(key);
    cachedBytes -= previous.length;
  }
  cache.set(key, src);
  cachedBytes += src.length;

  while (
    cache.size > AREA_PREVIEW_CACHE_LIMIT ||
    cachedBytes > AREA_PREVIEW_CACHE_BYTES
  ) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    // ‼️ 축출에서 합계를 안 빼면 캐시가 **영구히** 예산 초과 상태가 되어,
    // 이후 모든 쓰기가 Map을 통째로 비운다 — 상한이 아니라 무효화 장치가 된다.
    cachedBytes -= cache.get(oldest)?.length ?? 0;
    cache.delete(oldest);
  }
  // 예산보다 큰 항목 하나는 위 루프에서 자기 자신까지 나가고 캐시는 빈다.
  // 그것이 옳다: 남겨 두면 그 항목 하나 때문에 이후 모든 쓰기가 나머지를
  // 전부 축출하게 된다.
}

// 모듈 레벨 — 같은 참조를 다시 마운트해도(스크롤 아웃/인, 탭 전환) 다시
// 그리지 않는다. Map의 삽입 순서를 LRU 순서로 쓴다.
const cache = new Map<string, string>();

/** cache에 담긴 문자열 길이의 합. Map과 함께 갱신된다. */
let cachedBytes = 0;

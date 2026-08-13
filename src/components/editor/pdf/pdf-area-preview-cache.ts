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

/** dataURL 캐시 상한. PNG dataURL은 항목당 수백 KB가 될 수 있어 넉넉히 잡지 않는다. */
export const AREA_PREVIEW_CACHE_LIMIT = 32;

/** 테스트 전용 — 모듈 레벨 캐시는 파일 간에 살아남으므로 각 테스트가 비운다. */
export function __resetAreaPreviewCacheForTest(): void {
  cache.clear();
}

/**
 * 캐시 키. canvasWidth가 들어가는 이유: 같은 영역이라도 dpr이나 표시 폭
 * 상한이 달라지면 **다른 픽셀 크기의 다른 이미지**다. 그 값으로 그린 것을
 * 다른 크기에 재사용하면 흐리거나 계단이 진다.
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
  // 유지돼 방금 쓴 항목이 가장 오래된 것으로 남는다.
  cache.delete(key);
  cache.set(key, src);
  while (cache.size > AREA_PREVIEW_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// 모듈 레벨 — 같은 참조를 다시 마운트해도(스크롤 아웃/인, 탭 전환) 다시
// 그리지 않는다. Map의 삽입 순서를 LRU 순서로 쓴다.
const cache = new Map<string, string>();

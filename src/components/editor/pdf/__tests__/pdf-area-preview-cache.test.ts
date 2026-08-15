import { beforeEach, describe, expect, it } from "vitest";

import {
  __areaPreviewCacheBytesForTest,
  __resetAreaPreviewCacheForTest,
  AREA_PREVIEW_CACHE_BYTES,
  AREA_PREVIEW_CACHE_LIMIT,
  areaPreviewCacheKey,
  readAreaPreview,
  writeAreaPreview,
} from "../pdf-area-preview-cache";

/** i번째 항목의 키. 순서 단정을 읽기 쉽게 하려고 경로만 바꾼다. */
function key(i: number): string {
  return areaPreviewCacheKey(`/v/${String(i)}.pdf`, "abc123", 200);
}

describe("areaPreviewCacheKey", () => {
  it("joins path, block id and canvas width with |", () => {
    expect(areaPreviewCacheKey("/v/a.pdf", "abc123", 640)).toBe(
      "/v/a.pdf|abc123|640",
    );
  });

  it("separates the same region rendered at a different canvas width", () => {
    // dpr이 바뀌거나 표시 폭 상한이 바뀌면 픽셀 크기가 다른 **다른 이미지**다.
    // 키가 canvasWidth를 안 담으면 2x로 그린 것을 1x 자리에 재사용하게 된다.
    expect(areaPreviewCacheKey("/v/a.pdf", "abc123", 640)).not.toBe(
      areaPreviewCacheKey("/v/a.pdf", "abc123", 320),
    );
  });

  it("separates two highlights in the same PDF", () => {
    expect(areaPreviewCacheKey("/v/a.pdf", "one", 640)).not.toBe(
      areaPreviewCacheKey("/v/a.pdf", "two", 640),
    );
  });
});

describe("area preview cache", () => {
  beforeEach(() => {
    __resetAreaPreviewCacheForTest();
  });

  it("returns undefined for a key it has never seen", () => {
    expect(readAreaPreview(key(1))).toBeUndefined();
  });

  it("round-trips a stored dataURL", () => {
    writeAreaPreview(key(1), "data:image/png;base64,AAAA");
    expect(readAreaPreview(key(1))).toBe("data:image/png;base64,AAAA");
  });

  it("keeps exactly the cap and drops the oldest beyond it", () => {
    // 상한 + 1개를 넣으면 가장 먼저 넣은 것 하나만 사라져야 한다.
    for (let i = 0; i <= AREA_PREVIEW_CACHE_LIMIT; i++) {
      writeAreaPreview(key(i), `src-${String(i)}`);
    }

    expect(readAreaPreview(key(0))).toBeUndefined();
    for (let i = 1; i <= AREA_PREVIEW_CACHE_LIMIT; i++) {
      expect(readAreaPreview(key(i))).toBe(`src-${String(i)}`);
    }
  });

  it("evicts LRU, not FIFO — a read rescues the oldest entry", () => {
    // ‼️ 이 테스트가 readAreaPreview의 delete+set 재삽입을 고정한다. 그게
    // 없으면 Map의 원래 삽입 순서가 남아 FIFO가 되고, 방금 읽은(=가장 자주
    // 보는) 항목이 그대로 첫 번째 축출 대상이 된다.
    for (let i = 0; i < AREA_PREVIEW_CACHE_LIMIT; i++) {
      writeAreaPreview(key(i), `src-${String(i)}`);
    }

    // 가장 오래된 0번을 읽어 최신으로 끌어올린다.
    expect(readAreaPreview(key(0))).toBe("src-0");

    // 이제 하나를 더 넣으면 0번이 아니라 1번(그 다음으로 오래된 것)이 나가야 한다.
    writeAreaPreview(key(999), "src-999");

    expect(readAreaPreview(key(0))).toBe("src-0");
    expect(readAreaPreview(key(1))).toBeUndefined();
  });

  it("re-writing an existing key refreshes its recency", () => {
    for (let i = 0; i < AREA_PREVIEW_CACHE_LIMIT; i++) {
      writeAreaPreview(key(i), `src-${String(i)}`);
    }
    writeAreaPreview(key(0), "rewritten");
    writeAreaPreview(key(999), "src-999");

    // set만으로는 기존 키의 삽입 위치가 유지돼 0번이 가장 오래된 채로 남는다.
    expect(readAreaPreview(key(0))).toBe("rewritten");
    expect(readAreaPreview(key(1))).toBeUndefined();
  });

  it("re-writing an existing key does not grow the cache", () => {
    for (let i = 0; i < AREA_PREVIEW_CACHE_LIMIT; i++) {
      writeAreaPreview(key(i), `src-${String(i)}`);
    }
    for (let i = 0; i < AREA_PREVIEW_CACHE_LIMIT; i++) {
      writeAreaPreview(key(i), `again-${String(i)}`);
    }

    // 상한만큼만 있었으므로 아무것도 축출되지 않아야 한다.
    for (let i = 0; i < AREA_PREVIEW_CACHE_LIMIT; i++) {
      expect(readAreaPreview(key(i))).toBe(`again-${String(i)}`);
    }
  });
});

// §276.6 개수 상한은 항목당 비용이 30 KB~12.43 MB(414배)로 벌어진 뒤로 아무것도
// 묶지 못한다 — 32개가 1 MB일 수도 398 MB일 수도 있다. 실질 상한은 바이트 예산이다.
describe("area preview cache byte budget", () => {
  /** 예산의 절반보다 큰 항목 — 두 개면 예산을 넘는다. */
  const CHUNK = Math.ceil(AREA_PREVIEW_CACHE_BYTES * 0.4);

  /** 길이가 정확히 n인 문자열. base64는 ASCII라 길이가 곧 바이트 수다. */
  function bytes(n: number): string {
    return "x".repeat(n);
  }

  /** 러닝 합계가 Map의 실제 내용과 일치하는지 — 축출·덮어쓰기 양쪽에서. */
  function expectTotalMatches(...keys: string[]): void {
    const sum = keys.reduce((n, k) => n + (readAreaPreview(k)?.length ?? 0), 0);
    expect(__areaPreviewCacheBytesForTest()).toBe(sum);
  }

  beforeEach(() => {
    __resetAreaPreviewCacheForTest();
  });

  it("evicts the LRU entry until the total is back within budget", () => {
    writeAreaPreview(key(1), bytes(CHUNK));
    writeAreaPreview(key(2), bytes(CHUNK));
    expect(__areaPreviewCacheBytesForTest()).toBe(CHUNK * 2);

    // 세 번째가 예산을 넘긴다 — 개수는 3개뿐이라 개수 상한은 걸리지 않는다.
    writeAreaPreview(key(3), bytes(CHUNK));

    expect(readAreaPreview(key(1))).toBeUndefined();
    expect(readAreaPreview(key(2))).toHaveLength(CHUNK);
    expect(readAreaPreview(key(3))).toHaveLength(CHUNK);
    expect(__areaPreviewCacheBytesForTest()).toBeLessThanOrEqual(
      AREA_PREVIEW_CACHE_BYTES,
    );
    expectTotalMatches(key(2), key(3));
  });

  it("counts an overwrite once, not twice", () => {
    // ‼️ 옛 값의 바이트를 빼지 않으면 같은 참조를 다시 그릴 때마다 합계가
    // 부풀고, 결국 캐시가 스스로를 비운다.
    writeAreaPreview(key(1), bytes(CHUNK));
    writeAreaPreview(key(1), bytes(CHUNK));
    writeAreaPreview(key(1), bytes(CHUNK));

    expect(readAreaPreview(key(1))).toHaveLength(CHUNK);
    expect(__areaPreviewCacheBytesForTest()).toBe(CHUNK);
  });

  it("shrinks the total when an overwrite is smaller than what it replaced", () => {
    writeAreaPreview(key(1), bytes(CHUNK));
    writeAreaPreview(key(1), bytes(10));

    expect(__areaPreviewCacheBytesForTest()).toBe(10);
  });

  it("does not let an entry bigger than the whole budget wedge the cache", () => {
    // 예산을 혼자 넘는 항목을 남겨 두면 이후 **모든** 쓰기가 나머지를 전부
    // 축출한다 — 상한이 아니라 캐시 무효화 장치가 된다. 자기 자신도 나간다.
    writeAreaPreview(key(1), bytes(1000));
    writeAreaPreview(key(2), bytes(AREA_PREVIEW_CACHE_BYTES + 1));

    expect(readAreaPreview(key(2))).toBeUndefined();
    expect(__areaPreviewCacheBytesForTest()).toBe(0);

    // 그리고 캐시는 계속 쓸 수 있어야 한다.
    writeAreaPreview(key(3), bytes(1000));
    expect(readAreaPreview(key(3))).toHaveLength(1000);
    expect(__areaPreviewCacheBytesForTest()).toBe(1000);
  });

  it("honours LRU order when it is bytes rather than count that overflows", () => {
    writeAreaPreview(key(1), bytes(CHUNK));
    writeAreaPreview(key(2), bytes(CHUNK));

    // 1번을 읽어 최신으로 올린다 — 이제 가장 오래된 것은 2번이다.
    expect(readAreaPreview(key(1))).toHaveLength(CHUNK);

    writeAreaPreview(key(3), bytes(CHUNK));

    expect(readAreaPreview(key(1))).toHaveLength(CHUNK);
    expect(readAreaPreview(key(2))).toBeUndefined();
    expectTotalMatches(key(1), key(3));
  });

  it("still enforces the count bound for cheap entries", () => {
    // 벡터 그림 32개는 1 MB 남짓이라 바이트 예산에 한참 못 미친다 —
    // 그 구간에서는 개수 상한이 여전히 유일하게 작동하는 상한이다.
    for (let i = 0; i <= AREA_PREVIEW_CACHE_LIMIT; i++) {
      writeAreaPreview(key(i), bytes(64));
    }

    expect(readAreaPreview(key(0))).toBeUndefined();
    expect(__areaPreviewCacheBytesForTest()).toBe(
      64 * AREA_PREVIEW_CACHE_LIMIT,
    );
  });
});

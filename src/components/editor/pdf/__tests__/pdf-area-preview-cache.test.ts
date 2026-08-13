import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetAreaPreviewCacheForTest,
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

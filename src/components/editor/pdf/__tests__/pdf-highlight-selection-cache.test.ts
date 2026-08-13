// §274 popup 일관성 fix (round 4) — PendingRefBlockCache 단위 테스트.
// 순수 Map 래퍼라 IPC/DOM 모킹 없이 그대로 돌린다.
import type { PendingSelection } from "../pdf-highlight-selection-cache";

import { describe, expect, it } from "vitest";

import { PendingRefBlockCache } from "../pdf-highlight-selection-cache";

function sel(overrides: Partial<PendingSelection> = {}): PendingSelection {
  return {
    pageNumber: 1,
    rects: [{ h: 20, w: 100, x: 0, y: 0 }],
    text: "hello world",
    ...overrides,
  };
}

describe("PendingRefBlockCache", () => {
  it("returns null for a selection it has never seen", () => {
    const cache = new PendingRefBlockCache();
    expect(cache.get(sel())).toBeNull();
  });

  it("returns the id it was given for the exact same selection", () => {
    const cache = new PendingRefBlockCache();
    cache.set(sel(), "block-1");
    expect(cache.get(sel())).toBe("block-1");
  });

  it("misses when the page number differs, even if text and rects match", () => {
    const cache = new PendingRefBlockCache();
    cache.set(sel({ pageNumber: 1 }), "block-1");
    expect(cache.get(sel({ pageNumber: 2 }))).toBeNull();
  });

  it("misses when the text differs, even if page and rects match", () => {
    const cache = new PendingRefBlockCache();
    cache.set(sel({ text: "hello world" }), "block-1");
    expect(cache.get(sel({ text: "goodbye world" }))).toBeNull();
  });

  // §274 I2의 핵심 위험: 같은 페이지에 같은 문구가 두 번 나오면 서로 다른
  // 위치의 두 선택이 text+page만으로는 구분되지 않는다. rects가 다르면(다른
  // 위치니까 당연히 다르다) 엄격 키는 이 둘을 분리해 낸다 — 분리하지
  // 못하면 나중 선택의 색칠이 먼저 선택의 id를 재사용해, 결국 서로 다른
  // 두 위치가 사이드카에서 같은 id를 공유하게 된다(update/delete가 하나로
  // 취급).
  it("does NOT collide when the same text appears twice on the same page at different rects", () => {
    const cache = new PendingRefBlockCache();
    const occurrenceA = sel({
      rects: [{ h: 20, w: 100, x: 0, y: 0 }],
      text: "the the",
    });
    const occurrenceB = sel({
      rects: [{ h: 20, w: 100, x: 0, y: 200 }],
      text: "the the",
    });
    cache.set(occurrenceA, "block-A");
    expect(cache.get(occurrenceB)).toBeNull();
  });

  it("misses when the rect list differs, even if page and text match", () => {
    const cache = new PendingRefBlockCache();
    cache.set(sel({ rects: [{ h: 20, w: 100, x: 0, y: 0 }] }), "block-1");
    expect(
      cache.get(sel({ rects: [{ h: 20, w: 100, x: 5, y: 0 }] })),
    ).toBeNull();
  });

  it("misses when the rect count differs", () => {
    const cache = new PendingRefBlockCache();
    cache.set(sel({ rects: [{ h: 20, w: 100, x: 0, y: 0 }] }), "block-1");
    expect(
      cache.get(
        sel({
          rects: [
            { h: 20, w: 100, x: 0, y: 0 },
            { h: 20, w: 50, x: 0, y: 20 },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("removes an entry via delete, leaving a later get as a miss", () => {
    const cache = new PendingRefBlockCache();
    cache.set(sel(), "block-1");
    cache.delete(sel());
    expect(cache.get(sel())).toBeNull();
  });

  it("clear() empties every entry, regardless of key", () => {
    const cache = new PendingRefBlockCache();
    cache.set(sel({ pageNumber: 1 }), "block-1");
    cache.set(sel({ pageNumber: 2 }), "block-2");
    cache.clear();
    expect(cache.get(sel({ pageNumber: 1 }))).toBeNull();
    expect(cache.get(sel({ pageNumber: 2 }))).toBeNull();
  });
});

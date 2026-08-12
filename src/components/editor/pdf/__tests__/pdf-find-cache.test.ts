import type { EolTextItem } from "../pdf-find-eol";

// §272 Fix round 1 — I-B/M1: recomputePageMatches was inline in
// use-pdf-find.ts and untestable without mounting pdfjs + React. Extracted
// to pdf-find-cache.ts so Correction 3 (per-page currentIdx, not global)
// and Correction 5 (unchanged pages keep their cached object identity) can
// be pinned directly.
import { describe, expect, it } from "vitest";

import { recomputePageMatches, samePositions } from "../pdf-find-cache";

const page1Items: EolTextItem[] = [{ str: "hello world" }];
const page2Items: EolTextItem[] = [{ str: "hello there" }];
const pageItems = new Map<number, EolTextItem[]>([
  [1, page1Items],
  [2, page2Items],
]);
// Both pages have one match for "hello" at offset 0, length 5.
const pageMatches = [[0], [0]];
const pageMatchesLength = [[5], [5]];

describe("recomputePageMatches — Correction 3 (per-page currentIdx)", () => {
  it("marks currentIdx only on the page findController.selected actually points at", () => {
    const { cache } = recomputePageMatches({
      numPages: 2,
      pageItems,
      pageMatches,
      pageMatchesLength,
      previous: new Map(),
      selected: { matchIdx: 0, pageIdx: 0 }, // global first match is on page 1 (pageIdx 0)
    });

    expect(cache.get(1)?.currentIdx).toBe(0);
    // page 2 has an identical match, but selected doesn't point at it —
    // a global-index bug would wrongly mark it "current" too.
    expect(cache.get(2)?.currentIdx).toBe(-1);
  });

  it("moves currentIdx to the other page when selected.pageIdx changes", () => {
    const { cache } = recomputePageMatches({
      numPages: 2,
      pageItems,
      pageMatches,
      pageMatchesLength,
      previous: new Map(),
      selected: { matchIdx: 0, pageIdx: 1 },
    });

    expect(cache.get(1)?.currentIdx).toBe(-1);
    expect(cache.get(2)?.currentIdx).toBe(0);
  });

  it("skips a page with no cached items yet rather than fabricating an entry", () => {
    const { cache } = recomputePageMatches({
      numPages: 2,
      pageItems: new Map([[1, page1Items]]), // page 2's items haven't arrived
      pageMatches,
      pageMatchesLength,
      previous: new Map(),
      selected: { matchIdx: -1, pageIdx: -1 },
    });

    expect(cache.has(1)).toBe(true);
    expect(cache.has(2)).toBe(false);
  });
});

describe("recomputePageMatches — Correction 5 (identity-stable unchanged pages)", () => {
  it("keeps the same object reference for a page whose currentIdx and positions did not change", () => {
    const first = recomputePageMatches({
      numPages: 2,
      pageItems,
      pageMatches,
      pageMatchesLength,
      previous: new Map(),
      selected: { matchIdx: 0, pageIdx: 0 },
    });

    const second = recomputePageMatches({
      numPages: 2,
      pageItems,
      pageMatches,
      pageMatchesLength,
      previous: first.cache,
      selected: { matchIdx: 0, pageIdx: 0 }, // nothing changed
    });

    expect(second.changed).toBe(false);
    expect(second.cache.get(1)).toBe(first.cache.get(1));
    expect(second.cache.get(2)).toBe(first.cache.get(2));
  });

  it("replaces the object reference only for pages whose currentIdx actually moved", () => {
    const first = recomputePageMatches({
      numPages: 2,
      pageItems,
      pageMatches,
      pageMatchesLength,
      previous: new Map(),
      selected: { matchIdx: 0, pageIdx: 0 }, // page 1 is current
    });

    const second = recomputePageMatches({
      numPages: 2,
      pageItems,
      pageMatches,
      pageMatchesLength,
      previous: first.cache,
      selected: { matchIdx: 0, pageIdx: 1 }, // selection moved to page 2
    });

    expect(second.changed).toBe(true);
    // Both pages' currentIdx flipped (page1: 0→-1, page2: -1→0), so both
    // must get new object references — this is exactly what keeps PdfPage's
    // `[matches]`-keyed effect from repainting untouched pages while still
    // repainting the ones whose highlight state changed.
    expect(second.cache.get(1)).not.toBe(first.cache.get(1));
    expect(second.cache.get(2)).not.toBe(first.cache.get(2));
  });
});

describe("samePositions", () => {
  const a = [
    { begin: { divIdx: 0, offset: 0 }, end: { divIdx: 0, offset: 5 } },
  ];

  it("is true for structurally identical position arrays", () => {
    const b = [
      { begin: { divIdx: 0, offset: 0 }, end: { divIdx: 0, offset: 5 } },
    ];
    expect(samePositions(a, b)).toBe(true);
  });

  it("is false when lengths differ", () => {
    expect(samePositions(a, [])).toBe(false);
  });

  it("is false when only an offset differs (a length check alone would miss this)", () => {
    const b = [
      { begin: { divIdx: 0, offset: 0 }, end: { divIdx: 0, offset: 4 } },
    ];
    expect(samePositions(a, b)).toBe(false);
  });
});

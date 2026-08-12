// §272 Fix round 2 — N1/N2: pdf-find-cache.test.ts only exercises
// recomputePageMatches in isolation (fresh `previous: new Map()` every
// call), which cannot see the use-pdf-find.ts ref-reassignment/cleanup
// interaction bug — that bug is specifically about whether
// positionsRef.current keeps the SAME object identity across recomputes so
// the [doc] effect's captured cleanup variable still points at the live
// Map. This file drives the real hook through the reviewer's exact repro:
// search in one document with the bar open, then switch documents WITHOUT
// closing the bar.
//
// PDFFindController itself is mocked out (real search/regex/debounce logic
// is irrelevant here and would make the test fragile) — but EventBus is the
// REAL class via vi.importActual, so bus.on/off/dispatch behave exactly as
// use-pdf-find.ts expects, and the fake controller can announce results
// through it exactly like the real one does internally.
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePdfFind } from "../use-pdf-find";

interface FakeEventBus {
  dispatch: (name: string, data: unknown) => void;
}

class FakeFindController {
  onIsPageVisible: (() => boolean) | null = null;
  pageMatches: number[][] = [];
  pageMatchesLength: number[][] = [];
  selected: { matchIdx: number; pageIdx: number } = {
    matchIdx: -1,
    pageIdx: -1,
  };
  private readonly bus: FakeEventBus;

  constructor({ eventBus }: { eventBus: FakeEventBus }) {
    this.bus = eventBus;
  }

  /** 실제 findController가 매치를 계산한 뒤 하는 일을 흉내낸다. */
  announce(current: number, total: number): void {
    this.bus.dispatch("updatefindmatchescount", {
      matchesCount: { current, total },
    });
  }

  setDocument(): void {}
}

const instances: FakeFindController[] = [];

vi.mock("pdfjs-dist/legacy/web/pdf_viewer.mjs", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "pdfjs-dist/legacy/web/pdf_viewer.mjs",
  );
  return {
    ...actual,
    PDFFindController: class extends FakeFindController {
      constructor(opts: { eventBus: FakeEventBus }) {
        super(opts);
        instances.push(this);
      }
    },
  };
});

function fakePage(pageNumber: number, str: string): PDFPageProxy {
  return {
    getTextContent: () => Promise.resolve({ items: [{ hasEOL: false, str }] }),
    pageNumber,
  } as unknown as PDFPageProxy;
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    // (dynamic import + getTextContent Promise)을 순서대로 배출해야 한다
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("usePdfFind — document switch while the find bar stays open (N1)", () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it("does not leak the previous document's cached match positions into the new one", async () => {
    const docA = { numPages: 1 } as unknown as PDFDocumentProxy;
    const docB = { numPages: 1 } as unknown as PDFDocumentProxy;
    const pagesA = [fakePage(1, "hello world")];
    const pagesB = [fakePage(1, "goodbye")];

    const { rerender, result } = renderHook(
      (props: { doc: PDFDocumentProxy; pages: PDFPageProxy[] }) =>
        usePdfFind({
          doc: props.doc,
          getScrollElement: () => null,
          isOpen: true,
          pages: props.pages,
        }),
      { initialProps: { doc: docA, pages: pagesA } },
    );

    await act(flush);
    expect(instances).toHaveLength(1);

    // doc A의 findController가 매치를 찾았다고 알린다.
    const controllerA = instances[0];
    controllerA.pageMatches = [[0]];
    controllerA.pageMatchesLength = [[5]];
    controllerA.selected = { matchIdx: 0, pageIdx: 0 };
    act(() => controllerA.announce(1, 1));

    expect(result.current.getPageMatches(1)?.positions).toHaveLength(1);

    // 찾기 바를 안 닫고(isOpen: true 유지) 다른 문서로 바꾼다 — 리뷰어가
    // 지목한 정확한 재현 경로.
    rerender({ doc: docB, pages: pagesB });
    await act(flush);

    // doc B의 findController는 아직 아무것도 알리지 않았다 — doc A의 캐시가
    // 새 것으로 새어 들어가면 안 된다. (N1 회귀 전에는 [doc] 이펙트의
    // 클린업이 이미 버려진 Map을 지워서, 진짜 살아있는 Map에는 doc A의
    // 항목이 그대로 남아 이 assert가 깨졌다.)
    expect(result.current.getPageMatches(1)).toBeUndefined();
  });
});

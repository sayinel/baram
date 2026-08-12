// §274 UX fix (defect 1) 회귀 테스트 — 드래그 도중 selectionchange가 팝업을
// 열지 않고, mouseup에서만 연다는 것. 그리고 (defect 2) 병합이 실제로
// 훅 레벨까지 이어진다는 것.
//
// use-pdf-highlights.test.ts와 같은 jsdom 한계 우회: Range.getClientRects가
// 이 jsdom 버전엔 없다("is not a function") — 이 파일 스코프에서만
// 대체 구현을 심는다.
import type { NewSelectionPayload } from "../use-pdf-selection-popup";
import type { PDFPageProxy } from "pdfjs-dist";

import { act, renderHook } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { usePdfSelectionPopup } from "../use-pdf-selection-popup";

function fakePage(pageNumber: number): PDFPageProxy {
  return {
    getViewport: () => ({
      convertToPdfPoint: (x: number, y: number) => [x, y],
      convertToViewportPoint: (x: number, y: number) => [x, y],
    }),
    pageNumber,
  } as unknown as PDFPageProxy;
}

describe("usePdfSelectionPopup", () => {
  let restoreGetClientRects: () => void;

  beforeAll(() => {
    const original = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function fakeGetClientRects() {
      return getClientRectsMock() as unknown as DOMRectList;
    };
    restoreGetClientRects = () => {
      Range.prototype.getClientRects = original;
    };
  });

  afterAll(() => {
    restoreGetClientRects();
  });

  // 각 테스트가 갈아 끼운다 — 기본은 구멍 없는 단일 rect.
  let getClientRectsMock = () => [
    { bottom: 20, height: 12, left: 0, right: 100, top: 8, width: 100 },
  ];

  beforeEach(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
    getClientRectsMock = () => [
      { bottom: 20, height: 12, left: 0, right: 100, top: 8, width: 100 },
    ];
  });

  function selectAllTextIn(pageEl: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(pageEl);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function setup(onSelect: (p: NewSelectionPayload) => void) {
    const pageEl = document.createElement("div");
    pageEl.textContent = "Attention mechanisms allow modeling";
    document.body.appendChild(pageEl);

    const pageElsRef = { current: new Map<number, HTMLElement>([[1, pageEl]]) };
    const pagesByNumberRef = {
      current: new Map<number, PDFPageProxy>([[1, fakePage(1)]]),
    };

    renderHook(() =>
      usePdfSelectionPopup({
        onSelect,
        pageElsRef,
        pagesByNumberRef,
        pdfRelPath: "papers/attention.pdf",
        scale: 1,
      }),
    );

    return { pageEl };
  }

  it("opens immediately on selectionchange when the mouse is not down (keyboard selection)", () => {
    const onSelect = vi.fn();
    const { pageEl } = setup(onSelect);

    selectAllTextIn(pageEl);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        pageNumber: 1,
        text: "Attention mechanisms allow modeling",
      }),
    );
  });

  it("does not open while a mouse button is held, and opens exactly once on mouseup", () => {
    const onSelect = vi.fn();
    const { pageEl } = setup(onSelect);

    act(() => {
      document.dispatchEvent(new Event("mousedown"));
    });

    // 드래그 도중 계속 나는 selectionchange — 하나도 열려서는 안 된다.
    selectAllTextIn(pageEl);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
      document.dispatchEvent(new Event("selectionchange"));
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(onSelect).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(new Event("mouseup"));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("mouseup with a collapsed selection (a plain click) does nothing", () => {
    const onSelect = vi.fn();
    setup(onSelect);
    // 선택 없음 — collapsed.

    act(() => {
      document.dispatchEvent(new Event("mousedown"));
      document.dispatchEvent(new Event("mouseup"));
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("merges same-line client rects with a gap into one spanning rect before handing them to onSelect (defect 2)", () => {
    getClientRectsMock = () => [
      { bottom: 20, height: 12, left: 0, right: 60, top: 8, width: 60 },
      // 100~60=40px짜리 구멍 — 별도 텍스트 아이템 경계를 흉내낸다.
      { bottom: 20, height: 12, left: 100, right: 140, top: 8, width: 40 },
    ];
    const onSelect = vi.fn();
    const { pageEl } = setup(onSelect);

    selectAllTextIn(pageEl);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    const { rects } = onSelect.mock.calls[0][0] as NewSelectionPayload;
    // identity viewport라 clientRectToPdf가 좌표를 그대로 통과시킨다 —
    // 병합된 결과는 두 rect가 아니라 왼쪽 끝(0)에서 오른쪽 끝(140)까지 하나.
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({ w: 140, x: 0 });
  });
});

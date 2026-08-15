// §274 하이라이트 훅 배선 테스트 — I1(조용한 실패 억제) 회귀를 포함한다.
//
// §274.3에서 I2(초안에서 "참조 먼저 복사" → 중복 블록) 관련 테스트는
// 사라졌다: 그 기구를 지탱하던 UI 진입점이 없어져 검증하던 흐름 자체가
// 도달 불가가 됐기 때문이다(PdfSelectionPopup.tsx의 `existing &&`).
//
// use-pdf-find.test.ts와 같은 패턴: renderHook으로 실제 훅을 돌리고, 이 훅이
// 실제로 호출하는 한 겹(pdf-highlight-actions/pdf-highlight-store)만
// 모킹한다. IPC 자체는 그 아래 계층(pdf-highlight-store.test.ts,
// pdf-highlight-actions.test.ts)이 이미 mock-specifier 규칙대로 검증한다 —
// 여기서 다시 ipc/fs를 모킹하면 같은 경계를 두 번 테스트하면서 훅의 배선
// 로직은 오히려 흐려진다.
//
// 두 가지 jsdom 한계를 이 파일 안에서만 우회한다(전역 test-setup.ts는
// 건드리지 않는다):
// - navigator.clipboard가 아예 없다(undefined) — 실제로 확인했다(스크래치
//   프로브: `typeof navigator.clipboard === "undefined"`). 없는 채로 두면
//   onCopyText/onCopyRef가 동기적으로 던진다.
// - Range.prototype.getClientRects가 없다("is not a function") — 있으면
//   빈 배열이 아니라 함수 자체가 없다. 선택 감지 경로(§274.1)를 실제로
//   태우려면 이 파일 스코프에서만 대체 구현을 심어야 한다.
import type { PdfRect, ViewportLike } from "../pdf-highlight-geom";
import type { StoredHighlight } from "../pdf-highlight-sidecar";
import type { PDFPageProxy } from "pdfjs-dist";

import { act, renderHook, waitFor } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { createTextHighlight, deleteHighlightById, updateHighlightColor } =
  vi.hoisted(() => ({
    createTextHighlight: vi.fn(),
    deleteHighlightById: vi.fn(),
    updateHighlightColor: vi.fn(),
  }));
vi.mock("../pdf-highlight-actions", () => ({
  createTextHighlight,
  deleteHighlightById,
  updateHighlightColor,
}));

const { appendHighlightBlock, readHighlightBlockText, readSidecar } =
  vi.hoisted(() => ({
    appendHighlightBlock: vi.fn(),
    readHighlightBlockText: vi.fn(),
    readSidecar: vi.fn(),
  }));
vi.mock("../pdf-highlight-store", () => ({
  appendHighlightBlock,
  readHighlightBlockText,
  readSidecar,
}));

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("../../../../stores/ui/ui", () => ({
  useUIStore: { getState: () => ({ showToast }) },
}));

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../../utils/logger", () => ({ logger }));

// generateBlockId만 결정적으로 바꾼다 — serializeBlockRef 등 나머지는 실제
// 구현을 그대로 통과시켜(§275.3/§275.4 규칙이 그대로 적용됐는지도 같이
// 검증할 수 있게) importActual로 가져온다.
const { generateBlockId } = vi.hoisted(() => ({ generateBlockId: vi.fn() }));
vi.mock("../../../../pipeline/block-id", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../pipeline/block-id")
  >("../../../../pipeline/block-id");
  return { ...actual, generateBlockId };
});

import { usePdfHighlights } from "../use-pdf-highlights";

const ROOT = "/vault";
const FILE_PATH = "/vault/papers/attention.pdf";
const ABS_COMPANION = "/vault/highlights/papers/attention.md";

function fakePage(pageNumber: number): PDFPageProxy {
  return {
    getViewport: () => identityViewport(),
    pageNumber,
  } as unknown as PDFPageProxy;
}

/** 항등 변환 — 좌표 계산 자체는 pdf-highlight-geom.test.ts가 왕복 항등으로
 * 고정해 뒀으니, 여기서는 아무 변환이나 일관되면 충분하다. */
function identityViewport(): ViewportLike {
  return {
    convertToPdfPoint: (x, y) => [x, y],
    convertToViewportPoint: (x, y) => [x, y],
  };
}

const HIGHLIGHT: StoredHighlight = {
  color: "yellow",
  id: "existing1",
  kind: "text",
  page: 1,
  rects: [{ h: 20, w: 100, x: 0, y: 0 } satisfies PdfRect],
};

describe("usePdfHighlights", () => {
  let restoreClipboard: () => void;
  let restoreGetClientRects: () => void;

  beforeAll(() => {
    // navigator.clipboard는 이 jsdom 버전에 전혀 없다(undefined) — 이 스위트
    // 안에서만 존재하게 만든다.
    const hadClipboard = "clipboard" in navigator;
    const original = hadClipboard
      ? Object.getOwnPropertyDescriptor(navigator, "clipboard")
      : undefined;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) },
    });
    restoreClipboard = () => {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    };

    const originalGetClientRects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function fakeGetClientRects() {
      return [
        { bottom: 20, height: 12, left: 0, right: 100, top: 8, width: 100 },
      ] as unknown as DOMRectList;
    };
    restoreGetClientRects = () => {
      Range.prototype.getClientRects = originalGetClientRects;
    };
  });

  afterAll(() => {
    restoreClipboard();
    restoreGetClientRects();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    readSidecar.mockResolvedValue(null);
    appendHighlightBlock.mockResolvedValue(undefined);
    readHighlightBlockText.mockResolvedValue(null);
    createTextHighlight.mockResolvedValue({
      highlight: HIGHLIGHT,
      sidecar: {
        companion: "highlights/papers/attention.md",
        highlights: [HIGHLIGHT],
        pdf: "papers/attention.pdf",
        version: 1,
      },
    });
    updateHighlightColor.mockResolvedValue({
      companion: "highlights/papers/attention.md",
      highlights: [HIGHLIGHT],
      pdf: "papers/attention.pdf",
      version: 1,
    });
    deleteHighlightById.mockResolvedValue({
      companion: "highlights/papers/attention.md",
      highlights: [],
      pdf: "papers/attention.pdf",
      version: 1,
    });
    generateBlockId.mockReturnValue("newblock1");
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  describe("§275.6 M2 — sidecar resets immediately on path change", () => {
    it("clears the previous PDF's highlights synchronously when filePath changes, before the new sidecar load resolves", async () => {
      readSidecar.mockResolvedValueOnce({
        companion: "highlights/papers/attention.md",
        highlights: [HIGHLIGHT],
        pdf: "papers/attention.pdf",
        version: 1,
      });
      // The new path's read never resolves within this test — proves the
      // clear happens because the effect resets state up front, not merely
      // because the new sidecar happened to load fast.
      readSidecar.mockImplementationOnce(() => new Promise(() => {}));

      const { rerender, result } = renderHook(
        (props: { filePath: string }) =>
          usePdfHighlights({
            filePath: props.filePath,
            pages: [fakePage(1)],
            pagesReady: true,
            rootPath: ROOT,
            scale: 1,
            scrollToPage: vi.fn(),
            textModeActive: true,
          }),
        { initialProps: { filePath: FILE_PATH } },
      );

      await waitFor(() =>
        expect(result.current.getPageHighlights(1)).toHaveLength(1),
      );

      act(() => {
        rerender({ filePath: "/vault/papers/other.pdf" });
      });

      // Without the M2 guard this would still show the FIRST pdf's
      // highlight — usePdfHighlightFlash reads exactly this sidecar to
      // decide whether a pending ref-jump's highlight exists, so a stale
      // read here would let it consume a jump against the wrong document.
      expect(result.current.getPageHighlights(1)).toHaveLength(0);
    });
  });

  // §274 UX fix round 5 — 사용자 리포트: 겹쳐서 하이라이트한 부분을 클릭하면
  // 가장 처음 만든 것이 잡혔다. 화면에는 가장 나중에 만든 것이 맨 위에
  // 그려지는데(PdfPage.tsx가 배열 순서 그대로 그린다) 클릭은 그 반대를
  // 골랐다는 것 — 이 describe는 훅 전체(handlePageMouseDown)를 통해 그
  // 정확한 시나리오를 재현한다. 순수 함수 단위 테스트는
  // pdf-highlight-hittest.test.ts의 hitTestTopmost 쪽에 있다.
  describe("§274 UX fix round 5 — overlapping highlights resolve to the topmost", () => {
    const FIRST: StoredHighlight = { ...HIGHLIGHT, id: "first" };
    // SECOND는 FIRST와 완전히 같은 rect를 갖는다 — 사용자가 같은 자리를
    // 두 번 하이라이트한 경우. 사이드카 배열에서 FIRST 다음(더 나중 = 더
    // 최근 생성)에 온다.
    const SECOND: StoredHighlight = { ...HIGHLIGHT, id: "second" };

    it("clicking an overlap region opens the popup for the most recently created highlight, not the oldest", async () => {
      readSidecar.mockResolvedValue({
        companion: "highlights/papers/attention.md",
        highlights: [FIRST, SECOND],
        pdf: "papers/attention.pdf",
        version: 1,
      });

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      await waitFor(() =>
        expect(result.current.getPageHighlights(1)).toHaveLength(2),
      );

      // 두 하이라이트가 공유하는 rect(x:[0,100], y:[0,20]) 안의 점을 클릭.
      act(() => {
        result.current.handlePageMouseDown(
          1,
          identityViewport(),
          { left: 0, top: 0 },
          10,
          10,
        );
      });

      expect(result.current.popupProps?.existing?.id).toBe("second");
    });

    it("a non-overlapping click still returns the only highlight covering that point", async () => {
      const disjoint: StoredHighlight = {
        color: "green",
        id: "disjoint",
        kind: "text",
        page: 1,
        rects: [{ h: 20, w: 100, x: 200, y: 200 } satisfies PdfRect],
      };
      readSidecar.mockResolvedValue({
        companion: "highlights/papers/attention.md",
        highlights: [FIRST, disjoint],
        pdf: "papers/attention.pdf",
        version: 1,
      });

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      await waitFor(() =>
        expect(result.current.getPageHighlights(1)).toHaveLength(2),
      );

      // disjoint의 rect(x:[200,300], y:[200,220]) 안의 점 — FIRST와 안 겹친다.
      act(() => {
        result.current.handlePageMouseDown(
          1,
          identityViewport(),
          { left: 0, top: 0 },
          210,
          210,
        );
      });

      expect(result.current.popupProps?.existing?.id).toBe("disjoint");
    });

    // §276.3 — PdfPreview uses this return value to decide whether an
    // area-mode mousedown should ALSO start a drag (only when it missed).
    it("returns true when the mousedown hits an existing highlight, false when it misses", async () => {
      readSidecar.mockResolvedValue({
        companion: "highlights/papers/attention.md",
        highlights: [FIRST],
        pdf: "papers/attention.pdf",
        version: 1,
      });

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      await waitFor(() =>
        expect(result.current.getPageHighlights(1)).toHaveLength(1),
      );

      let hit: boolean | undefined;
      act(() => {
        hit = result.current.handlePageMouseDown(
          1,
          identityViewport(),
          { left: 0, top: 0 },
          10,
          10,
        );
      });
      expect(hit).toBe(true);

      let miss: boolean | undefined;
      act(() => {
        miss = result.current.handlePageMouseDown(
          1,
          identityViewport(),
          { left: 0, top: 0 },
          900,
          900,
        );
      });
      expect(miss).toBe(false);
    });

    it("a click outside every highlight closes the popup instead of picking either one", async () => {
      readSidecar.mockResolvedValue({
        companion: "highlights/papers/attention.md",
        highlights: [FIRST, SECOND],
        pdf: "papers/attention.pdf",
        version: 1,
      });

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      await waitFor(() =>
        expect(result.current.getPageHighlights(1)).toHaveLength(2),
      );

      act(() => {
        result.current.handlePageMouseDown(
          1,
          identityViewport(),
          { left: 0, top: 0 },
          900,
          900,
        );
      });

      expect(result.current.popupProps).toBeNull();
    });
  });

  describe("I1 — write-path failures", () => {
    it("logs and shows a toast when changing colour fails to write the sidecar", async () => {
      readSidecar.mockResolvedValue({
        companion: "highlights/papers/attention.md",
        highlights: [HIGHLIGHT],
        pdf: "papers/attention.pdf",
        version: 1,
      });
      updateHighlightColor.mockRejectedValueOnce(new Error("disk full"));

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );

      await waitFor(() =>
        expect(result.current.getPageHighlights(1)).toHaveLength(1),
      );

      // 하이라이트의 rect(x:[0,100], y:[0,20]) 안의 점을 클릭 — 항등
      // viewport라 클라이언트 좌표가 그대로 PDF 좌표다.
      act(() => {
        result.current.handlePageMouseDown(
          1,
          identityViewport(),
          { left: 0, top: 0 },
          10,
          10,
        );
      });
      expect(result.current.popupProps?.existing?.id).toBe("existing1");

      act(() => {
        result.current.popupProps?.onPickColor("blue");
      });

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(
          "Couldn't save the highlight",
          "error",
        );
      });
    });

    it("logs and shows a toast when deleting fails to write the sidecar", async () => {
      readSidecar.mockResolvedValue({
        companion: "highlights/papers/attention.md",
        highlights: [HIGHLIGHT],
        pdf: "papers/attention.pdf",
        version: 1,
      });
      deleteHighlightById.mockRejectedValueOnce(new Error("permission denied"));

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      await waitFor(() =>
        expect(result.current.getPageHighlights(1)).toHaveLength(1),
      );
      act(() => {
        result.current.handlePageMouseDown(
          1,
          identityViewport(),
          { left: 0, top: 0 },
          10,
          10,
        );
      });

      act(() => {
        result.current.popupProps?.onDelete();
      });

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(
          "Couldn't save the highlight",
          "error",
        );
      });
    });

    it("logs and shows a toast when creating a fresh highlight fails to write", async () => {
      createTextHighlight.mockRejectedValueOnce(new Error("write_file failed"));

      const pageEl = document.createElement("div");
      pageEl.textContent = "Attention mechanisms allow modeling";
      document.body.appendChild(pageEl);

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      act(() => result.current.registerPageEl(1, pageEl));

      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());

      act(() => {
        result.current.popupProps?.onPickColor("green");
      });

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(
          "Couldn't save the highlight",
          "error",
        );
      });
    });
  });

  describe("§274 round 4 — every popup action closes the popup", () => {
    function renderWithFreshSelection() {
      const pageEl = document.createElement("div");
      pageEl.textContent = "Attention mechanisms allow modeling";
      document.body.appendChild(pageEl);

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      act(() => result.current.registerPageEl(1, pageEl));
      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      return result;
    }

    it("closes after picking a colour on a fresh selection", async () => {
      const result = renderWithFreshSelection();
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());

      act(() => {
        result.current.popupProps?.onPickColor("green");
      });

      expect(result.current.popupProps).toBeNull();
    });

    it("closes after copying text on a fresh selection", async () => {
      const result = renderWithFreshSelection();
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());

      act(() => {
        result.current.popupProps?.onCopyText();
      });

      expect(result.current.popupProps).toBeNull();
    });

    it("closes after deleting an existing highlight", async () => {
      readSidecar.mockResolvedValue({
        companion: "highlights/papers/attention.md",
        highlights: [HIGHLIGHT],
        pdf: "papers/attention.pdf",
        version: 1,
      });

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      await waitFor(() =>
        expect(result.current.getPageHighlights(1)).toHaveLength(1),
      );

      // 하이라이트의 rect(x:[0,100], y:[0,20]) 안의 점을 클릭.
      act(() => {
        result.current.handlePageMouseDown(
          1,
          identityViewport(),
          { left: 0, top: 0 },
          10,
          10,
        );
      });
      expect(result.current.popupProps?.existing?.id).toBe("existing1");

      act(() => {
        result.current.popupProps?.onDelete();
      });

      expect(result.current.popupProps).toBeNull();
    });
  });

  describe("G-5 — Copy reference/Copy text give a success affordance", () => {
    // §274.3 — Copy reference는 **이미 만들어진** 하이라이트에서만 노출되므로
    // (PdfSelectionPopup.tsx의 `existing &&`) 이 테스트도 그 팝업을 통해
    // 돌린다. 초안에서 부르던 예전 버전은 UI가 도달할 수 없는 경로를
    // 검증하고 있었다. 참조 문자열까지 함께 단정한다 — 토스트만 보면
    // "클립보드에 무엇이 갔는가"는 고정되지 않아, 살아 있는 유일한 경로가
    // 조용히 잘못된 id를 복사해도 초록불이 된다.
    it("shows a copied toast after Copy reference succeeds on an existing highlight", async () => {
      readSidecar.mockResolvedValue({
        companion: "highlights/papers/attention.md",
        highlights: [HIGHLIGHT],
        pdf: "papers/attention.pdf",
        version: 1,
      });
      // findBlockContent가 돌려주는 것은 `^id` 마커를 뗀 문단 본문이다.
      readHighlightBlockText.mockResolvedValue("Attention mechanisms");

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      await waitFor(() =>
        expect(result.current.getPageHighlights(1)).toHaveLength(1),
      );

      // 하이라이트의 rect(x:[0,100], y:[0,20]) 안의 점을 클릭 — 이것이
      // "existing" 팝업이 열리는 유일한 방법이다.
      act(() => {
        result.current.handlePageMouseDown(
          1,
          identityViewport(),
          { left: 0, top: 0 },
          10,
          10,
        );
      });
      expect(result.current.popupProps?.existing?.id).toBe("existing1");

      act(() => {
        result.current.popupProps?.onCopyRef();
      });

      await waitFor(() =>
        expect(showToast).toHaveBeenCalledWith("Copied to clipboard", "info"),
      );
      expect(readHighlightBlockText).toHaveBeenCalledWith(
        ABS_COMPANION,
        "existing1",
      );
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "((highlights/papers/attention#^existing1|Attention mechanisms))",
      );
    });

    it("shows a copied toast after Copy text succeeds", async () => {
      const pageEl = document.createElement("div");
      pageEl.textContent = "Attention mechanisms allow modeling";
      document.body.appendChild(pageEl);

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      act(() => result.current.registerPageEl(1, pageEl));
      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());

      act(() => {
        result.current.popupProps?.onCopyText();
      });

      await waitFor(() =>
        expect(showToast).toHaveBeenCalledWith("Copied to clipboard", "info"),
      );
    });
  });

  describe("defect B — clears the browser selection after a highlight is committed", () => {
    it("clears the native text selection once a colour is picked for a fresh selection", () => {
      const pageEl = document.createElement("div");
      pageEl.textContent = "Attention mechanisms allow modeling";
      document.body.appendChild(pageEl);

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      act(() => result.current.registerPageEl(1, pageEl));

      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      expect(result.current.popupProps).not.toBeNull();
      // 전제 확인 — 색을 고르기 전엔 진짜로 선택돼 있어야 한다.
      expect(window.getSelection()?.rangeCount).toBeGreaterThan(0);

      act(() => {
        result.current.popupProps?.onPickColor("green");
      });

      expect(window.getSelection()?.rangeCount).toBe(0);
    });

    it("does not reopen the popup when clearing the selection fires its own selectionchange", () => {
      // 실제 브라우저는 removeAllRanges() 뒤에 selectionchange를 스스로 한 번
      // 더 낸다(jsdom은 그렇지 않아 여기서 직접 흉내낸다) — 그 이벤트가
      // 방금 닫은 팝업을 재생성하면 회귀다. use-pdf-selection-popup.ts의
      // trySelectionPopup은 rangeCount===0이면 즉시 리턴하므로 열리지 않아야
      // 한다.
      const pageEl = document.createElement("div");
      pageEl.textContent = "Attention mechanisms allow modeling";
      document.body.appendChild(pageEl);

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      act(() => result.current.registerPageEl(1, pageEl));

      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      expect(result.current.popupProps).not.toBeNull();

      act(() => {
        result.current.popupProps?.onPickColor("green");
      });
      expect(result.current.popupProps).toBeNull();

      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      expect(result.current.popupProps).toBeNull();
    });
  });

  // §276.3.1 — clicking an EXISTING highlight must open its management
  // popup regardless of mode. This hook doesn't even take an "area mode"
  // parameter (only PdfPreview's mousedown routing knows about that), so
  // the only mode this level can vary is textModeActive — proving it here
  // for both values pins the property this hook is actually responsible
  // for: handlePageMouseDown's hit-test never consults textModeActive.
  describe("§276.3.1 existing-highlight management is mode-independent", () => {
    it.each([true, false])(
      "opens the management popup on hit when textModeActive is %s",
      async (textModeActive) => {
        readSidecar.mockResolvedValue({
          companion: "highlights/papers/attention.md",
          highlights: [HIGHLIGHT],
          pdf: "papers/attention.pdf",
          version: 1,
        });

        const { result } = renderHook(() =>
          usePdfHighlights({
            filePath: FILE_PATH,
            pages: [fakePage(1)],
            pagesReady: true,
            rootPath: ROOT,
            scale: 1,
            scrollToPage: vi.fn(),
            textModeActive,
          }),
        );
        await waitFor(() =>
          expect(result.current.getPageHighlights(1)).toHaveLength(1),
        );

        let hit: boolean | undefined;
        act(() => {
          hit = result.current.handlePageMouseDown(
            1,
            identityViewport(),
            { left: 0, top: 0 },
            10,
            10,
          );
        });
        expect(hit).toBe(true);
        expect(result.current.popupProps?.existing?.id).toBe("existing1");
      },
    );
  });

  describe("§276.3 area highlight wiring", () => {
    it("is disabled when the PDF is outside a vault (no rootPath)", () => {
      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: null,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      expect(result.current.highlightsEnabled).toBe(false);
    });

    it("is enabled inside a vault", () => {
      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      expect(result.current.highlightsEnabled).toBe(true);
    });

    it("onAreaHighlightDrawn opens a 'new' popup tagged highlightKind: area, with no Copy-text-only text field surprises", () => {
      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );

      act(() => {
        result.current.onAreaHighlightDrawn({
          anchor: { left: 5, top: 6 },
          pageNumber: 4,
          rects: [{ h: 200, w: 300, x: 10, y: 10 }],
          text: "Area highlight (page 4)",
        });
      });

      expect(result.current.popupProps?.highlightKind).toBe("area");
      expect(result.current.popupProps?.existing).toBeNull();
    });

    it("picking a colour on an area draft writes kind: 'area' to the sidecar", async () => {
      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );

      act(() => {
        result.current.onAreaHighlightDrawn({
          anchor: { left: 5, top: 6 },
          pageNumber: 4,
          rects: [{ h: 200, w: 300, x: 10, y: 10 }],
          text: "Area highlight (page 4)",
        });
      });

      act(() => {
        result.current.popupProps?.onPickColor("blue");
      });

      await waitFor(() => expect(createTextHighlight).toHaveBeenCalledTimes(1));
      expect(createTextHighlight).toHaveBeenCalledWith(
        expect.objectContaining({ color: "blue", kind: "area", page: 4 }),
      );
    });

    // §276.3 — an area highlight loaded from the sidecar hit-tests exactly
    // like a text one; no kind-specific branching in the mousedown routing.
    it("an area highlight in the sidecar is clickable via handlePageMouseDown", async () => {
      const AREA_HIGHLIGHT: StoredHighlight = {
        color: "green",
        id: "area1",
        kind: "area",
        page: 1,
        rects: [{ h: 100, w: 100, x: 0, y: 0 }],
      };
      readSidecar.mockResolvedValue({
        companion: "highlights/papers/attention.md",
        highlights: [AREA_HIGHLIGHT],
        pdf: "papers/attention.pdf",
        version: 1,
      });

      const { result } = renderHook(() =>
        usePdfHighlights({
          filePath: FILE_PATH,
          pages: [fakePage(1)],
          pagesReady: true,
          rootPath: ROOT,
          scale: 1,
          scrollToPage: vi.fn(),
          textModeActive: true,
        }),
      );
      await waitFor(() =>
        expect(result.current.getPageHighlights(1)).toHaveLength(1),
      );

      let hit: boolean | undefined;
      act(() => {
        hit = result.current.handlePageMouseDown(
          1,
          identityViewport(),
          { left: 0, top: 0 },
          10,
          10,
        );
      });
      expect(hit).toBe(true);
      expect(result.current.popupProps?.existing?.id).toBe("area1");
      expect(result.current.popupProps?.highlightKind).toBe("area");
    });
  });
});

/** pageEl의 텍스트 전체를 실제 Selection으로 선택한다(비어있지 않은, 접히지 않은 선택). */
function selectAllTextIn(pageEl: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(pageEl);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

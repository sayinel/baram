// §274 Fix round 1 — I1(조용한 실패 억제)/I2(중복 블록 생성) 회귀 테스트.
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

const {
  addHighlightForExistingBlock,
  createTextHighlight,
  deleteHighlightById,
  updateHighlightColor,
} = vi.hoisted(() => ({
  addHighlightForExistingBlock: vi.fn(),
  createTextHighlight: vi.fn(),
  deleteHighlightById: vi.fn(),
  updateHighlightColor: vi.fn(),
}));
vi.mock("../pdf-highlight-actions", () => ({
  addHighlightForExistingBlock,
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
    addHighlightForExistingBlock.mockResolvedValue({
      highlight: HIGHLIGHT,
      sidecar: {
        companion: "highlights/papers/attention.md",
        highlights: [HIGHLIGHT],
        pdf: "papers/attention.pdf",
        version: 1,
      },
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

  describe("I2 — Copy reference then colour-pick must not duplicate the note block", () => {
    it("reuses the block id Copy reference minted, even after the popup closes and reopens on a reselection", async () => {
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
        }),
      );
      act(() => result.current.registerPageEl(1, pageEl));

      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());
      expect(result.current.popupProps?.existing).toBeNull();

      // 1) Copy reference — 아직 블록이 없으니 새로 만든다.
      act(() => {
        result.current.popupProps?.onCopyRef();
      });
      await waitFor(() =>
        expect(appendHighlightBlock).toHaveBeenCalledTimes(1),
      );
      expect(appendHighlightBlock).toHaveBeenCalledWith(
        ABS_COMPANION,
        "Attention mechanisms allow modeling",
        "newblock1",
      );
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1),
      );

      // §274 round 4 — 팝업은 다른 세 액션과 똑같이 즉시 닫힌다.
      expect(result.current.popupProps).toBeNull();

      // 2) 같은 텍스트를 다시 선택한다 — 완전히 새로운 팝업 인스턴스지만,
      // pendingRefBlockCacheRef가 방금 만든 id를 기억하고 있어야 한다.
      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());

      // 3) 이 재선택된 팝업에서 색을 고른다 — createTextHighlight(새 id)가
      // 아니라 addHighlightForExistingBlock(방금 그 id)로 가야 한다.
      act(() => {
        result.current.popupProps?.onPickColor("purple");
      });
      await waitFor(() =>
        expect(addHighlightForExistingBlock).toHaveBeenCalledTimes(1),
      );

      expect(createTextHighlight).not.toHaveBeenCalled();
      expect(addHighlightForExistingBlock).toHaveBeenCalledWith(
        expect.objectContaining({ blockId: "newblock1", color: "purple" }),
      );
      // appendHighlightBlock은 여전히 딱 한 번 — 노트에 문단이 하나만 생겼다.
      expect(appendHighlightBlock).toHaveBeenCalledTimes(1);
      expect(generateBlockId).toHaveBeenCalledTimes(1);
    });

    it("evicts the cached id once it is consumed, so a later re-colour does not append a second sidecar entry sharing that id", async () => {
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
        }),
      );
      act(() => result.current.registerPageEl(1, pageEl));

      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());

      // 1) Copy reference — id를 민팅하고 캐시에 남긴다.
      act(() => {
        result.current.popupProps?.onCopyRef();
      });
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1),
      );

      // 2) 재선택 → 캐시 히트로 색을 고른다 — addHighlightForExistingBlock이
      // 그 id로 사이드카 하이라이트를 만든다. 성공하는 순간 캐시에서 그
      // 항목이 지워져야 한다(§274 round 4 설계).
      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());
      act(() => {
        result.current.popupProps?.onPickColor("purple");
      });
      await waitFor(() =>
        expect(addHighlightForExistingBlock).toHaveBeenCalledTimes(1),
      );

      // 3) 같은 텍스트를 또 재선택해 다시 색을 고른다 — 캐시가 지워져
      // 있었어야 하니 addHighlightForExistingBlock을 또 부르며 같은 id로
      // 두 번째 사이드카 항목을 만들면 안 된다. (createTextHighlight로
      // 가서 별개의 새 하이라이트를 만드는 것은 허용된다 — 오늘의 동작과
      // 같다.)
      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());
      act(() => {
        result.current.popupProps?.onPickColor("blue");
      });
      await waitFor(() => expect(createTextHighlight).toHaveBeenCalledTimes(1));
      // addHighlightForExistingBlock은 여전히 딱 한 번 — 캐시가 지워진
      // 덕분에 같은 id로 두 번째 사이드카 항목이 생기지 않았다.
      expect(addHighlightForExistingBlock).toHaveBeenCalledTimes(1);
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

    it("closes after copying a reference on a fresh selection", async () => {
      const result = renderWithFreshSelection();
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());

      act(() => {
        result.current.popupProps?.onCopyRef();
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

  describe("§274 round 4 — the pending block-id cache does not survive a document change", () => {
    it("mints a fresh block instead of reusing the previous PDF's id after switching documents", async () => {
      const pageEl = document.createElement("div");
      pageEl.textContent = "Attention mechanisms allow modeling";
      document.body.appendChild(pageEl);

      const { rerender, result } = renderHook(
        (props: { filePath: string }) =>
          usePdfHighlights({
            filePath: props.filePath,
            pages: [fakePage(1)],
            pagesReady: true,
            rootPath: ROOT,
            scale: 1,
            scrollToPage: vi.fn(),
          }),
        { initialProps: { filePath: FILE_PATH } },
      );
      act(() => result.current.registerPageEl(1, pageEl));

      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());

      // Copy reference on the FIRST document — mints and caches an id.
      act(() => {
        result.current.popupProps?.onCopyRef();
      });
      await waitFor(() =>
        expect(appendHighlightBlock).toHaveBeenCalledTimes(1),
      );
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1),
      );

      // Switch to a different PDF under the same vault.
      act(() => {
        rerender({ filePath: "/vault/papers/other.pdf" });
      });

      // Re-select the IDENTICAL text on the new document and pick a colour
      // straight away — must mint a fresh block, not reuse the first
      // document's cached id.
      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());

      act(() => {
        result.current.popupProps?.onPickColor("blue");
      });
      await waitFor(() => expect(createTextHighlight).toHaveBeenCalledTimes(1));
      expect(addHighlightForExistingBlock).not.toHaveBeenCalled();
    });
  });

  describe("B.2 — Copy reference guards its own double-click race", () => {
    it("does not append a second companion-note paragraph when clicked again before the first append resolves", async () => {
      // appendHighlightBlock을 사용자 제어로 미해결 상태에 붙잡아 둔다 —
      // popup.blockId는 이 창 내내 계속 null이라, 가드가 없으면 두 번째
      // 클릭이 두 번째 문단을 만든다.
      let resolveAppend: () => void = () => {};
      appendHighlightBlock.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveAppend = () => resolve(undefined);
          }),
      );

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
        }),
      );
      act(() => result.current.registerPageEl(1, pageEl));

      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());

      // §274 round 4 — onCopyRef가 이제 즉시 popup을 닫으므로, 두 번째
      // "클릭"을 흉내내려면 popupProps가 null이 되기 전에 같은 핸들러
      // 참조를 잡아 둬야 한다. 이건 실제 더블클릭과도 더 정확히 들어맞는다
      // — 진짜 더블클릭은 React가 팝업 제거를 커밋하기 전, 같은 DOM 버튼의
      // 같은 onClick 참조가 두 번 불리는 것이다.
      const onCopyRef = result.current.popupProps?.onCopyRef;
      expect(onCopyRef).toBeDefined();

      // 1) 첫 클릭 — append가 시작되지만 아직 안 끝났다. 팝업은 바로
      // 닫힌다(모든 액션의 공통 계약) — 이 가드가 막는 건 그것과 무관하게
      // in-flight append 자체다.
      act(() => onCopyRef?.());
      expect(appendHighlightBlock).toHaveBeenCalledTimes(1);
      expect(result.current.popupProps).toBeNull();

      // 2) 같은 핸들러를 또 부른다 — 가드가 없으면 여기서 두 번째
      // appendHighlightBlock이 나간다.
      act(() => onCopyRef?.());
      expect(appendHighlightBlock).toHaveBeenCalledTimes(1);
      expect(generateBlockId).toHaveBeenCalledTimes(1);

      // 첫 번째 append를 끝낸다 — 정상 경로는 계속 동작해야 한다(클립보드
      // 쓰기까지 끝남 = pendingRefBlockCacheRef에도 이 id가 채워졌다는 뜻,
      // 같은 then 체인의 연속 단계라서).
      act(() => resolveAppend());
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1),
      );
    });
  });

  describe("G-5 — Copy reference/Copy text give a success affordance", () => {
    it("shows a copied toast after Copy reference succeeds", async () => {
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
        }),
      );
      act(() => result.current.registerPageEl(1, pageEl));
      selectAllTextIn(pageEl);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      await waitFor(() => expect(result.current.popupProps).not.toBeNull());

      act(() => {
        result.current.popupProps?.onCopyRef();
      });

      await waitFor(() =>
        expect(showToast).toHaveBeenCalledWith("Copied to clipboard", "info"),
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
});

/** pageEl의 텍스트 전체를 실제 Selection으로 선택한다(비어있지 않은, 접히지 않은 선택). */
function selectAllTextIn(pageEl: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(pageEl);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

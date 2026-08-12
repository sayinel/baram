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
    it("reuses the block id Copy reference minted instead of appending a second paragraph", async () => {
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
      // 클립보드 쓰기까지 끝나야 setPopup(블록 id 채우기)도 끝났다고 볼 수
      // 있다 — 둘 다 같은 then 체인의 연속 단계라서.
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1),
      );

      // 팝업이 닫히지 않아야 한다 — 안 닫혀야 같은 선택에 이어서 색을 고를
      // 수 있다(§274 I2의 전제).
      expect(result.current.popupProps).not.toBeNull();

      // 2) 이어서 색을 고른다 — createTextHighlight(새 id)가 아니라
      // addHighlightForExistingBlock(방금 그 id)로 가야 한다.
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

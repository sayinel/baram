// §276.4/§276.5 usePdfHighlightRefPreview — the hook's own decisions, canvas-free.
//
// The area crop render itself is untestable here (jsdom has no canvas), so for
// that branch this file covers only what the hook decides BEFORE any pixel is
// touched: whether it starts work at all, and what it does with geometry it
// cannot draw. The text branch is fully exercised — it never touches pdfjs.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveHighlightRef } = vi.hoisted(() => ({
  resolveHighlightRef: vi.fn(),
}));
vi.mock("../pdf-highlight-ref-resolve", () => ({ resolveHighlightRef }));

const { withPdfDocument } = vi.hoisted(() => ({ withPdfDocument: vi.fn() }));
vi.mock("../pdf-doc-cache", () => ({ withPdfDocument }));

const { readCompanionTextCoalesced } = vi.hoisted(() => ({
  readCompanionTextCoalesced: vi.fn(),
}));
vi.mock("../pdf-companion-text-cache", () => ({ readCompanionTextCoalesced }));

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../../utils/logger", () => ({ logger }));

import { usePdfHighlightRefPreview } from "../use-pdf-highlight-ref-preview";

const HIGHLIGHT_TARGET = "highlights/papers/Attention";
const PLAIN_TARGET = "notes/Meeting";
const BLOCK_ID = "abc123";
const COMPANION = "/vault/highlights/papers/Attention.md";

/** buildRefDisplay가 80자에서 자르고 `( )`를 지우기 전의 원문. */
const FULL_TEXT =
  "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks (CNNs) that include an encoder and a decoder.";

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("usePdfHighlightRefPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveHighlightRef.mockResolvedValue(null);
    readCompanionTextCoalesced.mockResolvedValue(null);
  });

  it("stays idle for an ordinary block ref, with no state transition", async () => {
    // ‼️ This is what the `pdfRelPathForHighlightTarget` early return buys.
    // It is NOT about I/O — the resolver short-circuits on the same check, so
    // deleting the guard reads nothing either. What it prevents is every
    // block reference in every document firing LOADING -> UNAVAILABLE on
    // mount. Without the guard this lands on "unavailable", not "idle".
    const { result } = renderHook(() =>
      usePdfHighlightRefPreview(PLAIN_TARGET, BLOCK_ID),
    );
    await flush();

    expect(result.current.status).toBe("idle");
    expect(resolveHighlightRef).not.toHaveBeenCalled();
  });

  it("DOES start work for a highlights/ target (control for the test above)", async () => {
    // Without this control the idle assertion could pass simply because the
    // effect never ran in this harness. Same harness, same flush — only the
    // target differs, and here the status must move off "idle".
    const { result } = renderHook(() =>
      usePdfHighlightRefPreview(HIGHLIGHT_TARGET, BLOCK_ID),
    );
    await flush();

    expect(result.current.status).toBe("unavailable");
    expect(resolveHighlightRef).toHaveBeenCalledWith(
      HIGHLIGHT_TARGET,
      BLOCK_ID,
    );
  });

  it("reports unavailable when the ref resolves to nothing", async () => {
    const { result } = renderHook(() =>
      usePdfHighlightRefPreview(HIGHLIGHT_TARGET, BLOCK_ID),
    );
    await flush();

    expect(result.current).toEqual({
      height: 0,
      kind: "none",
      src: null,
      status: "unavailable",
      text: null,
      width: 0,
    });
  });

  it("logs and falls back to the chip when the stored geometry cannot be drawn", async () => {
    // 사이드카가 Infinity 좌표를 담고 있는 경우(§isPdfRect가 통과시킨다):
    // convertToViewportPoint가 NaN을 내고 computeAreaCropLayout이 null을
    // 돌려준다. 조용히 칩으로 떨어지면 사이드카가 상했다는 진단이 어디에도
    // 남지 않으므로 logger가 반드시 불려야 한다.
    resolveHighlightRef.mockResolvedValue({
      absPdfPath: "/vault/papers/Attention.pdf",
      kind: "area",
      page: 3,
      rect: { h: 40, w: 120, x: 10, y: 20 },
    });
    const page = {
      getViewport: () => ({
        convertToPdfPoint: () => [0, 0],
        // 회전 행렬의 0 성분 × Infinity = NaN — 실제 경로가 만드는 값.
        convertToViewportPoint: () => [NaN, NaN],
      }),
      render: vi.fn(),
    };
    withPdfDocument.mockImplementation(
      async (_path: string, fn: (doc: unknown) => Promise<unknown>) =>
        fn({ getPage: async () => page }),
    );

    const { result } = renderHook(() =>
      usePdfHighlightRefPreview(HIGHLIGHT_TARGET, BLOCK_ID),
    );
    await flush();

    expect(result.current.status).toBe("unavailable");
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][0])).toContain(BLOCK_ID);
    // 그릴 수 없다고 판단했으면 렌더는 시도조차 하지 않아야 한다.
    expect(page.render).not.toHaveBeenCalled();
  });

  describe("text highlights (§276.5)", () => {
    beforeEach(() => {
      resolveHighlightRef.mockResolvedValue({
        absCompanionPath: COMPANION,
        kind: "text",
      });
      readCompanionTextCoalesced.mockResolvedValue(FULL_TEXT);
    });

    it("returns the full original text from the companion note", async () => {
      const { result } = renderHook(() =>
        usePdfHighlightRefPreview(HIGHLIGHT_TARGET, BLOCK_ID),
      );
      await flush();

      expect(result.current).toEqual({
        height: 0,
        kind: "text",
        src: null,
        status: "ready",
        text: FULL_TEXT,
        width: 0,
      });
      expect(readCompanionTextCoalesced).toHaveBeenCalledWith(
        COMPANION,
        BLOCK_ID,
      );
    });

    it("‼️ never loads the PDF for a text ref", async () => {
      // withPdfDocument is what performs the pdfjs dynamic import (and the
      // worker parse). A text highlight needs one line of a markdown file;
      // pulling pdfjs in for it would make every text ref in a note as
      // expensive as an area crop.
      renderHook(() => usePdfHighlightRefPreview(HIGHLIGHT_TARGET, BLOCK_ID));
      await flush();

      expect(withPdfDocument).not.toHaveBeenCalled();
    });

    it("reports unavailable when the companion note has no such block", async () => {
      readCompanionTextCoalesced.mockResolvedValue(null);

      const { result } = renderHook(() =>
        usePdfHighlightRefPreview(HIGHLIGHT_TARGET, BLOCK_ID),
      );
      await flush();

      expect(result.current.status).toBe("unavailable");
      expect(result.current.text).toBeNull();
    });

    it.each([
      ["empty", ""],
      ["whitespace only", "   \t "],
    ])(
      "‼️ reports unavailable for a %s paragraph rather than drawing an empty chip",
      async (_label, stored) => {
        // 판별력: `text.trim().length > 0` 검사를 지우면 status가 "ready"가
        // 되고 NodeView가 빈 칩을 그린다 — 클릭할 글자조차 없는 참조가 된다.
        // display 라벨로 떨어지는 편이 언제나 낫다.
        readCompanionTextCoalesced.mockResolvedValue(stored);

        const { result } = renderHook(() =>
          usePdfHighlightRefPreview(HIGHLIGHT_TARGET, BLOCK_ID),
        );
        await flush();

        expect(result.current.status).toBe("unavailable");
        expect(result.current.kind).toBe("none");
      },
    );

    it("does not throw when the companion read rejects", async () => {
      // 합류 모듈이 실패를 null로 접지만, 그 계약이 깨져도 이 훅은 칩으로
      // 떨어져야 한다 — 떠도는 rejection은 main.tsx가 삼켜 흔적이 남지 않는다.
      readCompanionTextCoalesced.mockRejectedValue(new Error("read failed"));

      const { result } = renderHook(() =>
        usePdfHighlightRefPreview(HIGHLIGHT_TARGET, BLOCK_ID),
      );
      await flush();

      expect(result.current.status).toBe("unavailable");
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});

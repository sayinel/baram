// §276.4 usePdfAreaRefPreview — the hook's own decisions, canvas-free.
//
// The crop render itself is untestable here (jsdom has no canvas), so this
// file covers only what the hook decides BEFORE any pixel is touched: whether
// it starts work at all, and what it does with geometry it cannot draw.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveAreaHighlightRef } = vi.hoisted(() => ({
  resolveAreaHighlightRef: vi.fn(),
}));
vi.mock("../pdf-area-ref-resolve", () => ({ resolveAreaHighlightRef }));

const { withPdfDocument } = vi.hoisted(() => ({ withPdfDocument: vi.fn() }));
vi.mock("../pdf-doc-cache", () => ({ withPdfDocument }));

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../../utils/logger", () => ({ logger }));

import { usePdfAreaRefPreview } from "../use-pdf-area-ref-preview";

const AREA_TARGET = "highlights/papers/Attention";
const PLAIN_TARGET = "notes/Meeting";
const BLOCK_ID = "abc123";

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("usePdfAreaRefPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAreaHighlightRef.mockResolvedValue(null);
  });

  it("stays idle for an ordinary block ref, with no state transition", async () => {
    // ‼️ This is what the `pdfRelPathForHighlightTarget` early return buys.
    // It is NOT about I/O — the resolver short-circuits on the same check, so
    // deleting the guard reads nothing either. What it prevents is every
    // block reference in every document firing LOADING -> UNAVAILABLE on
    // mount. Without the guard this lands on "unavailable", not "idle".
    const { result } = renderHook(() =>
      usePdfAreaRefPreview(PLAIN_TARGET, BLOCK_ID),
    );
    await flush();

    expect(result.current.status).toBe("idle");
    expect(resolveAreaHighlightRef).not.toHaveBeenCalled();
  });

  it("DOES start work for a highlights/ target (control for the test above)", async () => {
    // Without this control the idle assertion could pass simply because the
    // effect never ran in this harness. Same harness, same flush — only the
    // target differs, and here the status must move off "idle".
    const { result } = renderHook(() =>
      usePdfAreaRefPreview(AREA_TARGET, BLOCK_ID),
    );
    await flush();

    expect(result.current.status).toBe("unavailable");
    expect(resolveAreaHighlightRef).toHaveBeenCalledWith(AREA_TARGET, BLOCK_ID);
  });

  it("reports unavailable when the ref resolves to nothing", async () => {
    const { result } = renderHook(() =>
      usePdfAreaRefPreview(AREA_TARGET, BLOCK_ID),
    );
    await flush();

    expect(result.current).toEqual({
      height: 0,
      src: null,
      status: "unavailable",
      width: 0,
    });
  });

  it("logs and falls back to the chip when the stored geometry cannot be drawn", async () => {
    // 사이드카가 Infinity 좌표를 담고 있는 경우(§isPdfRect가 통과시킨다):
    // convertToViewportPoint가 NaN을 내고 computeAreaCropLayout이 null을
    // 돌려준다. 조용히 칩으로 떨어지면 사이드카가 상했다는 진단이 어디에도
    // 남지 않으므로 logger가 반드시 불려야 한다.
    resolveAreaHighlightRef.mockResolvedValue({
      absPdfPath: "/vault/papers/Attention.pdf",
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
      usePdfAreaRefPreview(AREA_TARGET, BLOCK_ID),
    );
    await flush();

    expect(result.current.status).toBe("unavailable");
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][0])).toContain(BLOCK_ID);
    // 그릴 수 없다고 판단했으면 렌더는 시도조차 하지 않아야 한다.
    expect(page.render).not.toHaveBeenCalled();
  });
});

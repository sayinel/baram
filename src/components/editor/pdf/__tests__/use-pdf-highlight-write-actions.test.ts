// §277.2 R1 — 사이드카 쓰기 줄(queueSidecarWrite)의 두 성질.
//
// ‼️ 왜 use-pdf-highlights.test.ts에서 못 잡는가: 그쪽은 훅을 합성해 돌리므로
// setSidecar가 실제 React 상태를 바꾸고, act()가 두 쓰기 사이에서 그 커밋을
// 흘려보낸다. 그러면 "직전 쓰기의 결과에서 조립한다"와 "그때그때 React 상태에서
// 조립한다"가 **같은 답**을 낸다 — 뮤테이션이 살아남는 것이 그 증거다.
// (실제 앱에는 그 act()가 없다. 줄의 다음 단계는 마이크로태스크에서 도는데
// React가 그 전에 커밋했다는 보장이 없으므로, 스냅샷에서 조립하면 두 번째
// 쓰기가 첫 번째를 되돌린다.)
//
// 그래서 여기서는 이 훅만 직접 렌더하고 **setSidecar가 sidecar prop을 되먹이지
// 않게** 둔다. 그러면 갱신된 값의 출처가 줄이 이어 나른 값밖에 없다.
import type { Sidecar, StoredHighlight } from "../pdf-highlight-sidecar";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { purgeHighlightById, restoreHighlightById } = vi.hoisted(() => ({
  purgeHighlightById: vi.fn(),
  restoreHighlightById: vi.fn(),
}));
vi.mock("../pdf-highlight-actions", () => ({
  createTextHighlight: vi.fn(),
  purgeHighlightById,
  restoreHighlightById,
  softDeleteHighlightById: vi.fn(),
  updateHighlightColor: vi.fn(),
}));
vi.mock("../pdf-highlight-store", () => ({ readHighlightBlockText: vi.fn() }));
vi.mock("../pdf-highlight-ref-count", () => ({
  countHighlightRefs: vi.fn(async () => 0),
}));
vi.mock("../../../../utils/confirm-dialog", () => ({
  showConfirm: vi.fn(async () => true),
}));
vi.mock("../../../../stores/ui/ui", () => ({
  useUIStore: { getState: () => ({ showToast: vi.fn() }) },
}));
vi.mock("../../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import { usePdfHighlightWriteActions } from "../use-pdf-highlight-write-actions";

const PATH_A = "/vault/.baram/pdf-highlights/a.json";
const PATH_B = "/vault/.baram/pdf-highlights/b.json";

function deleted(id: string): StoredHighlight {
  return {
    color: "yellow",
    deletedAt: "2026-08-17T00:00:00.000Z",
    id,
    kind: "text",
    page: 1,
    rects: [{ h: 1, w: 1, x: 0, y: 0 }],
  };
}

/** sidecar prop을 **고정**해 렌더한다 — setSidecar는 기록만 하고 되먹이지 않는다. */
function renderFrozen(absSidecarPath: null | string, sidecar: null | Sidecar) {
  const setSidecar = vi.fn();
  const view = renderHook(
    (props: { absSidecarPath: null | string; sidecar: null | Sidecar }) =>
      usePdfHighlightWriteActions({
        absCompanionPath: "/vault/highlights/a.md",
        absSidecarPath: props.absSidecarPath,
        pdfRelPath: "a.pdf",
        popup: null,
        setPopup: vi.fn(),
        setSidecar,
        sidecar: props.sidecar,
        target: "highlights/a",
      }),
    { initialProps: { absSidecarPath, sidecar } },
  );
  return { ...view, setSidecar };
}

function sidecarFor(pdf: string, ids: string[]): Sidecar {
  return {
    companion: `highlights/${pdf}.md`,
    highlights: ids.map(deleted),
    pdf: `${pdf}.pdf`,
    version: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("queueSidecarWrite", () => {
  it("hands the second write the FIRST write's result, not the render-time snapshot", async () => {
    const initial = sidecarFor("a", ["h1", "h2"]);
    const afterFirst: Sidecar = {
      ...initial,
      highlights: [
        { ...initial.highlights[0], deletedAt: undefined },
        deleted("h2"),
      ],
    };
    restoreHighlightById.mockResolvedValueOnce(afterFirst);
    restoreHighlightById.mockResolvedValueOnce(afterFirst);
    const { result } = renderFrozen(PATH_A, initial);

    act(() => {
      result.current.onRestoreHighlight("h1");
    });
    act(() => {
      result.current.onRestoreHighlight("h2");
    });

    await waitFor(() => {
      expect(restoreHighlightById).toHaveBeenCalledTimes(2);
    });
    // 첫 번째는 렌더 시점의 값에서 출발한다 — 줄이 비어 있었으므로.
    expect(restoreHighlightById.mock.calls[0][1]).toBe(initial);
    // ‼️ 두 번째는 **첫 번째의 결과**여야 한다. sidecar prop은 내내 initial로
    // 고정돼 있으므로, 이 값이 afterFirst라는 사실의 출처는 줄뿐이다.
    expect(restoreHighlightById.mock.calls[1][1]).toBe(afterFirst);
  });

  it("does not start the second write until the first has settled", async () => {
    let finishFirst: (s: Sidecar) => void = () => undefined;
    restoreHighlightById.mockReturnValueOnce(
      new Promise<Sidecar>((resolve) => {
        finishFirst = resolve;
      }),
    );
    const initial = sidecarFor("a", ["h1", "h2"]);
    const { result } = renderFrozen(PATH_A, initial);

    act(() => {
      result.current.onRestoreHighlight("h1");
    });
    act(() => {
      result.current.onRestoreHighlight("h2");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(restoreHighlightById).toHaveBeenCalledTimes(1);

    const afterFirst = sidecarFor("a", ["h2"]);
    restoreHighlightById.mockResolvedValueOnce(afterFirst);
    await act(async () => {
      finishFirst(afterFirst);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(restoreHighlightById).toHaveBeenCalledTimes(2);
  });

  // ‼️ 문서가 바뀌면 줄을 새로 시작해야 한다. 안 그러면 A 문서의 사이드카가
  // 이어져 내려와 **B 문서의 파일에 A의 내용이 써진다** — 서로 다른 PDF의
  // 하이라이트가 뒤섞이는, 조용하고 되돌리기 어려운 데이터 손상이다.
  it("starts a fresh chain when the document changes", async () => {
    const a = sidecarFor("a", ["h1"]);
    const afterA = sidecarFor("a", []);
    restoreHighlightById.mockResolvedValueOnce(afterA);
    const { rerender, result } = renderFrozen(PATH_A, a);

    act(() => {
      result.current.onRestoreHighlight("h1");
    });
    await waitFor(() => {
      expect(restoreHighlightById).toHaveBeenCalledTimes(1);
    });

    const b = sidecarFor("b", ["z9"]);
    act(() => {
      rerender({ absSidecarPath: PATH_B, sidecar: b });
    });
    restoreHighlightById.mockResolvedValueOnce(sidecarFor("b", []));
    act(() => {
      result.current.onRestoreHighlight("z9");
    });

    await waitFor(() => {
      expect(restoreHighlightById).toHaveBeenCalledTimes(2);
    });
    expect(restoreHighlightById.mock.calls[1][0]).toBe(PATH_B);
    // A의 결과를 이어받았다면 여기가 afterA다 — 그러면 B의 파일에 A의
    // 하이라이트가 써진다.
    expect(restoreHighlightById.mock.calls[1][1]).toBe(b);
  });

  it("keeps serving later writes after one fails", async () => {
    restoreHighlightById.mockRejectedValueOnce(new Error("disk full"));
    const initial = sidecarFor("a", ["h1", "h2"]);
    restoreHighlightById.mockResolvedValueOnce(sidecarFor("a", ["h1"]));
    const { result } = renderFrozen(PATH_A, initial);

    act(() => {
      result.current.onRestoreHighlight("h1");
    });
    act(() => {
      result.current.onRestoreHighlight("h2");
    });

    await waitFor(() => {
      expect(restoreHighlightById).toHaveBeenCalledTimes(2);
    });
    // 실패한 단계는 이어 나를 값이 없으므로 다음 단계는 React 상태에서
    // 다시 출발한다.
    expect(restoreHighlightById.mock.calls[1][1]).toBe(initial);
  });

  // ‼️ 아무것도 하지 않은 단계가 **이어 나르던 값을 지우면 안 된다.**
  // 지우면 그 다음 쓰기가 React 스냅샷에서 다시 출발하고, 커밋이 아직이면
  // 앞선 쓰기를 되돌린다 — 줄을 만든 이유가 그대로 무너진다.
  //
  // 도달 가능한 no-op은 "사이드카에 없는 id를 완전 삭제"뿐이다(확인까지 받고도
  // 지울 것이 없는 경우).
  it("a no-op step does not wipe the value the queue is carrying", async () => {
    const initial = sidecarFor("a", ["h1", "h2"]);
    const afterFirst = sidecarFor("a", ["h2"]);
    restoreHighlightById.mockResolvedValueOnce(afterFirst);
    const { result } = renderFrozen(PATH_A, initial);

    act(() => {
      result.current.onRestoreHighlight("h1");
    });
    await waitFor(() => {
      expect(restoreHighlightById).toHaveBeenCalledTimes(1);
    });

    // 그 사이에 아무 일도 하지 않는 단계가 하나 지나간다.
    act(() => {
      result.current.onPurgeHighlight("not-in-the-sidecar");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(purgeHighlightById).not.toHaveBeenCalled();

    restoreHighlightById.mockResolvedValueOnce(sidecarFor("a", []));
    act(() => {
      result.current.onRestoreHighlight("h2");
    });

    await waitFor(() => {
      expect(restoreHighlightById).toHaveBeenCalledTimes(2);
    });
    expect(restoreHighlightById.mock.calls[1][1]).toBe(afterFirst);
  });

  it("only calls setSidecar for writes that produced something", async () => {
    const { result } = renderFrozen(PATH_A, sidecarFor("a", ["h1"]));

    // 사이드카에 없는 id — apply가 null을 돌려주는 유일한 경로다.
    act(() => {
      result.current.onPurgeHighlight("nope");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(purgeHighlightById).not.toHaveBeenCalled();
    expect(result.current).toBeDefined();
  });
});

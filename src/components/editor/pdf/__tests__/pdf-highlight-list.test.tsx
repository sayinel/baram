// §282.2 하이라이트 목록 — 데이터 합류, 순서, 클릭 점프.
import type { PdfRect } from "../pdf-highlight-geom";
import type { StoredHighlight } from "../pdf-highlight-sidecar";
import type { PDFPageProxy } from "pdfjs-dist";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLinkStore } from "../../../../stores/editor/link";
import { PdfPageRetention } from "../pdf-page-retention";
import { PdfHighlightList } from "../PdfHighlightList";
import { usePdfHighlightList } from "../use-pdf-highlight-list";

const readCompanion = vi.fn();
vi.mock("../pdf-highlight-store", () => ({
  readCompanionNoteContent: (path: string) => readCompanion(path),
}));

function hl(
  id: string,
  page: number,
  y: number,
  kind: "area" | "text" = "text",
): StoredHighlight {
  return { color: "yellow", id, kind, page, rects: [rect(0, y)] };
}

function makePages(count: number): PDFPageProxy[] {
  return Array.from(
    { length: count },
    (_, i) =>
      ({
        // ‼️ 항등 변환은 실제 뷰포트가 아니다 — 진짜 뷰포트는 y축을 뒤집는다
        // (PDF는 y가 위로, 화면은 아래로 증가). 항등으로 두면 정렬 테스트가
        // 거꾸로 통과하거나 실패해서 아무것도 고정하지 못한다.
        getViewport: ({ scale }: { scale: number }) => ({
          convertToPdfPoint: (x: number, y: number) => [x, 792 * scale - y],
          convertToViewportPoint: (x: number, y: number) => [
            x * scale,
            (792 - y) * scale,
          ],
          height: 792 * scale,
          scale,
          width: 612 * scale,
        }),
        cleanup: vi.fn(() => true),
        pageNumber: i + 1,
        render: () => ({ cancel: vi.fn(), promise: Promise.resolve() }),
      }) as unknown as PDFPageProxy,
  );
}

function rect(x: number, y: number, w = 100, h = 10): PdfRect {
  return { h, w, x, y };
}

function setup(
  overrides: Partial<Parameters<typeof PdfHighlightList>[0]> = {},
) {
  const props = {
    absCompanionPath: "/vault/highlights/paper.md",
    flashHighlightId: null,
    highlights: [hl("a", 1, 700)],
    pages: makePages(3),
    retention,
    ...overrides,
  };
  render(<PdfHighlightList {...props} />);
  return props;
}

// §282.3 렌더 캐시 보관 레지스트리 — 테스트마다 새로 만든다. **한 테스트 안에서는
// 같은 인스턴스**여야 한다: memo/effect deps 테스트가 리렌더 사이에 prop 신원이
// 유지된다는 전제 위에 서 있어서, 렌더할 때마다 새로 만들면 그 테스트들이
// 아무것도 고정하지 못한 채 통과한다.
let retention: PdfPageRetention;
beforeEach(() => {
  retention = new PdfPageRetention();
});

beforeEach(() => {
  readCompanion.mockReset();
  readCompanion.mockResolvedValue("");
  useLinkStore.getState().setPendingPdfHighlightId(null);
});

describe("PdfHighlightList", () => {
  it("shows an empty state when the PDF has no highlights", () => {
    setup({ highlights: [] });
    expect(document.querySelector(".pdf-highlight-list-empty")).not.toBeNull();
  });

  it("renders one row per highlight", async () => {
    setup({ highlights: [hl("a", 1, 700), hl("b", 2, 600)] });
    await waitFor(() => {
      expect(screen.getAllByRole("button")).toHaveLength(2);
    });
  });

  // 사이드카는 생성 순서로 쌓인다 — 목록은 읽는 순서여야 한다.
  it("lists highlights in reading order, not sidecar order", async () => {
    setup({
      highlights: [
        hl("later-page", 2, 700),
        hl("lower", 1, 100),
        hl("upper", 1, 700),
      ],
    });
    await waitFor(() => {
      expect(screen.getAllByRole("button")).toHaveLength(3);
    });
    const ids = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("data-pdf-highlight-id"));
    expect(ids).toEqual(["upper", "lower", "later-page"]);
  });

  // 원문은 사이드카에 없다(§273.2) — 동반 노트의 ` ^id` 문단이 유일한 보관처다.
  it("pulls each row's text out of the companion note", async () => {
    readCompanion.mockResolvedValue(
      "attention is all you need ^a\n\nsecond quote ^b\n",
    );
    setup({ highlights: [hl("a", 1, 700), hl("b", 1, 600)] });

    expect(
      await screen.findByText("attention is all you need"),
    ).toBeInTheDocument();
    expect(await screen.findByText("second quote")).toBeInTheDocument();
  });

  // 하이라이트가 N개라도 파일은 한 번만 읽는다.
  it("reads the companion note once for the whole list", async () => {
    readCompanion.mockResolvedValue("one ^a\n\ntwo ^b\n\nthree ^c\n");
    setup({ highlights: [hl("a", 1, 700), hl("b", 1, 600), hl("c", 1, 500)] });

    await screen.findByText("three");
    expect(readCompanion).toHaveBeenCalledTimes(1);
  });

  // 그림 위에 그은 영역 하이라이트는 그 아래 텍스트가 없다 —
  // appendHighlightBlock이 쓴 문단은 ` ^id`뿐이고 findBlockContent는 ""를
  // 돌려준다. 그것을 텍스트로 취급하면 빈 span이 줄 높이만 차지한다.
  // (이 성질은 훅에 있으므로 **목록 수준**에서 단정해야 한다 — 항목에
  // text: null을 직접 넘기는 테스트는 훅을 전혀 거치지 않아 아무것도 고정하지
  // 못한다. 실제로 그 형태의 뮤테이션이 한 번 살아남았다.)
  it("treats a whitespace-only companion paragraph as no text", async () => {
    readCompanion.mockResolvedValue(" ^figure\n");
    setup({ highlights: [hl("figure", 1, 700, "area")] });

    await screen.findByRole("button");
    expect(document.querySelector(".pdf-highlight-item-text")).toBeNull();
  });

  // 읽기 실패로 목록을 죽이면 사용자는 하이라이트가 사라졌다고 읽는다 —
  // 사이드카가 이미 페이지·색·기하를 주므로 목록은 여전히 쓸모 있다.
  it("still lists the highlights when the companion note cannot be read", async () => {
    readCompanion.mockRejectedValue(new Error("permission denied"));
    setup({ highlights: [hl("a", 1, 700), hl("b", 1, 600)] });

    await waitFor(() => {
      expect(screen.getAllByRole("button")).toHaveLength(2);
    });
  });

  // ‼️ 클릭은 새 점프 경로를 만들지 않는다 — 노트의 블록 참조를 클릭했을 때
  // 쓰는 그 스토어 값을 세우고, usePdfHighlightFlash가 이어받는다(§275.6).
  it("hands the click to the existing block-ref jump path", async () => {
    setup({ highlights: [hl("target", 2, 700)] });
    await userEvent.click(await screen.findByRole("button"));

    expect(useLinkStore.getState().pendingPdfHighlightId).toBe("target");
  });

  it("marks the highlight that was just jumped to", async () => {
    setup({
      flashHighlightId: "b",
      highlights: [hl("a", 1, 700), hl("b", 1, 600)],
    });
    await waitFor(() => {
      expect(
        document.querySelectorAll(".pdf-highlight-item.flashing"),
      ).toHaveLength(1);
    });
    expect(
      document
        .querySelector(".pdf-highlight-item.flashing")
        ?.getAttribute("data-pdf-highlight-id"),
    ).toBe("b");
  });

  // ‼️ PdfHighlightListItem을 React.memo로 감싸도 `item`의 신원이 매 렌더
  // 바뀌면 memo가 항상 통과해 아무 효과가 없다. 그 성질은 컴포넌트가 아니라
  // **훅의 반환값**에 있으므로 여기서 단정한다 — 항목 수준에서 재렌더를
  // 세는 테스트는 이 뮤테이션을 놓친다(실제로 놓쳤다).
  it("returns a stable item array across re-renders with unchanged inputs", async () => {
    readCompanion.mockResolvedValue("one ^a\n\ntwo ^b\n");
    const highlights = [hl("a", 1, 700), hl("b", 1, 600)];
    const seen: unknown[] = [];

    function Harness() {
      seen.push(usePdfHighlightList(highlights, "/vault/highlights/paper.md"));
      return null;
    }

    const view = render(<Harness />);
    await waitFor(() => {
      expect(seen.length).toBeGreaterThan(1);
    });
    const settled = seen.at(-1);

    view.rerender(<Harness />);

    expect(seen.at(-1)).toBe(settled);
  });

  it("does not read anything outside a vault", async () => {
    setup({ absCompanionPath: null, highlights: [hl("a", 1, 700)] });
    await waitFor(() => {
      expect(screen.getAllByRole("button")).toHaveLength(1);
    });
    expect(readCompanion).not.toHaveBeenCalled();
  });
});

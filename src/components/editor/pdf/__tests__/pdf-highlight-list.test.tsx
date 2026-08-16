// §282.2 하이라이트 목록 — 데이터 합류, 순서, 클릭 점프.
import type { PdfRect } from "../pdf-highlight-geom";
import type { StoredHighlight } from "../pdf-highlight-sidecar";
import type { PDFPageProxy } from "pdfjs-dist";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLinkStore } from "../../../../stores/editor/link";
import { PdfHighlightList } from "../PdfHighlightList";

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
        getViewport: ({ scale }: { scale: number }) => ({
          convertToPdfPoint: (x: number, y: number) => [x, y],
          convertToViewportPoint: (x: number, y: number) => [x, y],
          height: 792 * scale,
          scale,
          width: 612 * scale,
        }),
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
    ...overrides,
  };
  render(<PdfHighlightList {...props} />);
  return props;
}

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

  it("does not read anything outside a vault", async () => {
    setup({ absCompanionPath: null, highlights: [hl("a", 1, 700)] });
    await waitFor(() => {
      expect(screen.getAllByRole("button")).toHaveLength(1);
    });
    expect(readCompanion).not.toHaveBeenCalled();
  });
});

// §282.2 하이라이트 목록 — 데이터 합류, 순서, 클릭 점프.
import type { PdfRect } from "../pdf-highlight-geom";
import type { StoredHighlight } from "../pdf-highlight-sidecar";
import type { PDFPageProxy } from "pdfjs-dist";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLinkStore } from "../../../../stores/editor/link";
import { PDF_RAIL_DEFAULT_WIDTH_PX } from "../../../../utils/pdf-rail-width";
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
    onPurgeHighlight: vi.fn(),
    onRestoreHighlight: vi.fn(),
    pages: makePages(3),
    railRasterWidth: PDF_RAIL_DEFAULT_WIDTH_PX,
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

// §277.2 목록이 아카이브의 집이다 — 삭제된 하이라이트를 다시 볼 수단이
// 없으면 사용자는 되돌릴 수도, 정말로 지울 수도 없고 사이드카가 아무도 못
// 보는 채로 무한히 자란다.
describe("§277.2 deleted highlights", () => {
  function deleted(id: string, page = 1, y = 700): StoredHighlight {
    return { ...hl(id, page, y), deletedAt: "2026-08-17T01:23:45.000Z" };
  }

  function gone(id: string, page = 1, y = 700): StoredHighlight {
    return deleted(id, page, y);
  }

  /** setup()과 달리 rerender를 돌려준다 — 복원/완전 삭제 뒤 부모가 새
   * 사이드카를 내려주는 것을 재현해야 하는 테스트가 있다. */
  function renderList(highlights: StoredHighlight[]) {
    const props = {
      absCompanionPath: "/vault/highlights/paper.md",
      flashHighlightId: null,
      onPurgeHighlight: vi.fn(),
      onRestoreHighlight: vi.fn(),
      pages: makePages(3),
      railRasterWidth: PDF_RAIL_DEFAULT_WIDTH_PX,
      retention,
    };
    const view = render(
      <PdfHighlightList {...props} highlights={highlights} />,
    );
    return {
      ...props,
      rerender: (next: StoredHighlight[]) =>
        view.rerender(<PdfHighlightList {...props} highlights={next} />),
    };
  }

  // ‼️ queryAllByRole다 — getAllByRole은 빈 목록에서 **던지므로**
  // `expect(rows()).toEqual([])`를 아예 쓸 수 없다. 갈래가 비었다는 것을
  // 직접 단정할 수 있어야 한다.
  function rows(): string[] {
    return screen
      .queryAllByRole("button")
      .map((b) => b.getAttribute("data-pdf-highlight-id"))
      .filter((v): v is string => v !== null);
  }

  it("shows only the live highlights by default", async () => {
    setup({ highlights: [hl("live", 1, 700), deleted("gone", 1, 600)] });
    await waitFor(() => expect(rows()).toEqual(["live"]));
  });

  it("counts each branch on its own tab", async () => {
    setup({
      highlights: [
        hl("live", 1, 700),
        deleted("g1", 1, 600),
        deleted("g2", 2, 500),
      ],
    });
    await waitFor(() => expect(rows()).toEqual(["live"]));

    expect(screen.getByTestId("pdf-highlight-view-active")).toHaveTextContent(
      "1",
    );
    expect(screen.getByTestId("pdf-highlight-view-deleted")).toHaveTextContent(
      "2",
    );
  });

  it("switches to the deleted branch and shows exactly those", async () => {
    setup({ highlights: [hl("live", 1, 700), deleted("gone", 1, 600)] });
    await waitFor(() => expect(rows()).toEqual(["live"]));

    await userEvent.click(screen.getByTestId("pdf-highlight-view-deleted"));

    await waitFor(() => expect(rows()).toEqual(["gone"]));
  });

  // 갈래를 바꾸는 것만으로 컨트롤이 나타났다 사라졌다 하면 안 된다 — 마지막
  // 항목을 복원한 순간 지금 보고 있던 화면이 발밑에서 없어진다.
  it("keeps both branches reachable even when one is empty", () => {
    setup({ highlights: [hl("live", 1, 700)] });
    expect(
      screen.getByTestId("pdf-highlight-view-deleted"),
    ).toBeInTheDocument();
  });

  it("shows a branch-specific empty state", async () => {
    setup({ highlights: [hl("live", 1, 700)] });
    await userEvent.click(screen.getByTestId("pdf-highlight-view-deleted"));

    expect(
      document.querySelector(".pdf-highlight-list-empty"),
    ).toHaveTextContent("No deleted highlights");
  });

  // 액션은 삭제된 갈래에만 있다. 활성 목록에 "복원"이 보이면 무엇을
  // 복원한다는 것인지 설명할 수 없다.
  it("offers no restore/delete actions in the active branch", async () => {
    setup({ highlights: [hl("live", 1, 700), deleted("gone", 1, 600)] });
    await waitFor(() => expect(rows()).toEqual(["live"]));

    expect(screen.queryByText("Restore")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete permanently")).not.toBeInTheDocument();
  });

  // 마지막 남은 삭제 항목을 복원하면 그 갈래가 빈다. 사용자를 활성 갈래로
  // 자동으로 옮기지 **않는다** — 직접 고른 화면을 앱이 바꾸는 것도 똑같이
  // 놀라운 일이고, 빈 상태 문구가 무슨 일이 일어났는지 이미 설명한다.
  // 두 갈래가 항상 보이므로 돌아갈 길도 그대로 있다.
  it("stays on the deleted branch with an empty state after the last item is restored", async () => {
    const { rerender } = renderList([hl("live", 1, 700), gone("last", 1, 600)]);
    await userEvent.click(screen.getByTestId("pdf-highlight-view-deleted"));
    await waitFor(() => expect(rows()).toEqual(["last"]));

    rerender([hl("live", 1, 700), hl("last", 1, 600)]);

    expect(screen.getByTestId("pdf-highlight-view-deleted")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      document.querySelector(".pdf-highlight-list-empty"),
    ).toHaveTextContent("No deleted highlights");
    expect(screen.getByTestId("pdf-highlight-view-active")).toHaveTextContent(
      "2",
    );
  });

  // ‼️ §282.4 목록 전체가 탭 정지점 **하나**여야 한다는 계약(use-rail-roving-focus.ts
  // 헤더 — 사용자가 실제로 밟은 문제다). 액션 버튼이 기본 tabIndex로 붙으면
  // 삭제됨 갈래가 1 + 2N개가 된다.
  //
  // ‼️ `getAttribute("tabindex") === "0"`으로 세면 안 된다 — 속성이 아예 없는
  // 버튼은 그 필터에 안 걸리면서 실제로는 포커스를 받는다. 그 방식으로 세면
  // 결함이 있는 DOM에서도 1이 나와 통과한다(리뷰가 실측으로 짚었다).
  // 실제 포커스 가능성(el.tabIndex >= 0)으로 센다.
  function focusableCount(): number {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".pdf-highlight-list button"),
    ).filter((el) => el.tabIndex >= 0).length;
  }

  it("keeps the deleted branch to a single tab stop no matter how many rows", async () => {
    setup({
      highlights: [gone("g1", 1, 700), gone("g2", 1, 600), gone("g3", 2, 500)],
    });
    await userEvent.click(screen.getByTestId("pdf-highlight-view-deleted"));
    await waitFor(() => expect(rows()).toEqual(["g1", "g2", "g3"]));

    // 로빙 중인 줄 하나 + 그 줄의 액션 둘 = 3. 목록 길이와 무관해야 한다.
    expect(focusableCount()).toBe(3);
  });

  it("holds that tab-stop count as the list grows", async () => {
    setup({
      highlights: Array.from({ length: 8 }, (_, i) =>
        gone(`g${String(i)}`, 1, 700 - i * 20),
      ),
    });
    await userEvent.click(screen.getByTestId("pdf-highlight-view-deleted"));
    await waitFor(() => expect(rows()).toHaveLength(8));

    expect(focusableCount()).toBe(3);
  });

  // 활성 갈래에는 액션이 없으므로 정지점은 줄 하나뿐이다.
  it("keeps the active branch to a single tab stop", async () => {
    setup({ highlights: [hl("a", 1, 700), hl("b", 1, 600), hl("c", 2, 500)] });
    await waitFor(() => expect(rows()).toHaveLength(3));

    expect(focusableCount()).toBe(1);
  });

  // ‼️ 갈래를 바꾸면 keys 집합이 통째로 갈린다. useRailRovingFocus가 이전
  // 선택(picked)이 새 keys에 없을 때 버리지 않으면 **어떤 줄에도 tabIndex 0이
  // 없어** 아카이브를 Tab으로 아예 못 들어간다. 그 가드는 지금까지 아무
  // 테스트도 건드리지 않았다(페이지 목록은 keys 멤버십이 안 바뀐다).
  it("moves the tab stop into the deleted branch after an arrow key in the active one", async () => {
    setup({
      highlights: [hl("a", 1, 700), hl("b", 1, 600), gone("g1", 2, 500)],
    });
    await waitFor(() => expect(rows()).toEqual(["a", "b"]));
    await userEvent.click(
      document.querySelector<HTMLElement>('[data-pdf-highlight-id="a"]')!,
    );
    await userEvent.keyboard("{ArrowDown}");
    expect(
      document.querySelector('[data-pdf-highlight-id="b"]'),
    ).toHaveAttribute("tabindex", "0");

    await userEvent.click(screen.getByTestId("pdf-highlight-view-deleted"));
    await waitFor(() => expect(rows()).toEqual(["g1"]));

    expect(
      document.querySelector('[data-pdf-highlight-id="g1"]'),
    ).toHaveAttribute("tabindex", "0");
  });

  // 삭제된 줄은 흐리게 그린다(.deleted). 목록이 갈래를 알고 있으므로 항목은
  // 다시 판정하지 않고 prop을 받는데, 그 배선이 끊겨도 아무 데서도 안 걸렸다.
  it("marks archived rows so they read as archived", async () => {
    setup({ highlights: [hl("live", 1, 700), gone("g1", 1, 600)] });
    await waitFor(() => expect(rows()).toEqual(["live"]));
    expect(
      document.querySelector('[data-pdf-highlight-id="live"]'),
    ).not.toHaveClass("deleted");

    await userEvent.click(screen.getByTestId("pdf-highlight-view-deleted"));
    await waitFor(() => expect(rows()).toEqual(["g1"]));

    expect(document.querySelector('[data-pdf-highlight-id="g1"]')).toHaveClass(
      "deleted",
    );
  });

  it("calls onRestoreHighlight with the row's id", async () => {
    const props = setup({
      highlights: [deleted("gone"), deleted("other", 2, 500)],
    });
    await userEvent.click(screen.getByTestId("pdf-highlight-view-deleted"));
    await waitFor(() => expect(rows()).toEqual(["gone", "other"]));

    await userEvent.click(screen.getAllByText("Restore")[0]);

    expect(props.onRestoreHighlight).toHaveBeenCalledWith("gone");
    expect(props.onPurgeHighlight).not.toHaveBeenCalled();
  });

  it("calls onPurgeHighlight with the row's id", async () => {
    const props = setup({
      highlights: [deleted("gone"), deleted("other", 2, 500)],
    });
    await userEvent.click(screen.getByTestId("pdf-highlight-view-deleted"));
    await waitFor(() => expect(rows()).toEqual(["gone", "other"]));

    await userEvent.click(screen.getAllByText("Delete permanently")[1]);

    expect(props.onPurgeHighlight).toHaveBeenCalledWith("other");
    expect(props.onRestoreHighlight).not.toHaveBeenCalled();
  });

  // ‼️ 항목 자체가 <button>이다 — 액션 버튼을 그 안에 넣으면 유효하지 않은
  // HTML인 데다 액션 클릭이 바깥 버튼의 onSelect까지 발화시켜 클릭 한 번에
  // 점프와 복원이 동시에 일어난다.
  it("does not nest the action buttons inside the row button", async () => {
    setup({ highlights: [deleted("gone")] });
    await userEvent.click(screen.getByTestId("pdf-highlight-view-deleted"));
    await waitFor(() => expect(rows()).toEqual(["gone"]));

    const restore = screen.getByText("Restore");
    expect(restore.closest("[data-pdf-highlight-id]")).toBeNull();
  });

  it("does not jump when a row action is clicked", async () => {
    setup({ highlights: [deleted("gone")] });
    await userEvent.click(screen.getByTestId("pdf-highlight-view-deleted"));
    await waitFor(() => expect(rows()).toEqual(["gone"]));

    await userEvent.click(screen.getByText("Restore"));

    expect(useLinkStore.getState().pendingPdfHighlightId).toBeNull();
  });
});

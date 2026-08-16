import type { PdfRailTab } from "../../../../stores/ui/ui";

// §282 사이드 레일 프레임 — 탭 렌더링과 vault 밖 폴백.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { resolvePdfRailTab } from "../pdf-side-panel-utils";
import { PdfSidePanel } from "../PdfSidePanel";

function setup(overrides: Partial<Parameters<typeof PdfSidePanel>[0]> = {}) {
  const props = {
    activeTab: "pages" as PdfRailTab,
    highlightsEnabled: true,
    onTabChange: vi.fn(),
    ...overrides,
  };
  render(<PdfSidePanel {...props} />);
  return props;
}

describe("resolvePdfRailTab", () => {
  it("keeps the requested tab when highlights are available", () => {
    expect(resolvePdfRailTab("highlights", true)).toBe("highlights");
    expect(resolvePdfRailTab("pages", true)).toBe("pages");
  });

  // 스토어의 탭 선택은 PDF마다 리셋되지 않는다 — vault PDF에서 하이라이트 탭을
  // 보다가 vault 밖 PDF를 열면 요청 값은 여전히 "highlights"다. 접지 않으면
  // 고를 수 있는 탭은 하나뿐인데 본문은 빈 채로 남는다.
  it("falls back to pages when highlights are unavailable", () => {
    expect(resolvePdfRailTab("highlights", false)).toBe("pages");
  });

  it("leaves pages alone when highlights are unavailable", () => {
    expect(resolvePdfRailTab("pages", false)).toBe("pages");
  });
});

describe("PdfSidePanel", () => {
  it("marks the active tab and leaves the other unselected", () => {
    setup({ activeTab: "highlights" });
    expect(screen.getByTestId("pdf-rail-tab-highlights")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("pdf-rail-tab-pages")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("reports tab changes upward", async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId("pdf-rail-tab-highlights"));
    expect(props.onTabChange).toHaveBeenCalledWith("highlights");
  });

  // §274 UX fix round 2의 "고장난 것처럼 보이는 컨트롤 금지" — disabled 탭은
  // "하이라이트가 꺼져 있다"로 읽힌다. PdfToolbar가 같은 게이트를 쓴다.
  it("does not render the highlights tab outside a vault", () => {
    setup({ highlightsEnabled: false });
    expect(
      screen.queryByTestId("pdf-rail-tab-highlights"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("pdf-rail-tab-pages")).toBeInTheDocument();
  });

  it("renders the pages content for the pages tab", () => {
    setup({
      highlightsContent: <p>highlight list</p>,
      pagesContent: <p>page list</p>,
    });
    expect(screen.getByText("page list")).toBeInTheDocument();
    expect(screen.queryByText("highlight list")).not.toBeInTheDocument();
  });

  it("renders the highlights content for the highlights tab", () => {
    setup({
      activeTab: "highlights",
      highlightsContent: <p>highlight list</p>,
      pagesContent: <p>page list</p>,
    });
    expect(screen.getByText("highlight list")).toBeInTheDocument();
    expect(screen.queryByText("page list")).not.toBeInTheDocument();
  });

  // 폴백의 실제 목적 — 탭 버튼만 바뀌는 게 아니라 **본문**이 페이지 목록이어야
  // 한다. 이것이 없으면 highlightsContent(vault 밖에서는 undefined)가 그려져
  // 빈 패널이 된다.
  it("shows the pages content when the stored tab is unavailable", () => {
    setup({
      activeTab: "highlights",
      highlightsContent: <p>highlight list</p>,
      highlightsEnabled: false,
      pagesContent: <p>page list</p>,
    });
    expect(screen.getByText("page list")).toBeInTheDocument();
    expect(screen.queryByText("highlight list")).not.toBeInTheDocument();
  });
});

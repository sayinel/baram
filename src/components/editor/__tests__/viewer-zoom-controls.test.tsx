// §396 전체 화면 뷰어의 확대 묶음. 가짜 `ViewerZoom` 대신 실제 `useViewerZoom` 에 물려서 —
// 끄는 경계 · 퍼센트가 훅이 내는 값에서 나오는지까지 본다.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useViewerZoom } from "../../../hooks/use-viewer-zoom";
import { t } from "../../../i18n";
import { formatKeyForDisplay } from "../../../keybindings/key-utils";
import { topZoomOwner } from "../../../utils/viewer-zoom";
import { ViewerZoomControls } from "../ViewerZoomControls";

function buttons() {
  return {
    inBtn: screen.getByRole("button", { name: "Zoom in" }),
    level: screen.getByTitle(/^Fit to screen/),
    outBtn: screen.getByRole("button", { name: "Zoom out" }),
  };
}

function Harness({ onParentClick }: { onParentClick?: () => void }) {
  const zoom = useViewerZoom({ contentSelector: "svg" });
  return (
    <div data-testid="parent" onClick={onParentClick}>
      <ViewerZoomControls className="test-zoom" zoom={zoom} />
      <div ref={zoom.scrollRef} />
    </div>
  );
}

function setScale(scale: number) {
  act(() => topZoomOwner()?.setScale(scale, null));
}

describe("ViewerZoomControls", () => {
  it("shows the percent, disables at the bounds", () => {
    render(<Harness />);
    const group = screen.getByRole("group", { name: "Zoom" });
    expect(group).toHaveClass("test-zoom");
    const { inBtn, level, outBtn } = buttons();
    expect(level).toHaveTextContent("100%");
    expect(level).toHaveClass("test-zoom-btn", "test-zoom-level");
    expect(inBtn).toHaveClass("test-zoom-btn");
    expect(inBtn).toHaveAttribute("title", "Zoom in");
    expect(outBtn).toHaveAttribute("title", "Zoom out");
    expect(inBtn).toBeEnabled();
    expect(outBtn).toBeEnabled();

    setScale(0.5);
    expect(level).toHaveTextContent("50%");
    expect(outBtn).toBeDisabled();
    expect(inBtn).toBeEnabled();

    setScale(8);
    expect(level).toHaveTextContent("800%");
    expect(inBtn).toBeDisabled();
    expect(outBtn).toBeEnabled();
  });

  it("the level button resets and carries the Mod+0 hint in title", () => {
    render(<Harness />);
    const { level } = buttons();
    const key = formatKeyForDisplay(
      "Mod+0",
      navigator.platform.includes("Mac"),
    );
    expect(level.title).toBe(t("viewerZoom.fit", "en", { key }));
    // 키가 실제로 끼워졌다 — 자리표시가 그대로 남지 않았다.
    expect(level.title).not.toContain("{key}");
    expect(level.title).toContain(key);
    setScale(3);
    expect(level).toHaveTextContent("300%");
    fireEvent.click(level);
    expect(level).toHaveTextContent("100%");
  });

  it("clicks do not reach the parent", () => {
    const onParentClick = vi.fn();
    render(<Harness onParentClick={onParentClick} />);
    const { inBtn, level, outBtn } = buttons();
    fireEvent.click(inBtn);
    expect(level).toHaveTextContent("125%");
    fireEvent.click(level);
    expect(level).toHaveTextContent("100%");
    fireEvent.click(outBtn);
    expect(level).toHaveTextContent("90%");
    expect(onParentClick).not.toHaveBeenCalled();
    // 짝: 묶음 밖의 클릭은 부모에 닿는다 — 위의 0 회는 배선이 없어서가 아니다.
    fireEvent.click(screen.getByRole("group", { name: "Zoom" }));
    expect(onParentClick).toHaveBeenCalledTimes(1);
  });

  it("mousedown does not take focus", () => {
    render(<Harness />);
    const { inBtn, level, outBtn } = buttons();
    // fireEvent 는 dispatchEvent 의 반환값을 돌려준다 — preventDefault 되면 false.
    expect(fireEvent.mouseDown(inBtn)).toBe(false);
    expect(fireEvent.mouseDown(level)).toBe(false);
    expect(fireEvent.mouseDown(outBtn)).toBe(false);
    // 짝: 버튼이 아닌 곳의 mousedown 은 막지 않는다.
    expect(fireEvent.mouseDown(screen.getByTestId("parent"))).toBe(true);
  });
});

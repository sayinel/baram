import { useRef } from "react";

// The edge-drag resize must not leave the block "clicked": the browser fires a
// click on the block after a drag, which for SVG/Mermaid would reach the block's
// onClick and select it → edit mode. useMediaResize swallows that post-drag
// click. This exercises the real DOM event flow (mousedown→move→up→click).
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMediaResize } from "../use-media-resize";

function Harness({
  onCommit,
  onParentClick,
}: {
  onCommit: (pct: number) => void;
  onParentClick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { startResize } = useMediaResize(ref, onCommit);
  return (
    <div data-testid="parent" onClick={onParentClick} ref={ref}>
      <div data-testid="handle" onMouseDown={startResize} />
    </div>
  );
}

// jsdom's getBoundingClientRect is all-zero; give the container a real width so
// startResize doesn't early-return on containerW <= 0.
function stubRect(el: HTMLElement, width: number) {
  el.getBoundingClientRect = () =>
    ({
      bottom: 20,
      height: 20,
      left: 0,
      right: width,
      toJSON: () => ({}),
      top: 0,
      width,
      x: 0,
      y: 0,
    }) as DOMRect;
}

describe("useMediaResize post-drag click suppression", () => {
  it("swallows the click that follows a drag (block is not selected)", () => {
    const onCommit = vi.fn();
    const onParentClick = vi.fn();
    const { getByTestId } = render(
      <Harness onCommit={onCommit} onParentClick={onParentClick} />,
    );
    const parent = getByTestId("parent");
    stubRect(parent, 200);

    fireEvent.mouseDown(getByTestId("handle"));
    fireEvent.mouseMove(document, { clientX: 180 }); // drag right of centre(100)
    fireEvent.mouseUp(document);
    expect(onCommit).toHaveBeenCalledTimes(1);

    // The browser's post-drag click must NOT reach the block's onClick.
    fireEvent.click(parent);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("lets a click through when no drag occurred (plain click still selects)", () => {
    const onCommit = vi.fn();
    const onParentClick = vi.fn();
    const { getByTestId } = render(
      <Harness onCommit={onCommit} onParentClick={onParentClick} />,
    );
    const parent = getByTestId("parent");
    stubRect(parent, 200);

    fireEvent.mouseDown(getByTestId("handle"));
    fireEvent.mouseUp(document); // no move → no commit, no swallow
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.click(parent);
    expect(onParentClick).toHaveBeenCalledTimes(1);
  });
});

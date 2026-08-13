// §276.6 useInlineResize drives the area-ref handle with real mouse events
// (WKWebView breaks HTML5 DnD). What this pins is the geometry the hook reads
// — the ELEMENT's left edge and the PARENT's width — and that a press without
// a move never commits a width.
import { useRef } from "react";

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useInlineResize } from "../use-inline-resize";

function Harness({ onCommit }: { onCommit: (pct: number) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { dragPct, startResize } = useInlineResize(ref, onCommit);
  return (
    <div data-testid="paragraph">
      text before{" "}
      <span data-testid="element" ref={ref}>
        <span data-testid="handle" onMouseDown={startResize} />
        {dragPct != null && <span data-testid="label">{dragPct}%</span>}
      </span>
    </div>
  );
}

function setup() {
  const onCommit = vi.fn();
  const utils = render(<Harness onCommit={onCommit} />);
  return { ...utils, onCommit };
}

/** jsdom's getBoundingClientRect is all-zero; give the element a real box. */
function stubRect(el: HTMLElement, left: number, width: number) {
  el.getBoundingClientRect = () =>
    ({
      bottom: 20,
      height: 20,
      left,
      right: left + width,
      toJSON: () => ({}),
      top: 0,
      width,
      x: left,
      y: 0,
    }) as DOMRect;
}

describe("useInlineResize", () => {
  it("commits the width measured from the element's left edge", () => {
    const { getByTestId, onCommit, queryByTestId } = setup();
    stubRect(getByTestId("paragraph"), 0, 1000);
    stubRect(getByTestId("element"), 200, 100);

    fireEvent.mouseDown(getByTestId("handle"));
    fireEvent.mouseMove(document, { clientX: 500 });

    // 300px of a 1000px paragraph — the live label reads the same value that
    // gets committed, so a drag preview can never disagree with the result.
    expect(getByTestId("label").textContent).toBe("30%");

    fireEvent.mouseUp(document);
    expect(onCommit).toHaveBeenCalledWith(30);
    expect(queryByTestId("label")).toBeNull();
  });

  it("does not commit when the pointer never moved (a plain click)", () => {
    const { getByTestId, onCommit } = setup();
    stubRect(getByTestId("paragraph"), 0, 1000);
    stubRect(getByTestId("element"), 200, 100);

    fireEvent.mouseDown(getByTestId("handle"));
    fireEvent.mouseUp(document);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("ignores a drag when the container has no width", () => {
    // 폭이 0인 컨테이너에서 100%를 커밋해 버리면, 아직 레이아웃되지 않은
    // 문단 위의 클릭 한 번이 마크다운에 |w=100을 적어 넣는다.
    const { getByTestId, onCommit } = setup();
    stubRect(getByTestId("paragraph"), 0, 0);
    stubRect(getByTestId("element"), 0, 0);

    fireEvent.mouseDown(getByTestId("handle"));
    fireEvent.mouseMove(document, { clientX: 500 });
    fireEvent.mouseUp(document);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("stops listening after the drag ends", () => {
    const { getByTestId, onCommit, queryByTestId } = setup();
    stubRect(getByTestId("paragraph"), 0, 1000);
    stubRect(getByTestId("element"), 0, 100);

    fireEvent.mouseDown(getByTestId("handle"));
    fireEvent.mouseMove(document, { clientX: 400 });
    fireEvent.mouseUp(document);
    expect(onCommit).toHaveBeenCalledTimes(1);

    // Moving the mouse afterwards must not resurrect the live preview.
    fireEvent.mouseMove(document, { clientX: 900 });
    expect(queryByTestId("label")).toBeNull();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

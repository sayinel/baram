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
      {/* ‼️ The inline wrapper is not decoration: @tiptap/react puts a
          `span.react-renderer` between the NodeView and the paragraph, and
          measuring THAT is the bug this shape exists to catch. It is still a
          hand-built approximation — block-reference-view.test.tsx drives the
          real editor DOM, and that is the authoritative coverage. */}
      <span data-testid="renderer">
        <span data-testid="element" ref={ref}>
          <span data-testid="handle" onMouseDown={startResize} />
          {dragPct != null && <span data-testid="label">{dragPct}%</span>}
        </span>
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
    // The inline wrapper's box IS the element's box — that is what makes
    // measuring it self-referential. Stubbed to a wrong-but-plausible value so
    // this fails with a number rather than by early-returning on a 0 width.
    stubRect(getByTestId("renderer"), 200, 100);
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

  it("tears the drag down on unmount and commits nothing", () => {
    // A tab switch runs `view.updateState()`, which recreates every NodeView in
    // the document — mid-drag included. Without the teardown the document
    // listeners outlive the view and mouseup writes a width into a dead one.
    const { getByTestId, onCommit, unmount } = setup();
    stubRect(getByTestId("paragraph"), 0, 1000);
    stubRect(getByTestId("element"), 0, 100);

    fireEvent.mouseDown(getByTestId("handle"));
    fireEvent.mouseMove(document, { clientX: 400 });
    unmount();

    fireEvent.mouseMove(document, { clientX: 900 });
    fireEvent.mouseUp(document);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("swallows the click the browser fires after a drag", () => {
    // ‼️ The block reference navigates on Cmd/Ctrl+click. A drag ending with
    // the modifier held synthesizes exactly that click on the reference, so
    // without this the user resizes AND jumps to the target.
    const onWindowClick = vi.fn();
    window.addEventListener("click", onWindowClick);
    try {
      const { getByTestId } = setup();
      stubRect(getByTestId("paragraph"), 0, 1000);
      stubRect(getByTestId("element"), 0, 100);

      fireEvent.mouseDown(getByTestId("handle"));
      fireEvent.mouseMove(document, { clientX: 400 });
      fireEvent.mouseUp(document);
      fireEvent.click(getByTestId("element"), { metaKey: true });

      expect(onWindowClick).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("click", onWindowClick);
    }
  });

  it("lets a later click through once the drag's click has been swallowed", () => {
    const onWindowClick = vi.fn();
    window.addEventListener("click", onWindowClick);
    try {
      const { getByTestId } = setup();
      stubRect(getByTestId("paragraph"), 0, 1000);
      stubRect(getByTestId("element"), 0, 100);

      fireEvent.mouseDown(getByTestId("handle"));
      fireEvent.mouseMove(document, { clientX: 400 });
      fireEvent.mouseUp(document);
      fireEvent.click(getByTestId("element"));
      fireEvent.click(getByTestId("element"));

      // Only the post-drag click is eaten — the reference stays a link.
      expect(onWindowClick).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("click", onWindowClick);
    }
  });
});

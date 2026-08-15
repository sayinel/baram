// §274.1 팝업 경계 물리기의 **DOM 경로** 테스트.
//
// "jsdom은 rect가 0이라 위치 로직은 테스트할 수 없다"는 첫 판단이 틀렸다.
// 0을 돌려주는 것은 기본 동작일 뿐이고, getBoundingClientRect를 스텁하면
// 레이아웃 결정 전체가 관찰 가능해진다. 그 판단 때문에 첫 구현이 테스트 없이
// 나갔고, 실제 앱에서 동작하지 않았다:
//
//   useLayoutEffect에서 el.style.left에 직접 썼는데 left/top은 React가 제어하는
//   prop이라, 재렌더마다 앵커 기준 원래 값으로 덮이면서 보정이 사라졌다.
//   effect의 deps(앵커)는 그대로라 다시 돌지도 않았다. 게이트는 초록이었다.
//
// 그래서 이 파일의 마지막 테스트가 이 기능의 핵심이다 — **재렌더 후에도 보정이
// 남아 있는가**.
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PdfSelectionPopup } from "../PdfSelectionPopup";

const POPUP_W = 250;
const POPUP_H = 40;
// 보이는 창(pane): 0..1000 × 0..600.
const PANE = { bottom: 600, left: 0, right: 1000, top: 0 };

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  } as DOMRect;
}

/** 세로 스크롤바 폭. getBoundingClientRect(border box)에는 포함되고
 * clientWidth(content box)에는 포함되지 않는다 — 이 차이가 실제 결함이었다. */
const SCROLLBAR = 15;

/** 팝업은 자기 인라인 style(= 페이지 로컬 == 여기서는 뷰포트) 위치에 있다고
 * 답하고, 스크롤 컨테이너는 고정된 pane을 답한다. 스크롤러에는 세로
 * 스크롤바가 있다고 모델링한다 — border box는 PANE 그대로지만 content box는
 * 그보다 SCROLLBAR만큼 좁다. */
function stubLayout() {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("pdf-preview-scroll")
        ? PANE.right - PANE.left - SCROLLBAR
        : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("pdf-preview-scroll")
        ? PANE.bottom - PANE.top
        : 0;
    },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("pdf-hl-popup")) {
        return rect(
          Number.parseFloat(this.style.left || "0"),
          Number.parseFloat(this.style.top || "0"),
          POPUP_W,
          POPUP_H,
        );
      }
      if (this.classList.contains("pdf-preview-scroll")) {
        return rect(
          PANE.left,
          PANE.top,
          PANE.right - PANE.left,
          PANE.bottom - PANE.top,
        );
      }
      return rect(0, 0, 0, 0);
    },
  );
}

const noop = () => undefined;

function renderPopup(anchor: { left: number; top: number }) {
  const props = {
    anchor,
    existing: null,
    highlightKind: "text" as const,
    onCopyRef: noop,
    onCopyText: noop,
    onDelete: noop,
    onPickColor: noop,
  };
  const result = render(
    <div className="pdf-preview-scroll">
      <PdfSelectionPopup {...props} />
    </div>,
  );
  const el = result.container.querySelector<HTMLElement>(".pdf-hl-popup");
  if (!el) throw new Error("popup did not render");
  return { el, props, result };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("§274.1 popup clamping in the DOM", () => {
  it("leaves a popup that fits exactly where the anchor asked", () => {
    stubLayout();
    const { el } = renderPopup({ left: 300, top: 200 });
    expect(el.style.left).toBe("300px");
    expect(el.style.top).toBe("200px");
  });

  it("pulls the popup back inside when the anchor is near the right edge", () => {
    stubLayout();
    // 앵커 900 + 폭 250 = 1150 > pane 오른쪽 1000 — 보고된 버그 그대로.
    const { el } = renderPopup({ left: 900, top: 200 });
    expect(el.style.left).toBe("727px"); // 1000 - 15(scrollbar) - 8 - 250
  });

  it("pulls the popup up when the anchor is near the bottom edge", () => {
    stubLayout();
    const { el } = renderPopup({ left: 300, top: 590 });
    expect(el.style.top).toBe("552px"); // 600 - 8 - 40
  });

  // ‼️ 이 브랜치에서 실제로 났던 버그를 고정한다. 부모(use-pdf-highlights)는
  // 렌더마다 새 popupProps 객체를 만들기 때문에 이 팝업은 자주 다시 렌더된다.
  it("KEEPS the correction across a re-render with fresh prop identities", () => {
    stubLayout();
    const { el, props, result } = renderPopup({ left: 900, top: 200 });
    expect(el.style.left).toBe("727px");

    // 값은 같지만 identity가 전부 새것인 props — 부모가 다시 그린 상황.
    result.rerender(
      <div className="pdf-preview-scroll">
        <PdfSelectionPopup
          {...props}
          anchor={{ left: 900, top: 200 }}
          onCopyRef={() => undefined}
          onCopyText={() => undefined}
          onDelete={() => undefined}
          onPickColor={() => undefined}
        />
      </div>,
    );
    // 인라인 스타일에 직접 쓰던 구현은 여기서 900px으로 되돌아갔다.
    expect(el.style.left).toBe("727px");
  });

  it("re-clamps when the anchor moves to a new position", () => {
    stubLayout();
    const { props, result } = renderPopup({ left: 900, top: 200 });
    result.rerender(
      <div className="pdf-preview-scroll">
        <PdfSelectionPopup {...props} anchor={{ left: 100, top: 200 }} />
      </div>,
    );
    const el = result.container.querySelector<HTMLElement>(".pdf-hl-popup");
    // 새 앵커는 여유가 있다 — 이전 보정이 남아 있으면 안 된다.
    expect(el?.style.left).toBe("100px");
  });

  it("does nothing when the layout is unmeasurable (jsdom's default zero rect)", () => {
    // 스텁 없이 — 모든 rect가 0이다. 보정할 근거가 없으므로 앵커 그대로여야 한다.
    const { el } = renderPopup({ left: 900, top: 200 });
    expect(el.style.left).toBe("900px");
  });

  // ‼️ 실제로 났던 결함. getBoundingClientRect는 border box라 스크롤바 폭을
  // 포함한다 — 그것을 경계로 쓰면 팝업이 계산상 "안에 들어갔는데" 스크롤바
  // 아래로 들어가 잘린다. 실측: 팝업 오른쪽 1258, 컨테이너 rect 오른쪽 1266
  // (여유 8px)인데도 화면에서는 잘렸다.
  it("excludes the scrollbar: the border box would leave the popup under it", () => {
    stubLayout();
    const { el } = renderPopup({ left: 900, top: 200 });
    const left = Number.parseFloat(el.style.left);
    // content box 기준이면 오른쪽 끝이 스크롤바 앞에서 멈춘다.
    expect(left + POPUP_W).toBeLessThanOrEqual(PANE.right - SCROLLBAR - 8);
    // border box를 썼다면 여기까지 갔을 것이다 — 그 값이면 스크롤바 아래다.
    expect(left).not.toBe(PANE.right - 8 - POPUP_W);
  });
});

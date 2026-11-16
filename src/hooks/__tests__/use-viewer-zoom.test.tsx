// §396 전체 화면 뷰어의 배율 훅. jsdom 에는 레이아웃이 없어서 `getBoundingClientRect` 를 작은
// 배치 모형으로 바꾼다 — 스크롤 컨테이너는 `box`, 그 안의 내용은 배율 1 에서 `box` 를 꽉 채우고
// (`width: 100%` 인 svg 처럼), `data-viewer-zoomed` 가 있으면 두 변수의 크기로 가운데에 놓인다
// (남는 공간이 없으면 왼쪽 · 위 0, `margin: auto` 처럼). 스크롤만큼 왼쪽 · 위로 밀린다. 브라우저의
// 레이아웃처럼 잴 때마다 스크롤을 지금 내용의 스크롤 범위로 자른다 — 그래서 크기 지정을 잠깐 걷는
// 다시 재기가 스크롤을 잃는지 여기서 보인다.
import type { ViewerZoomOptions } from "../use-viewer-zoom";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { topZoomOwner } from "../../utils/viewer-zoom";
import { useViewerZoom } from "../use-viewer-zoom";
import { zoomIn } from "../use-zoom";

const SVG_NS = "http://www.w3.org/2000/svg";

let box = { height: 736, left: 0, top: 0, width: 1336 };
let scroller: HTMLDivElement;

function addContent(el: Element): Element {
  el.classList.add("content");
  scroller.append(el);
  return el;
}

function fakeRect(
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
  };
}

/** 위 머리말의 배치 모형. */
function layout(el: Element): DOMRect {
  const zoomed = scroller.hasAttribute("data-viewer-zoomed");
  const style = scroller.style;
  const width = zoomed
    ? parseFloat(style.getPropertyValue("--viewer-zoom-width"))
    : box.width;
  const height = zoomed
    ? parseFloat(style.getPropertyValue("--viewer-zoom-height"))
    : box.height;
  const maxLeft = Math.max(0, width - box.width);
  const maxTop = Math.max(0, height - box.height);
  scroller.scrollLeft = Math.min(maxLeft, Math.max(0, scroller.scrollLeft));
  scroller.scrollTop = Math.min(maxTop, Math.max(0, scroller.scrollTop));
  if (el === scroller) {
    return fakeRect(box.left, box.top, box.width, box.height);
  }
  if (!scroller.contains(el) || el.hasAttribute("data-hidden")) {
    return fakeRect(0, 0, 0, 0);
  }
  return fakeRect(
    box.left + Math.max(0, (box.width - width) / 2) - scroller.scrollLeft,
    box.top + Math.max(0, (box.height - height) / 2) - scroller.scrollTop,
    width,
    height,
  );
}

function mount(options: Partial<ViewerZoomOptions> = {}) {
  const view = renderHook((props: ViewerZoomOptions) => useViewerZoom(props), {
    initialProps: { contentSelector: ".content", ...options },
  });
  act(() => view.result.current.scrollRef(scroller));
  return view;
}

function owner() {
  const top = topZoomOwner();
  if (!top) throw new Error("no zoom owner");
  return top;
}

function squareSvg(): Element {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  return svg;
}

function zoomVars(): [string, string] {
  return [
    scroller.style.getPropertyValue("--viewer-zoom-width"),
    scroller.style.getPropertyValue("--viewer-zoom-height"),
  ];
}

beforeEach(() => {
  box = { height: 736, left: 0, top: 0, width: 1336 };
  scroller = document.createElement("div");
  document.body.append(scroller);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return layout(this);
    },
  );
});

afterEach(() => {
  scroller.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useViewerZoom", () => {
  it("registers an owner while mounted and removes it on unmount", () => {
    expect(topZoomOwner()).toBeNull();
    addContent(squareSvg());
    const { result, unmount } = mount();
    expect(topZoomOwner()).not.toBeNull();
    // 그 주인이 이 훅이다 — 키 경로(`use-zoom` 의 zoomIn)가 이 훅의 배율을 움직인다.
    act(() => zoomIn());
    expect(result.current.scale).toBe(1.25);
    unmount();
    expect(topZoomOwner()).toBeNull();
  });

  it("writes nothing at scale 1", () => {
    addContent(squareSvg());
    const { rerender } = mount();
    rerender({ contentKey: "b", contentSelector: ".content" });
    expect(scroller.hasAttribute("data-viewer-zoomed")).toBe(false);
    expect(zoomVars()).toEqual(["", ""]);
  });

  it("zoomIn writes fit × 1.25 from the drawn area", () => {
    // 상자 1336×736, svg viewBox="0 0 100 100" → 맞춤 736×736
    addContent(squareSvg());
    const { result } = mount();
    const zoom = result.current;
    act(() => zoom.zoomIn());
    expect(scroller.hasAttribute("data-viewer-zoomed")).toBe(true);
    expect(scroller.style.getPropertyValue("--viewer-zoom-width")).toBe(
      "920px",
    );
    expect(scroller.style.getPropertyValue("--viewer-zoom-height")).toBe(
      "920px",
    );
    expect(result.current.scale).toBe(1.25);
  });

  it.each([
    // [설명, 내용을 만드는 함수, 기대 폭, 기대 높이] — 상자 1336×736, 배율 1.25
    [
      "svg width/height without a viewBox (aspect 2)",
      () => {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("width", "200");
        svg.setAttribute("height", "100");
        return svg;
      },
      "1670px",
      "835px",
    ],
    [
      "svg px width/height (aspect 2)",
      () => {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("width", "200px");
        svg.setAttribute("height", "100px");
        return svg;
      },
      "1670px",
      "835px",
    ],
    [
      "a comma-separated viewBox wins over width/height (aspect 4)",
      () => {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("viewBox", "0,0,400,100");
        svg.setAttribute("width", "10");
        svg.setAttribute("height", "10");
        return svg;
      },
      "1670px",
      "417.5px",
    ],
    [
      "svg em width/height has no known aspect — the box itself",
      () => {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("width", "10em");
        svg.setAttribute("height", "5em");
        return svg;
      },
      "1670px",
      "920px",
    ],
    [
      "img natural size (aspect 0.5)",
      () => {
        const img = document.createElement("img");
        Object.defineProperty(img, "naturalWidth", { value: 400 });
        Object.defineProperty(img, "naturalHeight", { value: 800 });
        return img;
      },
      "460px",
      "920px",
    ],
  ])("fit uses the intrinsic aspect: %s", (_, make, width, height) => {
    addContent(make());
    const { result } = mount();
    act(() => result.current.zoomIn());
    expect(zoomVars()).toEqual([width, height]);
  });

  it("measures the first match that has a width", () => {
    // 원본 보기는 프리뷰와 원본이 같은 선택자다 — 숨은 쪽(폭 0)을 재면 맞춤이 틀린다.
    const hidden = document.createElement("img");
    hidden.setAttribute("data-hidden", "");
    addContent(hidden);
    const shown = document.createElement("img");
    Object.defineProperty(shown, "naturalWidth", { value: 400 });
    Object.defineProperty(shown, "naturalHeight", { value: 800 });
    addContent(shown);
    const { result } = mount();
    act(() => result.current.zoomIn());
    // 숨은 쪽을 쟀다면 상자가 0×0 이라 두 변수 모두 0px 이었다.
    expect(zoomVars()).toEqual(["460px", "920px"]);
  });

  it("reset removes the attribute and both variables", () => {
    addContent(squareSvg());
    const { result } = mount();
    act(() => result.current.zoomIn());
    expect(scroller.hasAttribute("data-viewer-zoomed")).toBe(true);
    act(() => result.current.reset());
    expect(scroller.hasAttribute("data-viewer-zoomed")).toBe(false);
    expect(zoomVars()).toEqual(["", ""]);
    expect(result.current.scale).toBe(1);
  });

  it("an anchored setScale moves the scroll so the anchor stays put", () => {
    // 확대 전 그림: 상자 1336×736 안 가운데의 736×736 → left 300, top 0.
    // 기준점 (852, 552) 은 그림의 (0.75, 0.75). 배율 4 → 2944×2944 가 left 0 · top 0 에 놓이고,
    // 같은 비율 지점은 (2208, 2208) 이다 → 스크롤 (2208 − 852, 2208 − 552) = (1356, 1656).
    // 둘 다 스크롤 범위(1608, 2208) 안이다. 상자를 기준으로 비율을 쟀다면 scrollLeft 는 약 1025.5 였다.
    addContent(squareSvg());
    mount();
    act(() => owner().setScale(4, { clientX: 852, clientY: 552 }));
    expect(scroller.scrollLeft).toBe(1356);
    expect(scroller.scrollTop).toBe(1656);
  });

  it("a null anchor zooms about the centre of the scroll container", () => {
    // 컨테이너 가운데 (668, 368) 은 그림의 (0.5, 0.5). 배율 1.25 → 920×920 이 left 208 · top 0 에
    // 놓이고 가운데는 (668, 460) → 스크롤 (0, 92). 기준점을 (0, 0) 으로 잡았다면 scrollTop 은 0 이었다.
    addContent(squareSvg());
    mount();
    act(() => owner().setScale(1.25, null));
    expect(scroller.scrollLeft).toBe(0);
    expect(scroller.scrollTop).toBe(92);
  });

  it("clamps and reports bounds", () => {
    addContent(squareSvg());
    const { result } = mount();
    act(() => owner().setScale(20, null));
    expect(result.current.scale).toBe(8);
    expect(result.current.canZoomIn).toBe(false);
    expect(result.current.canZoomOut).toBe(true);
    act(() => owner().setScale(0.1, null));
    expect(result.current.scale).toBe(0.5);
    expect(result.current.canZoomOut).toBe(false);
    expect(result.current.canZoomIn).toBe(true);
  });

  it("zoomable: false swallows input", () => {
    const photo = addContent(squareSvg());
    const { rerender, result } = mount({ zoomable: false });
    expect(topZoomOwner()).not.toBeNull();
    act(() => owner().setScale(2, null));
    act(() => result.current.zoomIn());
    expect(result.current.scale).toBe(1);
    expect(result.current.canZoomIn).toBe(false);
    expect(scroller.hasAttribute("data-viewer-zoomed")).toBe(false);
    // 짝: 같은 주인이 zoomable 이 되면 받는다 — 위의 1 은 zoomable 때문이다.
    rerender({ contentSelector: ".content", zoomable: true });
    act(() => owner().setScale(2, null));
    expect(result.current.scale).toBe(2);
    expect(scroller.hasAttribute("data-viewer-zoomed")).toBe(true);
    // 확대한 채 라이트박스가 동영상으로 넘어간다 — 사진이 빠지고 zoomable 이 꺼진다. 잴 내용이 없어도
    // 1 로 돌아가며 속성 · 변수를 걷는다.
    photo.remove();
    rerender({ contentSelector: ".content", zoomable: false });
    expect(result.current.scale).toBe(1);
    expect(scroller.hasAttribute("data-viewer-zoomed")).toBe(false);
    expect(zoomVars()).toEqual(["", ""]);
  });

  it("resetKey change returns to 1", () => {
    addContent(squareSvg());
    const { rerender, result } = mount({ resetKey: "a" });
    act(() => result.current.zoomIn());
    // 짝: resetKey 가 그대로인 다시 그리기는 배율을 지킨다.
    rerender({ contentKey: "x", contentSelector: ".content", resetKey: "a" });
    expect(result.current.scale).toBe(1.25);
    rerender({ contentKey: "x", contentSelector: ".content", resetKey: "b" });
    expect(result.current.scale).toBe(1);
    expect(scroller.hasAttribute("data-viewer-zoomed")).toBe(false);
    expect(zoomVars()).toEqual(["", ""]);
  });

  it("contentKey change re-measures at the same scale", () => {
    addContent(squareSvg());
    const { rerender, result } = mount({ contentKey: "a" });
    act(() => result.current.zoomIn());
    expect(zoomVars()).toEqual(["920px", "920px"]);
    box = { height: 500, left: 0, top: 0, width: 1000 };
    rerender({ contentKey: "b", contentSelector: ".content" });
    // 새 맞춤 500×500 × 1.25. 속성을 걷지 않고 쟀다면 확대된 920 에서 1150 이 나왔다.
    expect(zoomVars()).toEqual(["625px", "625px"]);
    expect(result.current.scale).toBe(1.25);
  });

  it("re-measuring keeps the point under the container centre", () => {
    // 위 시험의 자리(스크롤 1356, 1656)에서 내용만 바뀐다(편집 전체화면에서 글자 하나). 크기 지정을
    // 걷는 순간 스크롤 범위가 0 이 되어 모형이 스크롤을 0 으로 자른다 — 되돌리지 않으면 왼쪽 위로 튄다.
    addContent(squareSvg());
    const { rerender } = mount({ contentKey: "a" });
    act(() => owner().setScale(4, { clientX: 852, clientY: 552 }));
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([1356, 1656]);
    rerender({ contentKey: "b", contentSelector: ".content" });
    expect(zoomVars()).toEqual(["2944px", "2944px"]);
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([1356, 1656]);
  });

  it("a scale set before the content exists lands when contentKey brings it", () => {
    // Mermaid 가 아직 그리는 중 — 배율은 바뀌고, 쓸 대상이 없으니 DOM 은 그대로다.
    const { rerender, result } = mount({ contentKey: "pending" });
    act(() => owner().setScale(2, null));
    expect(result.current.scale).toBe(2);
    expect(scroller.hasAttribute("data-viewer-zoomed")).toBe(false);
    addContent(squareSvg());
    rerender({ contentKey: "rendered", contentSelector: ".content" });
    expect(scroller.hasAttribute("data-viewer-zoomed")).toBe(true);
    expect(zoomVars()).toEqual(["1472px", "1472px"]);
  });

  it("re-measures on container resize", () => {
    const observers: { callback: () => void; targets: Element[] }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        targets: Element[] = [];
        constructor(callback: () => void) {
          observers.push({ callback, targets: this.targets });
        }
        disconnect() {
          this.targets.length = 0;
        }
        observe(el: Element) {
          this.targets.push(el);
        }
        unobserve() {}
      },
    );
    addContent(squareSvg());
    const { result } = mount();
    expect(observers).toHaveLength(1);
    expect(observers[0].targets).toEqual([scroller]);
    act(() => result.current.zoomIn());
    expect(zoomVars()).toEqual(["920px", "920px"]);
    box = { height: 500, left: 0, top: 0, width: 1000 };
    act(() => observers[0].callback());
    expect(zoomVars()).toEqual(["625px", "625px"]);
    expect(result.current.scale).toBe(1.25);
  });
});

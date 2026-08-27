// §313 점프의 스크롤 — 산수 절반과 배선 절반.
//
// jsdom에는 레이아웃이 없다: 모든 요소가 0 사각형을 보고하고 `scrollTop`은 저절로 움직이지
// 않는다. 그래서 두 절반을 따로 못 박는다.
//
//  - **산수**: 컨테이너의 치수와 목적지의 위치만 받아 새 `scrollTop`(또는 "움직이지 마라"는
//    `null`)을 돌려주는 순수 함수. 진짜 숫자로 잰다.
//  - **배선**: 치수를 손으로 심어 둔 DOM에서, 움직이는 것이 **고른 컨테이너 하나뿐**임을
//    확인한다. 결함의 정체가 "조상을 전부 움직였다"이므로 단정도 그것이다 — 바깥 스크롤
//    컨테이너의 `scrollTop`이 0으로 남는가.
import { afterEach, describe, expect, it, vi } from "vitest";

import { revealBlockInActiveEditor } from "../../../extensions/plugins/viewport-virtualize";
import {
  containerScrollTopFor,
  scrollContainerToPos,
} from "../container-scroll";

vi.mock("../../../extensions/plugins/viewport-virtualize", () => ({
  revealBlockInActiveEditor: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

/** 뷰포트 300, 스크롤 가능한 내용 2000, 지금 100만큼 내려와 있다. 여백은 300/3 = 100. */
const FRAME = {
  scrollHeight: 2000,
  scrollTop: 100,
  targetHeight: 20,
  targetTop: 150,
  viewport: 300,
};

describe("containerScrollTopFor", () => {
  it("이미 통째로 보이는 목적지는 움직이지 않는다", () => {
    // 150..170 은 0..300 안에 있다.
    expect(containerScrollTopFor(FRAME)).toBeNull();
  });

  it("아래로 벗어난 목적지를 여백만큼 아래에 내려놓는다", () => {
    // 문서 오프셋 750에 있는 목적지: 100 + 650 - 100.
    expect(containerScrollTopFor({ ...FRAME, targetTop: 650 })).toBe(650);
  });

  it("위에서 다가가도 같은 자리에 내려놓는다 — 착지점은 방향과 무관하다", () => {
    // 같은 문서 오프셋 750을 이번엔 아래(1000)에서 올려다본다: 1000 - 250 - 100.
    expect(
      containerScrollTopFor({ ...FRAME, scrollTop: 1000, targetTop: -250 }),
    ).toBe(650);
  });

  it("뷰포트보다 큰 목적지는 위쪽에 맞춘다 — 여백을 주면 시작이 화면 밖으로 나간다", () => {
    // 여백 0: 100 + 400.
    expect(
      containerScrollTopFor({ ...FRAME, targetHeight: 900, targetTop: 400 }),
    ).toBe(500);
  });

  it("들어가긴 하는 큰 목적지는 여백을 줄여 아래쪽이 잘리지 않게 한다", () => {
    // 높이 250 → 여백은 min(100, 300-250) = 50. 100 + 400 - 50.
    expect(
      containerScrollTopFor({ ...FRAME, targetHeight: 250, targetTop: 400 }),
    ).toBe(450);
  });

  it("문서 끝을 넘겨 스크롤하지 않는다", () => {
    // 최대는 2000 - 300 = 1700. 날것은 1600 + 700 - 100 = 2200.
    expect(
      containerScrollTopFor({ ...FRAME, scrollTop: 1600, targetTop: 700 }),
    ).toBe(1700);
  });

  it("음수로 스크롤하지 않는다", () => {
    // 날것은 20 - 400 - 100 = -480.
    expect(
      containerScrollTopFor({ ...FRAME, scrollTop: 20, targetTop: -400 }),
    ).toBe(0);
  });

  it("잘라 놓고 보니 지금 자리면 움직이지 말라고 답한다", () => {
    // 이미 바닥(1700)이고 목적지는 그 아래 — 갈 곳이 없다.
    expect(
      containerScrollTopFor({ ...FRAME, scrollTop: 1700, targetTop: 700 }),
    ).toBeNull();
  });

  it("레이아웃이 없는 환경(뷰포트 0)에서는 아무 숫자도 지어내지 않는다", () => {
    expect(containerScrollTopFor({ ...FRAME, viewport: 0 })).toBeNull();
  });
});

describe("scrollContainerToPos", () => {
  it("고른 컨테이너만 움직이고 바깥 스크롤 조상은 건드리지 않는다", () => {
    const { container, dom, outer } = mount();
    scrollContainerToPos(viewAt(dom, 700), 1, 1);
    expect(container.scrollTop).toBe(650); // 100 + (700-50) - 100
    expect(outer.scrollTop).toBe(0);
  });

  it("표시가 붙은 컨테이너가 없으면 아무것도 스크롤하지 않는다", () => {
    // 바깥은 스크롤 가능하다 — "가장 가까운 스크롤되는 조상"을 찾는 구현이라면 이것을
    // 움직였을 것이다. 그것이 바로 되돌리려는 결함이다.
    const { container, dom, outer } = mount({ marked: false });
    scrollContainerToPos(viewAt(dom, 700), 1, 1);
    expect(outer.scrollTop).toBe(0);
    expect(container.scrollTop).toBe(100);
  });

  it("시각 델타를 에디터 zoom으로 나눈다", () => {
    // 사각형과 coordsAtPos는 zoom이 곱해진 시각 공간, scrollTop은 콘텐츠 공간이다.
    // 같은 650px 시각 거리는 zoom 2에서 325 콘텐츠 픽셀이다.
    const { container } = mountAndScroll(2);
    expect(container.scrollTop).toBe(325); // 100 + 325 - 100
  });

  it("잴 수 있는 목적지에는 창 밖 블록 되살리기를 태우지 않는다", () => {
    const { dom } = mount();
    scrollContainerToPos(viewAt(dom, 700), 42, 1);
    expect(revealBlockInActiveEditor).not.toHaveBeenCalled();
  });

  it("0 사각형(가상화로 접힌 블록)을 만나면 되살린 뒤 다시 잰다", () => {
    const { container, dom } = mount();
    scrollContainerToPos(viewAt(dom, 0), 42, 1);
    expect(revealBlockInActiveEditor).toHaveBeenCalledWith(42);
    expect(container.scrollTop).toBe(100); // 되살려도 여전히 못 재면 그대로 둔다
  });

  it("잴 수 없으면(레이아웃 없음) 던지지 않고 물러난다", () => {
    const { container, dom } = mount();
    const throwing = {
      coordsAtPos: () => {
        throw new Error("no layout");
      },
      dom,
    };
    expect(() => scrollContainerToPos(throwing, 1, 1)).not.toThrow();
    expect(container.scrollTop).toBe(100);
  });
});

/** 바깥 스크롤 조상 > 컨테이너 > 에디터 DOM. 치수는 손으로 심는다(jsdom엔 레이아웃이 없다). */
function mount(opts: { marked?: boolean } = {}) {
  const outer = document.createElement("div");
  outer.style.overflowY = "auto";
  Object.defineProperty(outer, "clientHeight", { value: 500 });
  Object.defineProperty(outer, "scrollHeight", { value: 3000 });

  const container = document.createElement("div");
  if (opts.marked !== false) container.setAttribute("data-editor-scroll", "");
  container.style.overflowY = "auto";
  Object.defineProperty(container, "clientHeight", { value: 300 });
  Object.defineProperty(container, "scrollHeight", { value: 2000 });
  container.getBoundingClientRect = () =>
    ({
      bottom: 350,
      height: 300,
      left: 0,
      right: 800,
      top: 50,
      width: 800,
    }) as DOMRect;
  container.scrollTop = 100;

  const dom = document.createElement("div");
  container.appendChild(dom);
  outer.appendChild(container);
  document.body.appendChild(outer);
  return { container, dom, outer };
}

function mountAndScroll(zoom: number) {
  const mounted = mount();
  scrollContainerToPos(viewAt(mounted.dom, 700), 1, zoom);
  return mounted;
}

/** `top`이 0이면 접힌 블록이 보고하는 0 사각형이다. */
function viewAt(dom: HTMLElement, top: number) {
  return {
    coordsAtPos: () => ({
      bottom: top === 0 ? 0 : top + 20,
      left: 0,
      right: 0,
      top,
    }),
    dom,
  };
}

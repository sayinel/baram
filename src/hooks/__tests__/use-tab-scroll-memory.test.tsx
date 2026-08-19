// §291 탭 스크롤 메모리.
//
// ‼️ 이 훅이 scroll 이벤트로 기록하는 이유를 테스트가 그대로 재현한다: "비활성이 되는 순간
// 읽기"는 불가능하다. React 커밋 순서상 effect/cleanup이 돌 때는 이미 display:none이 적용돼
// scrollTop이 0이다. 그래서 아래 테스트는 숨기기 직전에 scrollTop을 0으로 만들어 두고,
// 그럼에도 복원이 마지막으로 **스크롤된** 값을 되돌리는지 단정한다.
import { StrictMode } from "react";

import type { TabScrollTarget } from "../use-tab-scroll-memory";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTabScrollMemory } from "../use-tab-scroll-memory";

function makeTarget(): { el: HTMLDivElement; target: TabScrollTarget } {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return {
    el,
    target: {
      element: el,
      getScrollTop: () => el.scrollTop,
      setScrollTop: (n: number) => {
        el.scrollTop = n;
      },
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useTabScrollMemory", () => {
  it("restores the last scrolled offset after the surface goes hidden and back", () => {
    const { el, target } = makeTarget();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useTabScrollMemory("tab-a", active, () => target),
      { initialProps: { active: true } },
    );

    // 사용자가 스크롤한다. jsdom은 레이아웃이 없으므로 값을 직접 넣고 이벤트를 쏜다.
    act(() => {
      el.scrollTop = 420;
      el.dispatchEvent(new Event("scroll"));
    });

    // display:none이 레이아웃 박스를 파기해 scrollTop이 0이 되는 상황을 흉내낸다.
    el.scrollTop = 0;
    rerender({ active: false });
    rerender({ active: true });

    expect(el.scrollTop).toBe(420);
  });

  it("does not touch scrollTop for a tab it has never recorded", () => {
    const { el, target } = makeTarget();
    el.scrollTop = 77;
    renderHook(() => useTabScrollMemory("fresh-tab", true, () => target));
    expect(el.scrollTop).toBe(77);
  });

  it("keeps each tab's offset separate", () => {
    // 탭마다 별개로 기억하되, 되돌리는 시점은 **다시 보이게 될 때**다(아래 restore edge 참조).
    const { el, target } = makeTarget();
    const { rerender } = renderHook(
      ({ active, tabId }: { active: boolean; tabId: string }) =>
        useTabScrollMemory(tabId, active, () => target),
      { initialProps: { active: true, tabId: "a" } },
    );
    act(() => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event("scroll"));
    });
    rerender({ active: false, tabId: "b" });
    rerender({ active: true, tabId: "b" });
    act(() => {
      el.scrollTop = 300;
      el.dispatchEvent(new Event("scroll"));
    });
    rerender({ active: false, tabId: "a" });
    el.scrollTop = 0;
    rerender({ active: true, tabId: "a" });
    expect(el.scrollTop).toBe(100);
  });

  it("records nothing while inactive", () => {
    // 숨은 표면의 scrollTop은 0이다(박스가 없다). 그 0을 기록해 버리면 복원이 무의미해진다.
    const { el, target } = makeTarget();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useTabScrollMemory("tab-a", active, () => target),
      { initialProps: { active: true } },
    );
    act(() => {
      el.scrollTop = 250;
      el.dispatchEvent(new Event("scroll"));
    });
    rerender({ active: false });
    act(() => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    rerender({ active: true });
    expect(el.scrollTop).toBe(250);
  });
});

// §291 회귀 — 복원은 **비활성→활성 엣지에서만** 일어나야 한다.
//
// ‼️ 실앱에서 드러난 결함: 마크다운은 같은 컨테이너에 다른 문서를 설치하므로, tabId가 바뀔
// 때 이 훅이 복원해 버리면 **아직 이전 문서가 들어 있는 상태**에서 새 탭의 오프셋을 쓴다.
// 그러면 클램프된 값이 scroll 이벤트로 다시 기록되어 진짜 오프셋을 덮어쓴다. 그 전환의
// 복원은 콘텐츠 설치 뒤에 도는 use-tab-switching이 담당한다.
describe("useTabScrollMemory restore edge", () => {
  it("does not restore when only the tabId changes while staying active", () => {
    const { el, target } = makeTarget();
    const { rerender } = renderHook(
      ({ tabId }: { tabId: string }) =>
        useTabScrollMemory(tabId, true, () => target),
      { initialProps: { tabId: "a" } },
    );
    act(() => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event("scroll"));
    });
    rerender({ tabId: "b" });
    act(() => {
      el.scrollTop = 300;
      el.dispatchEvent(new Event("scroll"));
    });

    // A로 돌아가되 활성 상태는 계속 유지된다 — 훅은 손대지 않아야 한다.
    rerender({ tabId: "a" });
    expect(el.scrollTop).toBe(300);
  });

  it("shares an external offsets map so another restorer can read it", () => {
    // 마크다운은 기록자(이 훅)와 복원자(use-tab-switching)가 다르다. 같은 맵을 봐야 한다.
    const { el, target } = makeTarget();
    const offsets = { current: new Map<string, number>() };
    renderHook(() => useTabScrollMemory("a", true, () => target, offsets));
    act(() => {
      el.scrollTop = 250;
      el.dispatchEvent(new Event("scroll"));
    });
    expect(offsets.current.get("a")).toBe(250);
  });
});

// §291 축출 후 다시 열린 표면은 **복원 시점에 아직 내용이 없다.**
//
// ‼️ 실앱에서 PDF로 드러났다: 상한을 넘겨 축출된 PDF를 다시 열면 자리를 기억하고 있는데도
// 맨 위로 갔다. layout effect가 도는 시점엔 페이지가 하나도 렌더되지 않아 문서 높이가 0이고,
// scrollTop이 그대로 잘린다. HTML이 멀쩡했던 건 iframe의 load 이벤트를 기다리기 때문이다.
//
// 기다리는 방법은 타이머가 아니라 **사실 관찰**이다: 내용이 그 자리를 담을 만큼 자라면 그때
// 다시 놓는다.
describe("useTabScrollMemory on a surface whose content arrives later", () => {
  /** scrollTop을 scrollHeight로 클램프하는, 실제 스크롤 컨테이너에 가까운 스텁. */
  function makeGrowingTarget() {
    const el = document.createElement("div");
    const content = document.createElement("div");
    el.appendChild(content);
    document.body.appendChild(el);
    let height = 0;
    let top = 0;
    return {
      el,
      grow: (h: number) => {
        height = h;
        // jsdom은 레이아웃이 없으므로 성장 통지를 직접 쏜다.
        observers.forEach((cb) => cb());
      },
      target: {
        element: el,
        getScrollTop: () => top,
        setScrollTop: (n: number) => {
          top = Math.min(n, height);
        },
      },
    };
  }

  const observers: (() => void)[] = [];

  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          observers.push(cb);
        }
        disconnect() {
          /* 관찰 해제 — 이 스텁에서는 통지 목록에서 빼지 않는다 */
        }
        observe() {
          /* 관찰 대상은 이 스텁의 관심사가 아니다 */
        }
        unobserve() {
          /* noop */
        }
      },
    );
  });

  it("re-applies the offset once the content is tall enough to hold it", () => {
    const { grow, target } = makeGrowingTarget();
    const offsets = { current: new Map<string, number>([["a", 900]]) };

    renderHook(() => useTabScrollMemory("a", true, () => target, offsets));
    // 아직 내용이 없다 — 잘려서 0이다.
    expect(target.getScrollTop()).toBe(0);

    grow(4000);
    expect(target.getScrollTop()).toBe(900);
  });
});

// §291 ‼️ 개발 빌드는 StrictMode다(main.tsx). React는 마운트마다 effect를
// **create → destroy → create**로 두 번 돌린다. "복원했는가"를 effect 본문에서 ref에 적어
// 두면 두 번째 create가 그 ref를 보고 건너뛰는데, 첫 번째가 만든 관찰자는 그 사이 destroy에서
// 이미 끊겨 있다 — 내용이 늦게 도착하는 표면의 복원 경로가 개발 빌드에서 통째로 죽는다.
// 상한을 넘겨 축출된 PDF가 세 차례 수정에도 실앱에서 계속 맨 위로 갔던 이유가 이것이다.
//
// 위쪽 스텁과 달리 이 블록의 스텁은 **관찰 대상과 연결 상태를 실제로 추적한다.** 그래야
// "관찰자가 끊겼다"와 "살아서 기다린다"를 구별할 수 있다 — 앞의 스텁은 disconnect를 무시하고
// observe도 보지 않으므로 이 결함을 통과시킨다.
class FakeResizeObserver {
  static live = new Set<FakeResizeObserver>();

  private readonly observed = new Set<Element>();

  constructor(private readonly cb: () => void) {
    FakeResizeObserver.live.add(this);
  }

  static fire(el: Element) {
    for (const observer of [...FakeResizeObserver.live]) {
      if (observer.observed.has(el)) observer.cb();
    }
  }

  disconnect() {
    this.observed.clear();
    FakeResizeObserver.live.delete(this);
  }

  observe(el: Element) {
    this.observed.add(el);
  }

  unobserve(el: Element) {
    this.observed.delete(el);
  }
}

/** scrollTop을 자기 내용 높이로 클램프하는, 실제 스크롤 컨테이너에 가까운 스텁. */
function makeLateContentSurface() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  let height = 0;
  let top = 0;
  return {
    /** 늦게 도착하는 자식 — 컨테이너가 비어 있는 상태를 재현한다. */
    addChild: () => {
      const child = document.createElement("div");
      el.appendChild(child);
      return child;
    },
    element: el,
    grow: (child: Element, h: number) => {
      height = h;
      FakeResizeObserver.fire(child);
    },
    target: {
      element: el,
      getScrollTop: () => top,
      setScrollTop: (n: number) => {
        top = Math.min(n, height);
      },
    },
  };
}

describe("useTabScrollMemory under StrictMode", () => {
  beforeEach(() => {
    FakeResizeObserver.live.clear();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  it("still waits for content when effects are double-invoked", () => {
    const surface = makeLateContentSurface();
    const child = surface.addChild();
    const offsets = { current: new Map<string, number>([["a", 900]]) };

    renderHook(
      () => useTabScrollMemory("a", true, () => surface.target, offsets),
      { wrapper: StrictMode },
    );
    // 아직 내용이 없다 — 잘려서 0이다.
    expect(surface.target.getScrollTop()).toBe(0);

    act(() => surface.grow(child, 4000));
    expect(surface.target.getScrollTop()).toBe(900);
  });

  it("waits for a child that appears only after the restore attempt", async () => {
    // Suspense fallback=null처럼 복원 시점에 컨테이너가 **비어 있는** 표면. 자식이 없으면
    // 관찰할 대상도 없으므로, 자식이 생기는 것까지 관찰해야 한다.
    const surface = makeLateContentSurface();
    const offsets = { current: new Map<string, number>([["b", 700]]) };

    renderHook(
      () => useTabScrollMemory("b", true, () => surface.target, offsets),
      { wrapper: StrictMode },
    );
    expect(surface.target.getScrollTop()).toBe(0);

    // MutationObserver 통지는 마이크로태스크로 온다.
    let child!: Element;
    await act(async () => {
      child = surface.addChild();
      await Promise.resolve();
    });
    act(() => surface.grow(child, 3000));

    expect(surface.target.getScrollTop()).toBe(700);
  });
});

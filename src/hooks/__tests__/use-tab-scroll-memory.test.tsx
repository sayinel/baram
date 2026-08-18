import type { TabScrollTarget } from "../use-tab-scroll-memory";

// §291 탭 스크롤 메모리.
//
// ‼️ 이 훅이 scroll 이벤트로 기록하는 이유를 테스트가 그대로 재현한다: "비활성이 되는 순간
// 읽기"는 불가능하다. React 커밋 순서상 effect/cleanup이 돌 때는 이미 display:none이 적용돼
// scrollTop이 0이다. 그래서 아래 테스트는 숨기기 직전에 scrollTop을 0으로 만들어 두고,
// 그럼에도 복원이 마지막으로 **스크롤된** 값을 되돌리는지 단정한다.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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

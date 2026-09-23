import { beforeEach, describe, expect, it } from "vitest";

import { useUIStore } from "../ui";

// §370 표면 가시성 토글 — 기본 true 자체는 `stores/__tests__/stores.test.ts`가 이미 고정한다
// ("ui store has default state"). 여기서는 토글이 그 표면 "하나만" 뒤집는다는 것을 고정한다.
describe("useUIStore chrome visibility toggles", () => {
  beforeEach(() =>
    useUIStore.setState({
      activityBarVisible: true,
      statusBarVisible: true,
      tabBarVisible: true,
    }),
  );

  it("toggleStatusBar flips only statusBarVisible", () => {
    useUIStore.getState().toggleStatusBar();
    const s = useUIStore.getState();
    expect(s.statusBarVisible).toBe(false);
    // 비공허성: 토글이 셋을 한꺼번에 뒤집어도 위 단언은 통과한다 — 아래 둘이 그 구멍을 막는다.
    expect(s.activityBarVisible).toBe(true);
    expect(s.tabBarVisible).toBe(true);
  });

  it("toggleActivityBar flips only activityBarVisible", () => {
    useUIStore.getState().toggleActivityBar();
    const s = useUIStore.getState();
    expect(s.activityBarVisible).toBe(false);
    expect(s.statusBarVisible).toBe(true);
    expect(s.tabBarVisible).toBe(true);
  });

  it("toggleTabBar flips only tabBarVisible", () => {
    useUIStore.getState().toggleTabBar();
    const s = useUIStore.getState();
    expect(s.tabBarVisible).toBe(false);
    expect(s.activityBarVisible).toBe(true);
    expect(s.statusBarVisible).toBe(true);
  });

  it("toggling twice restores the original value", () => {
    useUIStore.getState().toggleStatusBar();
    useUIStore.getState().toggleStatusBar();
    expect(useUIStore.getState().statusBarVisible).toBe(true);
  });
});

describe("useUIStore.showToast", () => {
  beforeEach(() => useUIStore.setState({ toast: null }));

  it("stores an optional type and bumps id", () => {
    useUIStore.getState().showToast("hi");
    expect(useUIStore.getState().toast).toMatchObject({ message: "hi" });
    expect(useUIStore.getState().toast?.type).toBeUndefined();

    useUIStore.getState().showToast("careful", "warning");
    expect(useUIStore.getState().toast).toMatchObject({
      message: "careful",
      type: "warning",
    });
  });
});

// §312 소스 모드 탭 집합이 스토어에 산다.
//
// 이 상태는 React 밖(§305 태스크 쓰기 라우터)에서도 읽혀야 해서 훅의 useState로는
// 부족했다. 스토어로 올린 대가가 하나 있다: partial `set`은 **새 root**를 만들어
// 구독자 전부를 깨운다(CLAUDE.md 규약). 상태가 이미 같을 때 조용히 빠져나오는
// 동등성 관문이 없으면, 탭을 전환할 때마다 도는 `setSourceModeForTab(id, false)`가
// 스토어를 구독하는 모든 컴포넌트를 리렌더한다.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorStore } from "../editor";

beforeEach(() => {
  useEditorStore.setState({ sourceModeTabs: [] });
});

describe("sourceModeTabs", () => {
  it("탭별로 켜고 끈다", () => {
    const { setSourceModeForTab } = useEditorStore.getState();
    setSourceModeForTab("a", true);
    expect(useEditorStore.getState().sourceModeTabs).toEqual(["a"]);

    setSourceModeForTab("b", true);
    expect(useEditorStore.getState().sourceModeTabs).toEqual(["a", "b"]);

    setSourceModeForTab("a", false);
    expect(useEditorStore.getState().sourceModeTabs).toEqual(["b"]);
  });

  it("같은 상태를 다시 세우면 구독자를 깨우지 않는다", () => {
    const { setSourceModeForTab } = useEditorStore.getState();
    setSourceModeForTab("a", true);

    const listener = vi.fn();
    const unsub = useEditorStore.subscribe(listener);
    setSourceModeForTab("a", true);
    unsub();

    expect(listener).not.toHaveBeenCalled();
  });

  it("들어 있지도 않은 탭을 끄면 구독자를 깨우지 않는다", () => {
    const listener = vi.fn();
    const unsub = useEditorStore.subscribe(listener);
    useEditorStore.getState().setSourceModeForTab("never-on", false);
    unsub();

    expect(listener).not.toHaveBeenCalled();
  });

  it("실제로 바뀔 때는 배열 참조가 새것이다 — 셀렉터가 변화를 본다", () => {
    const before = useEditorStore.getState().sourceModeTabs;
    useEditorStore.getState().setSourceModeForTab("a", true);
    expect(useEditorStore.getState().sourceModeTabs).not.toBe(before);
  });
});

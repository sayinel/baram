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

  // §312 닫힌 탭의 id는 이 집합에서 나가야 한다.
  //
  // 훅의 useState였을 때는 수명이 그 훅과 같았지만, 스토어로 올리면서 앱 전체로 길어졌다.
  // 탭 id가 UUID라 오늘은 충돌하지 않지만, 이 집합은 §305 태스크 쓰기 라우터가 읽는
  // 라우팅 입력이다 — 죽은 id를 쌓아 두는 상태에 라우팅을 맡기지 않는다.
  describe("closeTab", () => {
    const tab = (id: string) => ({
      contextId: "c",
      filePath: `/v/${id}.md`,
      id,
      isDirty: false,
      isPinned: false,
      title: id,
    });

    beforeEach(() => {
      useEditorStore.setState({
        activeTabId: "a",
        mruOrder: ["a", "b"],
        sourceModeTabs: [],
        tabs: [tab("a"), tab("b")],
      });
    });

    it("닫힌 탭을 집합에서 뺀다", () => {
      useEditorStore.getState().setSourceModeForTab("a", true);
      useEditorStore.getState().setSourceModeForTab("b", true);

      useEditorStore.getState().closeTab("a");

      expect(useEditorStore.getState().sourceModeTabs).toEqual(["b"]);
    });

    it("집합에 없는 탭을 닫으면 배열 참조를 새로 만들지 않는다", () => {
      // partial `set`이 새 root를 만드는 것과 별개로, 이 배열의 참조가 바뀌면
      // use-source-mode의 `useMemo`가 Set을 다시 만들고 그 소비자들의 memo가 깨진다.
      const before = useEditorStore.getState().sourceModeTabs;
      useEditorStore.getState().closeTab("a");
      expect(useEditorStore.getState().sourceModeTabs).toBe(before);
    });

    it("고정된 탭은 닫히지 않으므로 집합도 그대로다", () => {
      useEditorStore.setState({ tabs: [{ ...tab("a"), isPinned: true }] });
      useEditorStore.getState().setSourceModeForTab("a", true);

      useEditorStore.getState().closeTab("a");

      expect(useEditorStore.getState().sourceModeTabs).toEqual(["a"]);
    });
  });
});

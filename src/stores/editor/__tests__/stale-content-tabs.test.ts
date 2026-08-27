// §313 낡은 문서 표시(`staleContentTabs`)도 탭이 닫히면 나가야 한다.
//
// `sourceModeTabs`가 §312에서 정확히 이 이유로 정리 대상이 됐다: 훅의 useState였을
// 때는 수명이 그 훅과 같았지만 스토어로 올리면서 앱 전체로 길어졌다. `staleContentTabs`는
// 같은 자리에 나중에 들어온 이웃인데 정리에서 빠져 있었다 — 탭 id가 UUID라 오늘 잘못된
// 동작을 만들지는 않지만, 닫힌 탭의 id를 영원히 쌓아 두는 배열이다.
//
// 참조 규율도 이웃과 같다: 뺄 것이 없으면 **같은 배열 참조**를 돌려준다. 새 배열은
// 이 값을 읽는 memo를 이유 없이 다시 돌게 한다.
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../editor";

const tab = (id: string, over: Record<string, unknown> = {}) => ({
  contextId: "c",
  filePath: `/v/${id}.md`,
  id,
  isDirty: false,
  isPinned: false,
  title: id,
  ...over,
});

beforeEach(() => {
  useEditorStore.setState({
    activeTabId: "b",
    mruOrder: ["a", "b", "c"],
    sourceModeTabs: [],
    staleContentTabs: ["a", "b", "c"],
    tabs: [tab("a"), tab("b"), tab("c")],
  });
});

describe("탭을 닫으면 staleContentTabs에서도 빠진다", () => {
  it("closeTab", () => {
    useEditorStore.getState().closeTab("a");

    expect(useEditorStore.getState().staleContentTabs).toEqual(["b", "c"]);
  });

  it("closeOtherTabs — 남는 탭과 고정 탭만 남는다", () => {
    useEditorStore.setState({
      tabs: [tab("a", { isPinned: true }), tab("b"), tab("c")],
    });

    useEditorStore.getState().closeOtherTabs("b");

    expect(useEditorStore.getState().staleContentTabs).toEqual(["a", "b"]);
  });

  it("closeTabsToRight — 오른쪽의 닫힌 탭만 빠진다", () => {
    useEditorStore.getState().closeTabsToRight("a");

    expect(useEditorStore.getState().staleContentTabs).toEqual(["a"]);
  });

  it("closeAllTabs — 배열이 빈다", () => {
    useEditorStore.getState().closeAllTabs();

    expect(useEditorStore.getState().staleContentTabs).toEqual([]);
  });

  it("고정된 탭은 닫히지 않으므로 표시도 그대로다", () => {
    useEditorStore.setState({
      staleContentTabs: ["a"],
      tabs: [tab("a", { isPinned: true })],
    });

    useEditorStore.getState().closeTab("a");

    expect(useEditorStore.getState().staleContentTabs).toEqual(["a"]);
  });
});

describe("뺄 것이 없으면 배열 참조를 새로 만들지 않는다", () => {
  it("closeTab", () => {
    useEditorStore.setState({ staleContentTabs: ["c"] });
    const before = useEditorStore.getState().staleContentTabs;

    useEditorStore.getState().closeTab("a");

    expect(useEditorStore.getState().staleContentTabs).toBe(before);
  });

  it("closeTabsToRight", () => {
    useEditorStore.setState({ staleContentTabs: ["a"] });
    const before = useEditorStore.getState().staleContentTabs;

    useEditorStore.getState().closeTabsToRight("a");

    expect(useEditorStore.getState().staleContentTabs).toBe(before);
  });

  it("closeAllTabs — 이미 비어 있을 때", () => {
    useEditorStore.setState({ staleContentTabs: [] });
    const before = useEditorStore.getState().staleContentTabs;

    useEditorStore.getState().closeAllTabs();

    expect(useEditorStore.getState().staleContentTabs).toBe(before);
  });
});

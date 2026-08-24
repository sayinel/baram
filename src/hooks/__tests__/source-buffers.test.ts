// §287 탭별 소스 버퍼.
//
// ‼️ 이 테스트가 지키는 것은 기능이 아니라 데이터 손실이다. 전역 버퍼 하나 위에 코드 표면을
// 둘 이상 올리면, 마지막에 타이핑한 표면이 그 버퍼를 쥐고 자동 저장이 활성 탭 경로에 그것을
// 쓴다 — 엉뚱한 내용이 엉뚱한 파일에 간다. 그래서 단정은 "버퍼가 분리된다"가 아니라
// "B에 쓴 뒤에도 A를 읽으면 A의 내용"이다.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../../stores/editor/editor";
import { useSourceMode } from "../use-source-mode";

beforeEach(() => {
  useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
});

describe("per-tab source buffers", () => {
  it("keeps one tab's buffer out of another's", () => {
    const { result } = renderHook(() => useSourceMode({ editor: null }));
    act(() => {
      result.current.setSourceBuffer("a", "content of A");
      result.current.setSourceBuffer("b", "content of B");
    });
    expect(result.current.getSourceBuffer("a")).toBe("content of A");
    expect(result.current.getSourceBuffer("b")).toBe("content of B");
  });

  it("returns an empty string for a tab that has no buffer", () => {
    const { result } = renderHook(() => useSourceMode({ editor: null }));
    expect(result.current.getSourceBuffer("never-written")).toBe("");
  });

  it("bumps bufferVersion so the auto-save effect can observe a write", () => {
    // 버퍼가 ref에 살기 때문에 쓰기 자체는 리렌더를 만들지 않는다. 자동 저장 deps가 이
    // 카운터를 보는 것이 "버퍼가 바뀌었다"를 관찰하는 유일한 수단이다.
    const { result } = renderHook(() => useSourceMode({ editor: null }));
    const before = result.current.bufferVersion;
    act(() => {
      result.current.setSourceBuffer("a", "x");
    });
    expect(result.current.bufferVersion).toBeGreaterThan(before);
  });

  it("tracks source mode per tab, not globally", () => {
    const { result } = renderHook(() => useSourceMode({ editor: null }));
    act(() => {
      result.current.setSourceModeForTab("a", true);
    });
    expect(result.current.sourceModeTabs.has("a")).toBe(true);
    expect(result.current.sourceModeTabs.has("b")).toBe(false);
  });

  it("derives isSourceMode from the ACTIVE tab's membership", () => {
    useEditorStore.setState({
      activeTabId: "a",
      mruOrder: ["a"],
      tabs: [
        {
          contextId: "c",
          filePath: "/v/a.md",
          id: "a",
          isDirty: false,
          isPinned: false,
          title: "a",
        },
      ],
    });
    const { result } = renderHook(() => useSourceMode({ editor: null }));
    expect(result.current.isSourceMode).toBe(false);
    act(() => {
      result.current.setSourceModeForTab("a", true);
    });
    expect(result.current.isSourceMode).toBe(true);
    // 다른 탭이 활성이 되면 A는 여전히 소스 모드지만 파생값은 거짓이다.
    act(() => {
      useEditorStore.setState({ activeTabId: "b" });
    });
    expect(result.current.isSourceMode).toBe(false);
    expect(result.current.sourceModeTabs.has("a")).toBe(true);
  });
});

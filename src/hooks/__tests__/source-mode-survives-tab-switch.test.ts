// §287 — 소스 모드는 탭에 붙는다. 탭을 떠났다 돌아와도 여전히 소스 모드다.
//
// 예전에는 use-tab-switching이 전환마다 전역 boolean을 껐다. 편집 영역이 표면을 하나만
// 마운트하던 시절에는 그럴 수밖에 없었다 — 돌아와도 CodeMirror가 재생성돼 커서가 사라졌으니
// WYSIWYG로 되돌리는 편이 덜 나빴다. §286 유지 집합이 그 전제를 없앴다.
//
// ‼️ 사용자에게 보이는 동작 변경이라 테스트로 고정한다. 이게 없으면 다음 사람이 "탭을 바꿔도
// 소스 모드가 안 꺼진다"를 결함으로 보고 되돌릴 수 있다.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../../stores/editor/editor";
import { useSourceMode } from "../use-source-mode";

function tab(id: string, filePath: string) {
  return {
    contextId: "c",
    filePath,
    id,
    isDirty: false,
    isPinned: false,
    title: id,
  };
}

beforeEach(() => {
  useEditorStore.setState({
    activeTabId: "a",
    mruOrder: ["a", "b"],
    tabs: [tab("a", "/v/a.md"), tab("b", "/v/b.md")],
  });
});

describe("source mode follows the tab", () => {
  it("stays on for tab A while tab B is active, and is on again on return", () => {
    const { result } = renderHook(() => useSourceMode({ editor: null }));
    act(() => {
      result.current.setSourceModeForTab("a", true);
    });
    expect(result.current.isSourceMode).toBe(true);

    act(() => {
      useEditorStore.setState({ activeTabId: "b" });
    });
    // B는 소스 모드가 아니다 — 파생값은 거짓이지만 A의 상태는 살아 있다.
    expect(result.current.isSourceMode).toBe(false);
    expect(result.current.sourceModeTabs.has("a")).toBe(true);

    act(() => {
      useEditorStore.setState({ activeTabId: "a" });
    });
    expect(result.current.isSourceMode).toBe(true);
  });

  it("keeps two tabs in independent modes", () => {
    const { result } = renderHook(() => useSourceMode({ editor: null }));
    act(() => {
      result.current.setSourceModeForTab("a", true);
      result.current.setSourceModeForTab("b", false);
    });
    expect(result.current.sourceModeTabs.has("a")).toBe(true);
    expect(result.current.sourceModeTabs.has("b")).toBe(false);
  });
});

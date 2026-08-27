// §312 소스 버퍼 접근자를 스토어에 등록한다.
//
// 버퍼 **데이터**는 ref의 Map에 그대로 둔다(use-source-mode.ts:104 — state로 두면
// 소스 모드 타이핑 한 글자마다 새 Map을 만든다). 스토어에 올리는 것은 안정된 함수
// 참조 두 개뿐이라 리렌더를 만들지 않는다.
//
// ‼️ 그 대가가 **수명**이다. 함수는 훅이 마운트돼 있는 동안만 유효한 ref를 닫고 있다.
// 언마운트 때 지우지 않으면 죽은 탭의 버퍼를 가리키는 접근자가 스토어에 남고, §305
// 라우터가 그리로 태스크 쓰기를 흘려보낸다 — 아무도 읽지 않는 Map에 쓰는 셈이다.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../../stores/editor/editor";
import { useSourceMode } from "../use-source-mode";

beforeEach(() => {
  useEditorStore.setState({
    activeTabId: null,
    mruOrder: [],
    sourceBufferAccess: null,
    sourceModeTabs: [],
    tabs: [],
  });
});

describe("source buffer access registration", () => {
  it("마운트 동안 훅의 실제 버퍼를 읽고 쓴다", () => {
    const { result } = renderHook(() => useSourceMode({ editor: null }));
    act(() => {
      result.current.setSourceBuffer("a", "content of A");
    });

    const access = useEditorStore.getState().sourceBufferAccess;
    expect(access?.getSourceBuffer("a")).toBe("content of A");

    act(() => {
      access?.setSourceBuffer("a", "written through the store");
    });
    expect(result.current.getSourceBuffer("a")).toBe(
      "written through the store",
    );
  });

  it("언마운트하면 접근자를 지운다 — 죽은 탭의 버퍼를 가리킨 채 남지 않는다", () => {
    const { unmount } = renderHook(() => useSourceMode({ editor: null }));
    expect(useEditorStore.getState().sourceBufferAccess).not.toBeNull();

    unmount();
    expect(useEditorStore.getState().sourceBufferAccess).toBeNull();
  });

  it("다시 마운트하면 새 인스턴스의 버퍼로 재등록한다", () => {
    const first = renderHook(() => useSourceMode({ editor: null }));
    act(() => {
      first.result.current.setSourceBuffer("a", "old instance");
    });
    first.unmount();

    const second = renderHook(() => useSourceMode({ editor: null }));
    // 새 인스턴스의 버퍼는 비어 있다 — 옛 Map을 계속 가리키면 "old instance"가 나온다.
    expect(
      useEditorStore.getState().sourceBufferAccess?.getSourceBuffer("a"),
    ).toBe("");
    second.unmount();
  });

  it("자기가 등록한 것이 아니면 지우지 않는다", () => {
    const { unmount } = renderHook(() => useSourceMode({ editor: null }));
    const newer = {
      getSourceBuffer: () => "newer",
      setSourceBuffer: () => undefined,
    };
    act(() => {
      useEditorStore.getState().registerSourceBufferAccess(newer);
    });

    unmount();

    expect(useEditorStore.getState().sourceBufferAccess).toBe(newer);
  });
});

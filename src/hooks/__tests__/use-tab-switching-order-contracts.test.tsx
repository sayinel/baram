/*
 * §298 리뷰(split-review §2) 순서 계약 핀 — use-tab-switching.ts를
 * `hooks/tab-switching/` 여러 모듈로 쪼개기 **전에** 먼저 그린으로 고정한다.
 *
 * 이 effect(135-654행)의 안전성은 주석으로만 적힌 실행 순서 세 가지에 기대고
 * 있다. 분리 과정에서 함수 경계가 생기면 그 순서를 실수로 뒤집기 쉽다 —
 * 그래서 타이밍이 아니라 **호출 순서/횟수**로 고정한다(CLAUDE.md 회귀 테스트 규약).
 *
 * 1. outgoing-save가 in-flight appender 취소보다 먼저 온다 (236-238행 주석).
 * 2. React cleanup(다음 effect body 전 실행)은 loading flag를 지우지 않는다
 *    (644-653행 주석) — 지우면 다음 effect의 outgoing-save가 partial 문서를
 *    "완성됐다"고 오판하고 캐시/저장한다.
 * 3. `markContentLoaded`는 content를 실제로 설치하는 모든 갈래에서 호출된다
 *    (§260 Phase 4b, 129-134행) — 하나라도 빠지면 그 탭의 플러그인 에디터
 *    표면이 영구히 read/write를 거부한다.
 */
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { markContentLoadedCalls, order } = vi.hoisted(() => ({
  markContentLoadedCalls: [] as string[],
  order: [] as string[],
}));

vi.mock("../../utils/editor/programmatic-update", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../utils/editor/programmatic-update")
    >();
  return {
    ...actual,
    isTabLoading: (tabId: string) => {
      order.push(`read:${tabId}`);
      return actual.isTabLoading(tabId);
    },
    markContentLoaded: (tabId: string) => {
      markContentLoadedCalls.push(tabId);
      actual.markContentLoaded(tabId);
    },
    // cancelInflightAppend() clears the flag via setTabLoading(tabId, false) —
    // that write, not the handle's own .cancel(), is what the outgoing-save
    // read must precede (see the "in-flight appender" test below).
    setTabLoading: (tabId: string, loading: boolean) => {
      if (!loading) order.push(`clear:${tabId}`);
      actual.setTabLoading(tabId, loading);
    },
  };
});

import { makeTestEditor } from "../../__tests__/helpers/make-test-editor";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import {
  isTabLoading,
  setTabLoading,
} from "../../utils/editor/programmatic-update";
import { createKeepalivePool } from "../use-large-doc-keepalive";
import { useTabSwitching } from "../use-tab-switching";

function baseParams(editor: Editor) {
  const appendHandleRef = {
    current: null as null | { handle: { cancel: () => void }; tabId: string },
  };
  const editorStateCache = { current: new Map<string, EditorState>() };
  return {
    appendHandleRef,
    createKeepaliveEditor: () => {
      throw new Error("not needed for these fixtures");
    },
    editor,
    editorStateCache,
    getSourceBuffer: () => "",
    isNavBackForwardRef: { current: false },
    keepalive: createKeepalivePool(),
    onActiveEditorChange: vi.fn(),
    scrollOffsets: { current: new Map<string, number>() },
    setFindReplaceMode: vi.fn(),
    setFindReplaceOpen: vi.fn(),
    setIsParsing: vi.fn(),
    setSourceBuffer: vi.fn(),
    sourceModeTabs: new Set<string>(),
  };
}

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

describe("useTabSwitching — 순서 계약 핀 (split-review §2, 리스크 1)", () => {
  it("in-flight appender를 취소하기 전에 outgoing 탭의 isTabLoading을 먼저 읽는다", () => {
    order.length = 0;
    const editor = makeTestEditor("<p>outgoing content</p>");
    useFileStore.setState({ openFiles: new Map() });
    useEditorStore.setState({
      activeTabId: "a",
      mruOrder: ["a"],
      sourceModeTabs: [],
      tabs: [tab("a", "/v/a.md")],
    });

    const params = baseParams(editor);

    const { rerender } = renderHook(
      (p: ReturnType<typeof baseParams>) => useTabSwitching(p),
      { initialProps: params },
    );

    // ‼️ in-flight appender는 mount *이후*에 흉내낸다 — 이 effect는 매 실행마다
    // (prevTabId 유무와 무관하게) 무조건 cancelInflightAppend()를 호출하므로
    // (236-238행), mount 이전에 심으면 초기 렌더가 먼저 소비해 버려서
    // 정작 보려는 "탭 전환" 순간의 취소를 놓친다.
    params.appendHandleRef.current = {
      handle: { cancel: vi.fn() },
      tabId: "a",
    };

    // "b"는 열린 탭이 아니다 — incoming-tab 처리는 조기 반환하므로(no-active-tab
    // 갈래), 이 테스트가 보는 순서(outgoing-save read → flag clear)는 그
    // 이전 구간에서만 결정된다.
    //
    // ‼️ React는 dep이 바뀐 effect를 다시 돌리기 전에, "이전 effect가 실제로
    // cleanup을 등록했다면" 그것부터 부른다(644-653행). 이 테스트의 mount 실행
    // (activeTabId="a", content 없음)은 조기 반환 갈래를 타지 않고 함수 끝까지
    // 가므로 cleanup을 등록한다 — 그래서 이 케이스에서는 .cancel() 자체가
    // (그 cleanup 1회 + cancelInflightAppend 1회) 두 번 불려도 정상이다. 이건
    // 일반 규칙이 아니다: keep-alive hit·non-file-tab·no-active-tab·non-markdown
    // 갈래는 cleanup 등록 전에 return하므로 그 경로에서 나가는 전환은 cancel이
    // 한 번만 불린다. 이 테스트가 고정하는 계약은 "cancel 호출 횟수"가 아니라
    // "isTabLoading 읽기가 setTabLoading(…, false) 쓰기보다 먼저"이므로 그
    // 쓰기(cancelInflightAppend 안에서만 일어난다)만 추적한다.
    act(() => {
      useEditorStore.setState({ activeTabId: "b" });
    });
    rerender(params);

    expect(order).toEqual(["read:a", "clear:a"]);
    editor.destroy();
  });
});

describe("useTabSwitching — cleanup은 loading flag를 지우지 않는다 (split-review §2, 리스크 1)", () => {
  it("effect cleanup(unmount)이 appender는 멈추되 isTabLoading 플래그는 유지한다", () => {
    const editor = makeTestEditor("<p>hi</p>");
    useFileStore.setState({ openFiles: new Map() });
    useEditorStore.setState({
      activeTabId: "a",
      mruOrder: ["a"],
      sourceModeTabs: [],
      tabs: [tab("a", "/v/a.md")],
    });

    const params = baseParams(editor);
    const { unmount } = renderHook(
      (p: ReturnType<typeof baseParams>) => useTabSwitching(p),
      { initialProps: params },
    );

    // mount 이후 진행 중인 progressive load를 흉내낸다.
    let cancelled = false;
    params.appendHandleRef.current = {
      handle: {
        cancel: () => {
          cancelled = true;
        },
      },
      tabId: "a",
    };
    setTabLoading("a", true);

    unmount();

    // 계약: cleanup은 appender를 멈추지만(cancel 호출)
    expect(cancelled).toBe(true);
    // ‼️ 플래그는 지우지 않는다 — 지우면 다음 effect의 outgoing-save가
    // partial 문서를 "완성됐다"고 오판한다.
    expect(isTabLoading("a")).toBe(true);

    setTabLoading("a", false); // 다음 테스트를 오염시키지 않도록 정리
    editor.destroy();
  });
});

describe("useTabSwitching — markContentLoaded는 모든 install 갈래에서 불린다 (split-review §2, 리스크 5)", () => {
  it("keep-alive hit 경로에서 정확히 한 번 불린다", async () => {
    markContentLoadedCalls.length = 0;
    const kaEditor = makeTestEditor("<p>pooled</p>");
    const pool = createKeepalivePool();
    pool.acquire("b", kaEditor);
    pool.markComplete("b");

    useFileStore.setState({ openFiles: new Map([["/v/b.md", "# b"]]) });
    useEditorStore.setState({
      activeTabId: "a",
      mruOrder: ["a"],
      sourceModeTabs: [],
      staleContentTabs: [],
      tabs: [tab("a", "/v/a.md"), tab("b", "/v/b.md")],
    });

    const sharedEditor = makeTestEditor("<p>shared</p>");
    const params = { ...baseParams(sharedEditor), keepalive: pool };

    const { rerender } = renderHook((p: typeof params) => useTabSwitching(p), {
      initialProps: params,
    });

    act(() => {
      useEditorStore.setState({ activeTabId: "b" });
    });
    rerender(params);

    expect(markContentLoadedCalls).toEqual(["b"]);
    // 이 갈래는 requestAnimationFrame으로 스크롤을 되돌린다(280-288행) — 그
    // 콜백이 destroy 이후 늦게 실행되면 파괴된 editor.view를 건드려 던진다.
    await new Promise((resolve) => setTimeout(resolve, 40));
    sharedEditor.destroy();
    kaEditor.destroy();
  });

  it("캐시된 EditorState 복원 경로에서 정확히 한 번 불린다", async () => {
    markContentLoadedCalls.length = 0;
    const editor = makeTestEditor("<p>current</p>");
    const cached = makeTestEditor("<p>cached b content</p>").state;

    useFileStore.setState({
      openFiles: new Map([["/v/b.md", "# b\n"]]),
    });
    useEditorStore.setState({
      activeTabId: "a",
      mruOrder: ["a", "b"],
      sourceModeTabs: [],
      staleContentTabs: [],
      tabs: [tab("a", "/v/a.md"), tab("b", "/v/b.md")],
    });

    const params = baseParams(editor);
    params.editorStateCache.current.set("b", cached);

    const { rerender } = renderHook(
      (p: ReturnType<typeof baseParams>) => useTabSwitching(p),
      { initialProps: params },
    );

    act(() => {
      useEditorStore.setState({ activeTabId: "b" });
    });
    rerender(params);

    await waitFor(() => expect(markContentLoadedCalls).toEqual(["b"]));
    await new Promise((resolve) => setTimeout(resolve, 40));
    editor.destroy();
  });

  it("cold load(파싱→progressive install) 경로에서 finishLoad를 거쳐 정확히 한 번 불린다", async () => {
    markContentLoadedCalls.length = 0;
    const editor = makeTestEditor("<p>current</p>");

    useFileStore.setState({
      openFiles: new Map([["/v/b.md", "# Title\n\nSome body text.\n"]]),
    });
    useEditorStore.setState({
      activeTabId: "a",
      mruOrder: ["a", "b"],
      sourceModeTabs: [],
      staleContentTabs: [],
      tabs: [tab("a", "/v/a.md"), tab("b", "/v/b.md")],
    });

    const params = baseParams(editor);

    const { rerender } = renderHook(
      (p: ReturnType<typeof baseParams>) => useTabSwitching(p),
      { initialProps: params },
    );

    act(() => {
      useEditorStore.setState({ activeTabId: "b" });
    });
    rerender(params);

    await waitFor(() => expect(markContentLoadedCalls).toEqual(["b"]));
    await new Promise((resolve) => setTimeout(resolve, 40));
    editor.destroy();
  });

  it("non-markdown 갈래는 installContent를 타지 않는다 — markContentLoaded 없이 setSourceBuffer만 호출된다", () => {
    // ‼️ 대칭 갈래: 앞의 세 테스트는 "설치했으면 markContentLoaded가 불렸는가"를
    // 본다. 이 테스트는 그 반대 — non-markdown 파일은 ProseMirror 문서가 없으므로
    // 설치할 게 없고, `ctx.installContent`가 아니라 `notifyFileOpen`만 직접 부른다
    // (원본 376-382행, 타입스 §260 Phase 4b 주석). `installContent` 래퍼가 생긴
    // 뒤 이 갈래를 "정리"하며 끌어다 쓰면 이 테스트가 잡는다.
    markContentLoadedCalls.length = 0;
    const editor = makeTestEditor("<p>current</p>");
    const setSourceBuffer = vi.fn();

    useFileStore.setState({
      openFiles: new Map([["/v/c.js", "const x = 1;\n"]]),
    });
    useEditorStore.setState({
      activeTabId: "a",
      mruOrder: ["a", "c"],
      sourceModeTabs: [],
      staleContentTabs: [],
      tabs: [tab("a", "/v/a.md"), tab("c", "/v/c.js")],
    });

    const params = { ...baseParams(editor), setSourceBuffer };

    const { rerender } = renderHook((p: typeof params) => useTabSwitching(p), {
      initialProps: params,
    });

    act(() => {
      useEditorStore.setState({ activeTabId: "c" });
    });
    rerender(params);

    expect(setSourceBuffer).toHaveBeenCalledWith("c", "const x = 1;\n");
    expect(markContentLoadedCalls).toEqual([]);
    editor.destroy();
  });
});

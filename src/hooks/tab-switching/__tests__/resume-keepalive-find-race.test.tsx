// §5.6 #792 리뷰 — Find 가 닫힌 채 Global Search 결과로 큰 문서(keep-alive) 탭에 가도, 결과의
// 검색어가 살아남는다.
//
// `resumeKeepaliveTab` 은 활성 편집기를 바꾸고(`onActiveEditorChange`), 50 ms 타이머로
// 검색어를 넣은 다음 Find 를 연다. 예전에는 MarkdownSurface 가 `activeEditor` 변화를 보고
// passive effect 로 검색을 지웠다. 그 effect 가 타이머보다 늦게 flush 되면 — React 는 다음
// 렌더(Find 열기)를 하기 전에 남은 passive effect 를 먼저 돌린다(`flushPendingEffects`) —
// 방금 넣은 검색어를 지웠다.
//
// 이 시험은 그 순서를 앱의 부품으로 만든다: 실제 `resumeKeepaliveTab`, act 밖에서 도는 실제
// React scheduler, 그리고 가짜 `setTimeout`. 그 50 ms 타이머를 **전환 렌더가 commit 된 직후,
// passive effect 가 돌기 전에** 쏜다. React 19.3 은 DefaultLane commit 의 passive effect 를
// 별도 scheduler task(매크로태스크)로 미루므로, commit 의 layout effect 가 건 microtask 는
// 그보다 먼저 돈다 — 타이머를 거기서 쏜다. 앱에서는 무거운 렌더나 다른 매크로태스크가 그
// passive task 를 50 ms 넘게 미룰 수 있다는 것이 리뷰의 지적이고, 이 시험은 그 틈의 길이가
// 아니라 **그 틈에 타이머가 쏘면 무엇이 남는가** 를 본다.
// ‼️ 큰 탭의 EditorContent 를 이 전환에서 처음 마운트하면 그 마운트가 commit 중에 sync 갱신을
// 걸고, React 는 그 렌더 전에 passive effect 를 곧바로 flush 해 틈이 닫힌다 — 그렇게 시험하면
// 예전 구현도 통과한다(실측). 앱의 keep-alive 편집기는 숨긴 채 마운트된 채로 남으므로, 시험도
// 큰 탭에 한 번 갔다 나온 뒤 돌아온다.
//
// `components/editor/__tests__/find-closed-keepalive-return.test.tsx` 의 같은 이름 시험은 이
// 순서를 `act` 하나로 흉내 낸 모형이다. 이것은 실제 타이머 코드와 실제 scheduler 로 같은 순서를
// 만든다.
import { StrictMode, useLayoutEffect } from "react";

import type { FindReplaceState } from "../../../extensions/plugins/find-replace";
import type { UseInlineAIReturn } from "../../../hooks/use-inline-ai";
import type { EditorTab } from "../../../stores/editor/editor";
import type { TabSwitchContext } from "../types";
import type { Editor as CoreEditor } from "@tiptap/core";

import { act, render } from "@testing-library/react";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarkdownSurface } from "../../../components/editor/MarkdownSurface";
import { Paragraph } from "../../../extensions/nodes/paragraph";
import {
  dispatchSetSearchTerm,
  FindReplace,
  findReplacePluginKey,
} from "../../../extensions/plugins/find-replace";
import { useUIStore } from "../../../stores/ui/ui";
import { useFindReplaceRouting } from "../../use-find-replace-routing";
import { useKeepaliveEditors } from "../../use-keepalive-editors";
import { LARGE_DOC_BLOCK_THRESHOLD } from "../../use-large-doc-keepalive";
import { resumeKeepaliveTab } from "../resume-keepalive-tab";

interface HarnessApi {
  findOpen: boolean;
  onActiveEditorChange: (e: Editor | null) => void;
  setFindReplaceMode: (mode: "find" | "replace") => void;
  setFindReplaceOpen: (open: boolean) => void;
}

let shared: Editor | null = null;
let large: Editor | null = null;

const idleInlineAI = { isActive: false, phase: "idle" } as UseInlineAIReturn;
const scrollOffsets = { current: new Map<string, number>() };
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

function findState(editor: CoreEditor): FindReplaceState {
  return findReplacePluginKey.getState(editor.state) as FindReplaceState;
}

// App 과 같은 세 훅 — 열림 상태(useFindReplaceRouting), 활성 편집기(useKeepaliveEditors),
// 표면(MarkdownSurface). 탭 전환이 받는 콜백을 commit 마다 `apiRef` 에 적고, 큰 탭의 편집기가
// 활성이 된 commit 에서 `onLargeCommit` 을 부른다.
function Harness({
  apiRef,
  onLargeCommit,
}: {
  apiRef: { current: HarnessApi | null };
  onLargeCommit: () => void;
}) {
  const routing = useFindReplaceRouting(false);
  const ka = useKeepaliveEditors(shared);
  useLayoutEffect(() => {
    apiRef.current = {
      findOpen: routing.findReplaceOpen,
      onActiveEditorChange: ka.onActiveEditorChange,
      setFindReplaceMode: routing.setFindReplaceMode,
      setFindReplaceOpen: routing.setFindReplaceOpen,
    };
  });
  useLayoutEffect(() => {
    if (ka.activeKeepaliveEditor) onLargeCommit();
  }, [ka.activeKeepaliveEditor, onLargeCommit]);
  return (
    <MarkdownSurface
      active
      activeEditor={ka.activeEditor}
      activeKeepaliveEditor={ka.activeKeepaliveEditor}
      editor={shared}
      findReplaceMode={routing.findReplaceMode}
      findReplaceOpen={routing.findReplaceOpen}
      inlineAI={idleInlineAI}
      isParsing={false}
      mountedKeepaliveEditor={ka.mountedKeepaliveEditor}
      onFindReplaceClose={() => routing.setFindReplaceOpen(false)}
      onFindReplaceModeChange={routing.setFindReplaceMode}
      scrollOffsets={scrollOffsets}
      tabId="small"
    />
  );
}

/** React scheduler 에 차례를 준다 — act 밖의 렌더와 passive effect 는 매크로태스크로 돈다. */
function macrotask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  // 50 ms 타이머만 가짜로 한다. React scheduler 는 모듈을 읽을 때 잡은 진짜 함수로 돈다.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  large = new Editor({
    content: Array.from(
      { length: LARGE_DOC_BLOCK_THRESHOLD + 10 },
      (_, i) => `<p>line ${i}</p>`,
    ).join(""),
    extensions: [Document, Paragraph, Text, FindReplace],
  });
  shared = new Editor({
    content: "<p>small tab</p>",
    extensions: [Document, Paragraph, Text, FindReplace],
  });
});

afterEach(() => {
  actEnv.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useRealTimers();
  useUIStore.getState().setPendingSearchHighlight(null);
  shared?.destroy();
  large?.destroy();
  shared = null;
  large = null;
});

describe("§5.6 Global Search into a keep-alive tab while Find is closed (#792)", () => {
  // 이것을 실패시키는 것: MarkdownSurface 가 예전처럼 닫혀 있는 동안 `activeEditor` 가 바뀔
  // 때마다 지우면(`if (!findReplaceOpen && activeEditor) dispatchClearSearch(...)`, passive
  // effect) 전환 렌더의 effect 가 타이머 뒤에 돌아 "line 1" 이 "" 가 된다.
  it("keeps the result's term when the 50 ms timer fires before the switch's passive effects", async () => {
    const apiRef: { current: HarnessApi | null } = { current: null };
    // 타이머가 쏜 순간의 검색어 — 타이머가 정말 commit 과 passive effect 사이에서 쐈는지 본다.
    let termWhenTimerFired: null | string = null;
    let armed = false;
    let fired = false;
    const onLargeCommit = () => {
      if (!armed || fired) return;
      fired = true;
      queueMicrotask(() => {
        vi.advanceTimersByTime(50);
        termWhenTimerFired = findState(large!).searchTerm;
      });
    };
    render(
      <StrictMode>
        <Harness apiRef={apiRef} onLargeCommit={onLargeCommit} />
      </StrictMode>,
    );
    // 앱에서처럼 큰 탭에 한 번 갔다가 작은 탭으로 나온다 — keep-alive 편집기는 숨긴 채 마운트된
    // 채로 남는다(`mountedKeepaliveEditor`). 돌아올 때 EditorContent 를 새로 마운트하지 않으므로
    // 그 마운트가 거는 sync 갱신이 passive effect 를 당겨 flush 하지 않는다 — 처음 마운트하는
    // 전환으로 시험하면 그 갱신 때문에 예전 구현도 통과한다(실측).
    act(() => apiRef.current!.onActiveEditorChange(large));
    act(() => apiRef.current!.onActiveEditorChange(null));
    expect(large!.view.dom.isConnected).toBe(true);
    // 큰 탭에 지난번 검색이 남아 있다 — Find 가 닫혀 있으니 전환이 지워야 하는 것.
    dispatchSetSearchTerm(large!.view, "stale");
    expect(apiRef.current!.findOpen).toBe(false);

    const ctx = {
      installContent: () => undefined,
      onActiveEditorChange: (e: Editor | null) =>
        apiRef.current!.onActiveEditorChange(e),
      scrollOffsets,
      setFindReplaceMode: (m: "find" | "replace") =>
        apiRef.current!.setFindReplaceMode(m),
      setFindReplaceOpen: (open: boolean) =>
        apiRef.current!.setFindReplaceOpen(open),
    } as unknown as TabSwitchContext;
    const tab = { filePath: "", id: "large" } as unknown as EditorTab;
    // Global Search 결과 클릭이 남긴 강조 요청.
    useUIStore.getState().setPendingSearchHighlight("line 1");

    // act 밖 — 렌더와 passive effect 를 React scheduler 가 앱에서처럼 따로 돌린다.
    actEnv.IS_REACT_ACT_ENVIRONMENT = false;
    armed = true;
    resumeKeepaliveTab(ctx, "large", large!, tab);
    // 전환은 그 자리에서 남은 검색을 지운다.
    expect(findState(large!).searchTerm).toBe("");

    for (let i = 0; i < 20 && !apiRef.current!.findOpen; i++) await macrotask();
    actEnv.IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => {
      await macrotask();
    });

    // 긍정 짝: 타이머는 commit 뒤에 쐈고 그 순간 검색어가 들어갔다. Find 도 열렸다.
    expect(fired).toBe(true);
    expect(termWhenTimerFired).toBe("line 1");
    expect(apiRef.current!.findOpen).toBe(true);
    // 그 뒤에 돈 passive effect 와 Find 를 여는 렌더가 검색어를 지우지 않았다.
    expect(findState(large!).searchTerm).toBe("line 1");
    expect(findState(large!).matches.length).toBeGreaterThan(0);
  });
});

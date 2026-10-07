import { StrictMode, useState } from "react";

import type { FindReplaceState } from "../../../extensions/plugins/find-replace";
import type { UseInlineAIReturn } from "../../../hooks/use-inline-ai";

import { act, fireEvent, render } from "@testing-library/react";
// §5.6 Find 를 어떤 길로 닫든 검색이 끝난다 (#792).
//
// "match 계산 0회" 는 plugin 상태 객체의 동일성으로 센다: 검색어가 없으면 apply 가 `prev` 를
// 그대로 돌려주고, 검색어가 있으면 computeState 가 매번 새 객체를 만든다. 그래서 편집 뒤에
// 상태 객체가 바뀐 횟수가 곧 match 를 다시 구한 횟수다.
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { DecorationSet } from "@tiptap/pm/view";
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Paragraph } from "../../../extensions/nodes/paragraph";
import {
  dispatchClearSearch,
  dispatchSetSearchTerm,
  FindReplace,
  findReplacePluginKey,
} from "../../../extensions/plugins/find-replace";
import { MarkdownSurface } from "../MarkdownSurface";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const idleInlineAI = { isActive: false, phase: "idle" } as UseInlineAIReturn;
const scrollOffsets = { current: new Map<string, number>() };

function findState(): FindReplaceState {
  return findReplacePluginKey.getState(editor!.state) as FindReplaceState;
}

/** 편집 n번 동안 plugin 상태 객체가 바뀐 횟수 = match 를 다시 구한 횟수. */
function recomputesOver(n: number): number {
  let changes = 0;
  for (let i = 0; i < n; i++) {
    const before = findState();
    act(() => {
      editor!.view.dispatch(editor!.state.tr.insertText("x", 1));
    });
    if (findState() !== before) changes++;
  }
  return changes;
}

// App 의 useFindReplaceRouting 처럼 열림 상태를 부모가 들고, 막대의 onClose 는 false 로,
// 메뉴(edit_find_replace)는 막대를 거치지 않고 함수형 토글로 뒤집는다 — 막대 밖의
// 버튼이 그 토글을 대신한다.
function Harness({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <button
        data-testid="menu-toggle"
        onClick={() => setOpen((prev) => !prev)}
      />
      <MarkdownSurface
        active
        activeEditor={editor}
        activeKeepaliveEditor={null}
        editor={editor}
        findReplaceMode="find"
        findReplaceOpen={open}
        inlineAI={idleInlineAI}
        isParsing={false}
        mountedKeepaliveEditor={null}
        onFindReplaceClose={() => setOpen(false)}
        onFindReplaceModeChange={() => undefined}
        scrollOffsets={scrollOffsets}
        tabId="md-1"
      />
    </>
  );
}

// StrictMode 로 감싼다 — 마운트 직후 cleanup 을 한 번 더 돌리므로, 검색어를 막대의 언마운트
// cleanup 에서 지우는 설계였다면 아래 Global Search 시험이 깨진다.
function expectSearchCleared() {
  expect(findState().searchTerm).toBe("");
  expect(findState().decorations).toBe(DecorationSet.empty);
  expect(recomputesOver(100)).toBe(0);
  expect(findState().decorations).toBe(DecorationSet.empty);
}

function openWithSearch(term: string) {
  editor = new Editor({
    content: "<p>alpha beta alpha</p><p>alpha</p>",
    extensions: [Document, Paragraph, Text, FindReplace],
  });
  // Global Search 와 같은 순서: 검색어를 먼저 넣고 막대를 연다.
  dispatchSetSearchTerm(editor.view, term);
  return render(
    <StrictMode>
      <Harness initiallyOpen />
    </StrictMode>,
  );
}

describe("§5.6 closing Find ends the search (#792)", () => {
  it("recomputes matches on every edit while Find is open", () => {
    // 긍정 짝 — 아래 0회 단정이 "세는 방법이 늘 0을 낸다" 가 아님을 보인다.
    openWithSearch("alpha");
    expect(findState().matches.length).toBe(3);
    expect(recomputesOver(100)).toBe(100);
    expect(findState().decorations).not.toBe(DecorationSet.empty);
  });

  // 이것을 실패시키는 것: MarkdownSurface 의 닫힘 effect 를 지우면 아래 세 시험이 모두 깨진다
  // (막대의 handleClose 도 더는 검색을 지우지 않으므로 지우는 곳은 그 effect 하나다).
  it("clears the search when Find is closed from the menu", () => {
    const { getByTestId } = openWithSearch("alpha");
    act(() => {
      fireEvent.click(getByTestId("menu-toggle"));
    });
    expectSearchCleared();
  });

  it("clears the search when the close button is clicked", () => {
    const { getByRole } = openWithSearch("alpha");
    act(() => {
      fireEvent.click(getByRole("button", { name: /close/i }));
    });
    expectSearchCleared();
  });

  it("clears the search on Escape in the search field", () => {
    const { getByRole } = openWithSearch("alpha");
    act(() => {
      fireEvent.keyDown(getByRole("textbox", { name: "Search" }), {
        key: "Escape",
      });
    });
    expectSearchCleared();
  });

  it("keeps the term Global Search set right before opening the bar", () => {
    const { getByRole } = openWithSearch("beta");
    expect(findState().searchTerm).toBe("beta");
    expect(findState().matches.length).toBe(1);
    expect(getByRole("textbox", { name: "Search" })).toHaveProperty(
      "value",
      "beta",
    );
  });
});

describe("§5.6 dispatchClearSearch", () => {
  // 이것을 실패시키는 것: dispatchClearSearch 의 `=== EMPTY_STATE` 조기 반환을 지우면
  // 이미 비어 있는 상태에서도 dispatch 가 1회 일어난다.
  it("dispatches only when there is something to clear", () => {
    editor = new Editor({
      content: "<p>alpha</p>",
      extensions: [Document, Paragraph, Text, FindReplace],
    });
    const spy = vi.spyOn(editor.view, "dispatch");

    dispatchClearSearch(editor.view);
    expect(spy).toHaveBeenCalledTimes(0);

    dispatchSetSearchTerm(editor.view, "alpha");
    spy.mockClear();
    dispatchClearSearch(editor.view);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(findState().searchTerm).toBe("");
  });
});

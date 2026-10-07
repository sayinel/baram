import { StrictMode, useState } from "react";

import type { FindReplaceState } from "../../../extensions/plugins/find-replace";
import type { UseInlineAIReturn } from "../../../hooks/use-inline-ai";

import { act, fireEvent, render } from "@testing-library/react";
// §5.6 탭 캐시가 닫힌 Find 의 검색을 되살리지 않는다 (#792).
//
// 일반 탭들은 편집기 하나를 같이 쓰고, 탭을 떠날 때 EditorState 를 통째로 캐시했다가 돌아올 때
// 설치한다(save-outgoing-tab → restore-cached-state → replaceEditorStateWithVim). 그 설치는
// transaction 을 거치지 않으므로 MarkdownSurface 의 닫힘 effect 가 보지 못한다.
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { EditorState } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";

import { Paragraph } from "../../../extensions/nodes/paragraph";
import {
  dispatchSetSearchTerm,
  FindReplace,
  findReplacePluginKey,
  setFindOpen,
  withoutClosedSearch,
} from "../../../extensions/plugins/find-replace";
import { replaceEditorStateWithVim } from "../../../extensions/plugins/vim/replace-editor-state";
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
function Harness() {
  const [open, setOpen] = useState(true);
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

/** 탭 A 에서 검색하고 Find 를 연 채 탭 B 로 간다. A 의 캐시를 돌려준다. */
function returnToA(cachedA: EditorState) {
  act(() => {
    replaceEditorStateWithVim(editor!.view, cachedA, "cached-restore");
  });
}

function searchInTabAThenSwitchToB() {
  editor = new Editor({
    content: "<p>alpha beta alpha</p>",
    extensions: [Document, Paragraph, Text, FindReplace],
  });
  dispatchSetSearchTerm(editor.view, "alpha");
  const view = render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  const cachedA = editor.state;
  const schema = editor.schema;
  const stateB = EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("other text")]),
    ]),
    plugins: editor.state.plugins,
  });
  act(() => {
    replaceEditorStateWithVim(editor!.view, stateB, "fresh-document");
  });
  return { cachedA, view };
}

describe("§5.6 a cached tab state does not bring back a closed search (#792)", () => {
  it("keeps tab A's search when Find stays open across the switch", () => {
    // 긍정 짝 — 캐시는 검색을 싣고 있고, Find 가 열려 있으면 그대로 돌아온다.
    const { cachedA } = searchInTabAThenSwitchToB();
    expect(findState().searchTerm).toBe("");
    returnToA(cachedA);
    expect(findState().searchTerm).toBe("alpha");
    expect(findState().matches.length).toBe(2);
    expect(recomputesOver(100)).toBe(100);
  });

  // 이것을 실패시키는 것: replaceEditorStateWithVim 에서 `withoutClosedSearch(...)` 감싸기를
  // 빼면 이 시험이 깨진다. 위 긍정 짝은 MarkdownSurface 의 `setFindOpen(findReplaceOpen)` 을
  // 지우거나 `withoutClosedSearch` 의 `if (findOpen) return state` 를 지우면 깨진다.
  it("clears tab A's search when Find was closed in tab B", () => {
    const { cachedA, view } = searchInTabAThenSwitchToB();
    act(() => {
      fireEvent.click(view.getByTestId("menu-toggle"));
    });
    returnToA(cachedA);

    expect(findState().searchTerm).toBe("");
    expect(findState().decorations).toBe(DecorationSet.empty);
    expect(recomputesOver(100)).toBe(0);
    // 문서는 A 의 것이 그대로 돌아왔다 — 검색만 지웠다.
    expect(editor!.state.doc.textContent).toContain("alpha beta alpha");
  });
});

describe("§5.6 withoutClosedSearch", () => {
  // 이것을 실패시키는 것: `ps === undefined || ps === EMPTY_STATE` 조기 반환을 지우면 지울 것이
  // 없는 상태에도 transaction 을 적용해 새 객체를 돌려준다 — 설치마다 상태를 한 번 더 만든다.
  it("returns the same state when there is no search to clear", () => {
    setFindOpen(false);
    editor = new Editor({
      content: "<p>alpha</p>",
      extensions: [Document, Paragraph, Text, FindReplace],
    });
    const clean = editor.state;
    expect(withoutClosedSearch(clean)).toBe(clean);

    const plain = new Editor({
      content: "<p>alpha</p>",
      extensions: [Document, Paragraph, Text],
    });
    expect(withoutClosedSearch(plain.state)).toBe(plain.state);
    plain.destroy();

    // 긍정 짝 — 지울 검색이 있으면 다른 상태를 돌려준다.
    dispatchSetSearchTerm(editor.view, "alpha");
    const searching = editor.state;
    const cleared = withoutClosedSearch(searching);
    expect(cleared).not.toBe(searching);
    expect(
      (findReplacePluginKey.getState(cleared) as FindReplaceState).searchTerm,
    ).toBe("");
  });
});

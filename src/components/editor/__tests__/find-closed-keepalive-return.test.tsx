import { StrictMode, useState } from "react";

import type { FindReplaceState } from "../../../extensions/plugins/find-replace";
import type { UseInlineAIReturn } from "../../../hooks/use-inline-ai";
import type { Editor as CoreEditor } from "@tiptap/core";

import { act, fireEvent, render } from "@testing-library/react";
// §5.6 큰 문서의 keep-alive 편집기로 돌아와도 닫힌 Find 의 검색이 살아나지 않는다 (#792).
//
// 큰 문서(LARGE_DOC_BLOCK_THRESHOLD 이상)는 공유 편집기가 아니라 따로 둔 keep-alive 편집기에
// 산다. 그 탭으로 돌아오는 resumeKeepaliveTab 은 상태를 설치하지 않으므로
// `withoutClosedSearch` 를 거치지 않는다. 대신 `onActiveEditorChange` 가
// useKeepaliveEditors 의 `activeEditor` 를 그 편집기로 바꾸고, MarkdownSurface 의 닫힘
// effect(deps `[findReplaceOpen, activeEditor]`)가 다시 돌아 그 편집기의 검색을 지운다.
// 이 시험은 그 길을 앱과 같은 훅으로 돌린다.
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { DecorationSet } from "@tiptap/pm/view";
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";

import { Paragraph } from "../../../extensions/nodes/paragraph";
import {
  dispatchSetSearchTerm,
  FindReplace,
  findReplacePluginKey,
} from "../../../extensions/plugins/find-replace";
import { useKeepaliveEditors } from "../../../hooks/use-keepalive-editors";
import { LARGE_DOC_BLOCK_THRESHOLD } from "../../../hooks/use-large-doc-keepalive";
import { MarkdownSurface } from "../MarkdownSurface";

let shared: Editor | null = null;
let large: Editor | null = null;

afterEach(() => {
  shared?.destroy();
  large?.destroy();
  shared = null;
  large = null;
});

const idleInlineAI = { isActive: false, phase: "idle" } as UseInlineAIReturn;
const scrollOffsets = { current: new Map<string, number>() };

function findState(editor: CoreEditor): FindReplaceState {
  return findReplacePluginKey.getState(editor.state) as FindReplaceState;
}

/** 편집 n번 동안 plugin 상태 객체가 바뀐 횟수 = match 를 다시 구한 횟수. */
function recomputesOver(editor: CoreEditor, n: number): number {
  let changes = 0;
  for (let i = 0; i < n; i++) {
    const before = findState(editor);
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("x", 1));
    });
    if (findState(editor) !== before) changes++;
  }
  return changes;
}

// App 과 같이 useKeepaliveEditors 가 activeEditor 를 정한다. 두 버튼은 탭 전환이 부르는
// `onActiveEditorChange` 다 — resumeKeepaliveTab 은 큰 탭의 편집기를, 공유 편집기를 쓰는
// 탭으로 가는 분기는 null 을 넘긴다. 메뉴 버튼은 막대를 거치지 않는 함수형 토글이다.
function Harness() {
  const [open, setOpen] = useState(false);
  const ka = useKeepaliveEditors(shared);
  return (
    <>
      <button
        data-testid="to-large-tab"
        onClick={() => ka.onActiveEditorChange(large)}
      />
      <button
        data-testid="to-small-tab"
        onClick={() => ka.onActiveEditorChange(null)}
      />
      <button
        data-testid="menu-toggle"
        onClick={() => setOpen((prev) => !prev)}
      />
      <MarkdownSurface
        active
        activeEditor={ka.activeEditor}
        activeKeepaliveEditor={ka.activeKeepaliveEditor}
        editor={shared}
        findReplaceMode="find"
        findReplaceOpen={open}
        inlineAI={idleInlineAI}
        isParsing={false}
        mountedKeepaliveEditor={ka.mountedKeepaliveEditor}
        onFindReplaceClose={() => setOpen(false)}
        onFindReplaceModeChange={() => undefined}
        scrollOffsets={scrollOffsets}
        tabId="md-1"
      />
    </>
  );
}

/** 큰 탭 A 에서 검색하고 Find 를 연 채 작은 탭 B 로 간다. */
function searchInLargeTabThenSwitchAway() {
  const paragraphs = Array.from(
    { length: LARGE_DOC_BLOCK_THRESHOLD + 10 },
    (_, i) => `<p>${i % 50 === 0 ? "alpha" : "line"} ${i}</p>`,
  ).join("");
  large = new Editor({
    content: paragraphs,
    extensions: [Document, Paragraph, Text, FindReplace],
  });
  shared = new Editor({
    content: "<p>small tab</p>",
    extensions: [Document, Paragraph, Text, FindReplace],
  });
  expect(large.state.doc.childCount).toBeGreaterThanOrEqual(
    LARGE_DOC_BLOCK_THRESHOLD,
  );
  const view = render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  const click = (id: string) =>
    act(() => {
      fireEvent.click(view.getByTestId(id));
    });

  click("to-large-tab");
  dispatchSetSearchTerm(large.view, "alpha");
  click("menu-toggle"); // Find 를 연다
  expect(findState(large).matches.length).toBe(11);
  click("to-small-tab");
  return { click };
}

describe("§5.6 returning to a keep-alive tab after closing Find (#792)", () => {
  it("keeps the large tab's search when Find stays open across the switch", () => {
    // 긍정 짝 — 돌아온 편집기의 검색은 살아 있고 편집마다 match 를 다시 구한다.
    const { click } = searchInLargeTabThenSwitchAway();
    click("to-large-tab");
    expect(findState(large!).searchTerm).toBe("alpha");
    expect(recomputesOver(large!, 100)).toBe(100);
  });

  // 이것을 실패시키는 것: MarkdownSurface 닫힘 effect 의 deps 에서 `activeEditor` 를 빼면
  // 돌아올 때 effect 가 다시 돌지 않아 큰 탭의 검색이 남고 이 시험이 깨진다.
  it("clears the large tab's search when Find was closed in another tab", () => {
    const { click } = searchInLargeTabThenSwitchAway();
    click("menu-toggle"); // B 에서 Find 를 닫는다
    // 닫는 순간에는 큰 탭이 화면에 없으므로 아직 지워지지 않았다.
    expect(findState(large!).searchTerm).toBe("alpha");
    click("to-large-tab");

    expect(findState(large!).searchTerm).toBe("");
    expect(findState(large!).decorations).toBe(DecorationSet.empty);
    expect(recomputesOver(large!, 100)).toBe(0);
  });
});

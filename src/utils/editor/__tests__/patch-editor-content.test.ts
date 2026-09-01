import type { Editor } from "@tiptap/core";

// §313 "이미 디스크에 있는 내용으로 열린 문서를 맞춘다"의 시험대.
//
// 이 유틸이 존재하는 이유는 하나다: 지금까지 이 일을 하던 경로가 `EditorState.create`로
// 문서를 통째로 새로 만들어서 **실행 취소 스택과 선택을 함께 버렸다**. 그래서 여기서
// 검사하는 것은 "호출됐는가"가 아니라 사용자에게 남는 것 — 문서의 마크다운, 되돌리기가
// 여전히 되는지, 손대지 않은 블록이 그대로인지다.
import { EditorState } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { makeTestEditor } from "../../../__tests__/helpers/make-test-editor";
import { markdownToProsemirror } from "../../../pipeline";
import { prosemirrorToMarkdown } from "../../../pipeline/pm-to-md";
import { patchEditorContent } from "../patch-editor-content";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** 앱이 탭을 열 때 하는 일과 같은 설치 — 히스토리 없는 새 문서. */
function openWithMarkdown(md: string): Editor {
  const e = makeTestEditor("<p></p>");
  const doc = markdownToProsemirror(md, e.schema);
  e.view.updateState(EditorState.create({ doc, plugins: e.state.plugins }));
  editor = e;
  return e;
}

const BEFORE = `# 할 일

- [ ] 원고 마감
- [ ] 장보기

마지막 문단.
`;

const AFTER = `# 할 일

- [x] 원고 마감 ✅2026-08-26
- [ ] 장보기

마지막 문단.
`;

describe("patchEditorContent", () => {
  it("문서를 새 마크다운으로 맞춘다", () => {
    const e = openWithMarkdown(BEFORE);

    const changed = patchEditorContent(e.view, AFTER);

    expect(changed).toBe(true);
    expect(prosemirrorToMarkdown(e.state.doc)).toBe(AFTER);
  });

  it("사용자가 쌓아 둔 실행 취소를 버리지 않는다", () => {
    const e = openWithMarkdown(BEFORE);
    // 사용자가 한 편집 하나 — 이것이 되돌릴 수 있는 상태로 남아야 한다.
    e.commands.insertContentAt(
      e.state.doc.content.size,
      "<p>사용자가 친 문단</p>",
    );
    expect(prosemirrorToMarkdown(e.state.doc)).toContain("사용자가 친 문단");

    patchEditorContent(
      e.view,
      AFTER.replace("마지막 문단.\n", "마지막 문단.\n\n사용자가 친 문단\n"),
    );

    expect(e.commands.undo()).toBe(true);
    const afterUndo = prosemirrorToMarkdown(e.state.doc);
    // 되돌린 것은 사용자의 편집이고,
    expect(afterUndo).not.toContain("사용자가 친 문단");
    // 사이드바가 만든 변경은 그대로 남는다 — 히스토리에 들어가지 않았으므로.
    expect(afterUndo).toContain("- [x] 원고 마감 ✅2026-08-26");
  });

  it("내용이 같으면 아무 트랜잭션도 보내지 않는다", () => {
    const e = openWithMarkdown(BEFORE);
    const stateBefore = e.state;

    const changed = patchEditorContent(e.view, BEFORE);

    expect(changed).toBe(false);
    expect(e.state).toBe(stateBefore);
  });

  it("바뀌지 않은 블록은 같은 노드 그대로 남는다", () => {
    const e = openWithMarkdown(BEFORE);
    const headingBefore = e.state.doc.child(0);
    const tailBefore = e.state.doc.child(e.state.doc.childCount - 1);

    patchEditorContent(e.view, AFTER);

    // 문서를 통째로 다시 만들면 이 동일성이 깨진다 — 노드 뷰(코드블록·수식·머메이드)가
    // 전부 재생성되고 스크롤이 튄다.
    expect(e.state.doc.child(0)).toBe(headingBefore);
    expect(e.state.doc.child(e.state.doc.childCount - 1)).toBe(tailBefore);
  });

  it("바뀐 줄 뒤에 있던 커서는 같은 글자 위에 남는다", () => {
    const e = openWithMarkdown(BEFORE);
    const tailStart =
      e.state.doc.content.size -
      e.state.doc.child(e.state.doc.childCount - 1).nodeSize +
      1;
    e.commands.setTextSelection(tailStart + 2);
    const textBefore = e.state.doc.textBetween(
      e.state.selection.anchor - 2,
      e.state.selection.anchor,
    );

    patchEditorContent(e.view, AFTER);

    expect(
      e.state.doc.textBetween(
        e.state.selection.anchor - 2,
        e.state.selection.anchor,
      ),
    ).toBe(textBefore);
  });

  it("줄이 늘어나도 줄어들어도 맞춘다", () => {
    const e = openWithMarkdown(BEFORE);

    const longer = BEFORE.replace(
      "마지막 문단.\n",
      "마지막 문단.\n\n덧붙인 문단.\n",
    );
    expect(patchEditorContent(e.view, longer)).toBe(true);
    expect(prosemirrorToMarkdown(e.state.doc)).toBe(longer);

    const shorter = `# 할 일\n`;
    expect(patchEditorContent(e.view, shorter)).toBe(true);
    expect(prosemirrorToMarkdown(e.state.doc)).toBe(shorter);
  });
});

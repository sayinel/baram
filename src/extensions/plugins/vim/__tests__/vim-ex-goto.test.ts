// issue 487 — ex `:N` 줄 이동 (WYSIWYG 본문).
//
// 줄 모델은 j/k와 동일(collectLines): hard-break 분절·테이블 행·
// "코드블록 = 한 줄" 카운트가 그대로 적용된다. 처리 경로는 move와 같은
// SELECTION 단일 트랜잭션이라, 코드블록 줄에 떨어지면 진입 핸드오프까지
// 기존 채널이 배달한다.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { createBaramExtensions } from "../../../index";
import { CodeBlockNodeView } from "../../../nodes/views/code-block-node-view";
import { vimPluginKey } from "../vim-keys";

const editors: Editor[] = [];

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function exGoto(editor: Editor, input: string): void {
  press(editor, ":");
  for (const ch of input) press(editor, ch);
  press(editor, "Enter");
}

function makeEditor(md: string): Editor {
  const editor = new Editor({
    content: "",
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  editors.push(editor);
  return editor;
}

function press(editor: Editor, key: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
  );
}

function setVim(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, {
      enabled: true,
      type: "setEnabled",
    }),
  );
}

/** n번째 커서 줄(1-기반)의 시작 — 문단 기준 단순 문서용. */
function paraStart(editor: Editor, n: number): number {
  let idx = 0;
  let found = -1;
  editor.state.doc.forEach((node, offset) => {
    if (node.isTextblock) {
      idx += 1;
      if (idx === n && found < 0) found = offset + 1;
    }
  });
  return found;
}

const MD = "one\n\ntwo\n\nthree\n\nfour\n\nfive\n";

describe("ex :N line jump (issue 487)", () => {
  it(":3 jumps to the third cursor line", () => {
    const editor = makeEditor(MD);
    setVim(editor);
    exGoto(editor, "3");
    expect(editor.state.selection.from).toBe(paraStart(editor, 3));
    // 명령줄은 닫혔다
    expect(
      (vimPluginKey.getState(editor.state) as { exLine: null | string }).exLine,
    ).toBe(null);
  });

  it(":9999 clamps to the LAST line (stock vim)", () => {
    const editor = makeEditor(MD);
    setVim(editor);
    exGoto(editor, "9999");
    expect(editor.state.selection.from).toBe(paraStart(editor, 5));
  });

  it(":$ jumps to the last line", () => {
    const editor = makeEditor(MD);
    setVim(editor);
    exGoto(editor, "$");
    expect(editor.state.selection.from).toBe(paraStart(editor, 5));
  });

  it(":N onto a code block line delivers the entry handoff", () => {
    // 코드블록은 커서 줄 하나 — :2가 블록 줄이면 island 핸드오프가 탄다.
    const editor = makeEditor("one\n\n```ts\nconst x = 1;\n```\n\nthree\n");
    setVim(editor);
    const handoff = vi.spyOn(
      CodeBlockNodeView.prototype as unknown as {
        applySelection(a: number, h: number, o: { focus: boolean }): void;
      },
      "applySelection",
    );
    exGoto(editor, "2");
    expect(editor.state.selection.$head.parent.type.name).toBe("codeBlock");
    expect(handoff).toHaveBeenCalledWith(0, 0, { focus: true });
  });

  it("non-numeric ex names still reach the command executor (:q untouched)", () => {
    const editor = makeEditor(MD);
    setVim(editor);
    const before = editor.state.selection.from;
    exGoto(editor, "q"); // 실행부로 흐른다 — 선택은 불변
    expect(editor.state.selection.from).toBe(before);
  });
});

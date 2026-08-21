// §298 vim `/` 검색 — StatusBar의 실제 input (IME 정공법).
//
// 모달 surface는 non-editable이라 조합(composition)이 일어나지 않는다 —
// keydown 누적만으로는 `한`을 치면 자모 낱개(ㅎㅏㄴ)가 쌓여 NFC 문서와
// 영원히 매치되지 않았다(적대 리뷰, 재현). 정공법: `/`가 열리면 StatusBar가
// 진짜 <input>을 렌더해 포커스를 받고, IME가 네이티브로 조합한 문자열이
// change 이벤트로 core에 흐른다. Enter/Escape는 input이 처리해 core로
// 배선하고, 닫힐 때 포커스를 에디터로 돌려준다.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../extensions";
import { setWysiwygVimStatusOwner } from "../../../extensions/plugins/vim/vim-status";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { StatusBar } from "../StatusBar";

const editors: Editor[] = [];

function key(editor: Editor, k: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: k }),
  );
}

function makeEditor(md = "알파 한글 단어\n\n베타 한글 둘\n"): Editor {
  useSettingsStore.setState({ vimMode: true });
  const editor = new Editor({
    content: "<p></p>",
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  editor.commands.setTextSelection(1);
  setWysiwygVimStatusOwner(editor);
  return editor;
}

function occurrence(editor: Editor, needle: string, n: number): number {
  const hits: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let at = node.textContent.indexOf(needle);
    while (at !== -1) {
      hits.push(pos + 1 + at);
      at = node.textContent.indexOf(needle, at + 1);
    }
    return false;
  });
  expect(hits.length).toBeGreaterThan(n);
  return hits[n];
}

/** Open the line with `/` on the editor, return the StatusBar input. */
function openLine(editor: Editor): HTMLInputElement {
  act(() => {
    key(editor, "/");
  });
  const input = screen.getByLabelText("vim search") as HTMLInputElement;
  expect(input).toBeInstanceOf(HTMLInputElement);
  return input;
}

afterEach(() => {
  setWysiwygVimStatusOwner(null);
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
  useSettingsStore.setState({ vimMode: false });
  useUIStore.getState().setVimStatus(null);
});

describe("the search line is a real input — IME composes natively", () => {
  it("`/` mounts a focused input in the StatusBar", () => {
    const editor = makeEditor();
    render(<StatusBar editor={editor} mode="wysiwyg" />);

    const input = openLine(editor);

    expect(document.activeElement).toBe(input);
  });

  it("a COMPOSED string arrives whole through change, not per-key", () => {
    // This is what an IME delivers: `한`, not ㅎ→ㅏ→ㄴ. The keydown path can
    // never produce it on a non-editable surface.
    const editor = makeEditor();
    render(<StatusBar editor={editor} mode="wysiwyg" />);
    const input = openLine(editor);

    act(() => {
      fireEvent.change(input, { target: { value: "한글" } });
    });

    expect(useUIStore.getState().vimStatus?.command).toBe("/한글");
  });

  it("Enter jumps to the Korean match and returns focus to the editor", () => {
    const editor = makeEditor();
    render(<StatusBar editor={editor} mode="wysiwyg" />);
    const input = openLine(editor);

    act(() => {
      fireEvent.change(input, { target: { value: "한글" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(editor.state.selection.from).toBe(occurrence(editor, "한글", 0));
    expect(useUIStore.getState().vimStatus?.command).toBeUndefined();
    expect(document.activeElement).toBe(editor.view.dom);

    // and n repeats from the editor, using the recorded pattern
    act(() => {
      key(editor, "n");
    });
    expect(editor.state.selection.from).toBe(occurrence(editor, "한글", 1));
  });

  it("Escape closes without moving and hands focus back", () => {
    const editor = makeEditor();
    render(<StatusBar editor={editor} mode="wysiwyg" />);
    const before = editor.state.selection.from;
    const input = openLine(editor);

    act(() => {
      fireEvent.change(input, { target: { value: "한" } });
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(editor.state.selection.from).toBe(before);
    expect(useUIStore.getState().vimStatus?.command).toBeUndefined();
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it("blur closes the line but leaves focus where the user put it", () => {
    const editor = makeEditor();
    render(<StatusBar editor={editor} mode="wysiwyg" />);
    const input = openLine(editor);

    act(() => {
      fireEvent.blur(input);
    });

    expect(useUIStore.getState().vimStatus?.command).toBeUndefined();
  });
});

describe("without an editor the slot stays text (positive control)", () => {
  it("editor=null renders the command as plain text", () => {
    useUIStore
      .getState()
      .setVimStatus({ command: "/ab", mode: "normal", surface: "wysiwyg" });
    render(<StatusBar editor={null} mode="wysiwyg" />);

    expect(screen.queryByLabelText("vim search")).toBeNull();
    expect(screen.getByText("/ab")).toBeInTheDocument();
  });
});

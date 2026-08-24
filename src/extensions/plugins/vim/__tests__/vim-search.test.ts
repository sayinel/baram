// §298 vim `/` 검색 — 키 입력부터 점프·표시까지의 통합 핀.
//
// core(search-line.test)와 어댑터(search.test)가 각자의 계약을 고정하고,
// 여기서는 배선을 고정한다: keydown이 검색 라인을 열고, StatusBar 피드가
// `/pattern`을 command 슬롯에 싣고(ex line과 같은 자리), Enter가 커서를
// 매치로 옮기며, `n`/`N`이 반복한다. 실패는 침묵(`f` 미스와 동일 정책).

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { useSettingsStore } from "../../../../stores/settings/store";
import { useUIStore } from "../../../../stores/ui/ui";
import { createBaramExtensions } from "../../../index";
import { setWysiwygVimStatusOwner } from "../vim-status";

const editors: Editor[] = [];

function key(editor: Editor, k: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: k }),
  );
}

function makeEditor(md = "alpha bag one\n\nbeta bag two\n"): Editor {
  useSettingsStore.setState({ vimMode: true });
  const editor = new Editor({
    content: "<p></p>",
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  editor.commands.setTextSelection(1);
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

function type(editor: Editor, keys: string): void {
  for (const k of keys) key(editor, k);
}

afterEach(() => {
  setWysiwygVimStatusOwner(null);
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
  useSettingsStore.setState({ vimMode: false });
  useUIStore.getState().setVimStatus(null);
});

describe("`/pattern` Enter jumps to the match", () => {
  it("lands the cursor on the first match after the caret", () => {
    const editor = makeEditor();
    type(editor, "/bag");
    key(editor, "Enter");

    expect(editor.state.selection.from).toBe(occurrence(editor, "bag", 0));
  });

  it("`n` repeats forward with wrap, `N` goes back", () => {
    const editor = makeEditor();
    type(editor, "/bag");
    key(editor, "Enter");

    key(editor, "n");
    expect(editor.state.selection.from).toBe(occurrence(editor, "bag", 1));
    key(editor, "n"); // wrap
    expect(editor.state.selection.from).toBe(occurrence(editor, "bag", 0));
    key(editor, "N");
    expect(editor.state.selection.from).toBe(occurrence(editor, "bag", 1));
  });

  it("Escape closes the line without moving the cursor", () => {
    const editor = makeEditor();
    const before = editor.state.selection.from;
    type(editor, "/bag");
    key(editor, "Escape");

    expect(editor.state.selection.from).toBe(before);
  });

  it("a miss is silent: line closes, cursor stays, key was handled", () => {
    const editor = makeEditor();
    const before = editor.state.selection.from;
    type(editor, "/zzz");
    key(editor, "Enter");

    expect(editor.state.selection.from).toBe(before);
  });
});

describe("the StatusBar command slot mirrors the search line", () => {
  it("typing shows `/ba`, Enter clears it", () => {
    const editor = makeEditor();
    setWysiwygVimStatusOwner(editor);
    type(editor, "/ba");
    expect(useUIStore.getState().vimStatus?.command).toBe("/ba");

    key(editor, "g");
    key(editor, "Enter");
    expect(useUIStore.getState().vimStatus?.command).toBeUndefined();
    expect(useUIStore.getState().vimStatus?.mode).toBe("normal");
  });

  it("`?` shows its own prefix", () => {
    const editor = makeEditor();
    setWysiwygVimStatusOwner(editor);
    type(editor, "?x");
    expect(useUIStore.getState().vimStatus?.command).toBe("?x");
  });
});

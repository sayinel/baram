import type { JSONContent } from "@tiptap/core";

import { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../index";
import { buildClearTableWidthsTransaction } from "../nodes/plugins/table-col-resize";

// §5.5 표를 제자리에서 갱신해도 <col> 은 그 노드를 새로 그린 표와 같은 스타일이어야 한다.
//
// 왜 이 시험이 있는가: Tiptap 의 `updateColumns` 는 기존 <col> 에 속성 하나만 쓴다 — 폭이
// 있으면 `width`, 없으면 `min-width`. 다른 쪽은 지우지 않는다. 그래서 열 폭 조절을 끄면
// (`buildClearTableWidthsTransaction`) 활성 탭의 표가 옛 `width` 를 계속 그렸고, 뒤이어
// `createColResizePlugin` 이 그 화면 폭을 재서 자동 폭으로 다시 넣어 재시작 전까지 남았다
// (2026-11-07 앱 확인, 스펙 0075 수동 확인 4번 실패). 탭 전환의 `view.updateState` 도 같은
// 모양의 표를 제자리에서 갱신하므로, 한 문서의 폭이 다른 문서의 표에 그려졌다.
//
// 판정은 "새로 그린 표" 와의 비교다. 각 시험은 갱신 뒤의 <table> 이 갱신 전과 같은 요소임
// (`toBe`)도 단정한다 — 제자리 갱신이 아니라 다시 그리기였다면 결함이 있어도 통과하므로, 그
// 경우를 실패로 만든다.

const W = { colwidth: [120], userResized: true };
const NONE = { colwidth: null, userResized: false };

function cell(text: string, attrs: object, header = false): JSONContent {
  return {
    attrs,
    content: [{ content: [{ text, type: "text" }], type: "paragraph" }],
    type: header ? "tableHeader" : "tableCell",
  };
}

function doc(...blocks: JSONContent[]): JSONContent {
  return { content: blocks, type: "doc" };
}

function table(first: object, second: object): JSONContent {
  return {
    content: [
      {
        content: [cell("a", first, true), cell("b", second, true)],
        type: "tableRow",
      },
      { content: [cell("1", first), cell("2", second)], type: "tableRow" },
    ],
    type: "table",
  };
}

describe("Table: 제자리 갱신 뒤의 <col> 은 새로 그린 표와 같다", () => {
  const editors: Editor[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
    for (const host of hosts.splice(0)) host.remove();
  });

  function mount(content: JSONContent): Editor {
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    const editor = new Editor({
      content,
      element: host,
      extensions: createBaramExtensions(),
    });
    editors.push(editor);
    return editor;
  }

  function tableOf(editor: Editor): HTMLTableElement {
    const el = editor.view.dom.querySelector("table");
    if (!el) throw new Error("no table");
    return el;
  }

  function colStyles(el: HTMLTableElement): string[] {
    return [...el.querySelectorAll("col")].map(
      (col) => col.getAttribute("style") ?? "",
    );
  }

  /** The <col> styles a fresh view draws for this editor's current document. */
  function freshColStyles(editor: Editor): string[] {
    return colStyles(tableOf(mount(editor.getJSON())));
  }

  it("열 폭 조절을 끄면 지운 표의 <col> 이 옛 width 를 버린다", () => {
    const editor = mount(doc(table(W, { ...W, colwidth: [80] })));
    const before = tableOf(editor);
    expect(colStyles(before)).toEqual(["width: 120px;", "width: 80px;"]);

    const tr = buildClearTableWidthsTransaction(editor.state);
    if (!tr) throw new Error("expected a clearing transaction");
    editor.view.dispatch(tr);

    expect(tableOf(editor)).toBe(before);
    expect(colStyles(before)).toEqual(freshColStyles(editor));
    expect(colStyles(before)).toEqual(["min-width: 25px;", "min-width: 25px;"]);
  });

  it("탭 전환으로 같은 모양의 폭 없는 표를 받으면 그 표의 폭으로 그린다", () => {
    const editor = mount(doc(table(W, { ...W, colwidth: [80] })));
    const before = tableOf(editor);

    // The shared editor installs another tab's document this way (`replaceEditorState`).
    const next = editor.schema.nodeFromJSON(doc(table(NONE, NONE)));
    editor.view.updateState(
      EditorState.create({ doc: next, plugins: editor.state.plugins }),
    );

    expect(tableOf(editor)).toBe(before);
    expect(colStyles(before)).toEqual(freshColStyles(editor));
    expect(colStyles(before)).toEqual(["min-width: 25px;", "min-width: 25px;"]);
  });

  it("폭 없는 표가 폭을 얻으면 min-width 를 버리고, 한 열만 얻으면 그 열만 바뀐다", () => {
    const editor = mount(doc(table(NONE, NONE)));
    const before = tableOf(editor);
    expect(colStyles(before)).toEqual(["min-width: 25px;", "min-width: 25px;"]);

    const next = editor.schema.nodeFromJSON(doc(table(W, NONE)));
    editor.view.updateState(
      EditorState.create({ doc: next, plugins: editor.state.plugins }),
    );

    expect(tableOf(editor)).toBe(before);
    expect(colStyles(before)).toEqual(freshColStyles(editor));
    expect(colStyles(before)).toEqual(["width: 120px;", "min-width: 25px;"]);
  });
});

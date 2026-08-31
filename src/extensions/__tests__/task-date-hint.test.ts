// §308 M3-c 태스크 줄에 날짜를 말로 적으면 알아보고, Tab이 확정한다.
//
// 실제 `EditorView`에 플러그인을 꽂고 진짜 키·조합 이벤트를 보낸다. 이 기능의 위험이
// 전부 그 층에 있기 때문이다 — Tab을 목록 들여쓰기에 제때 돌려주는가, 한글 조합 중에
// 밑줄을 걸지 않는가, 확정이 §303 자리에 쓰는가.
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { createBaramExtensions } from "../index";
import { Paragraph } from "../nodes/paragraph";
import { TaskItem } from "../nodes/task-item";
import { TaskList } from "../nodes/task-list";
import {
  createTaskDateHintPlugin,
  HINT_CLASS,
  TaskDateHint,
  taskDateHintKey,
} from "../plugins/task-date-hint";
import { taskLineText } from "../plugins/task-field-edit";
import { isVimExternalEdit } from "../plugins/vim/vim-keys";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", toDOM: () => ["p", 0] },
    tagNode: {
      atom: true,
      attrs: { name: {} },
      group: "inline",
      inline: true,
      toDOM: () => ["span", { class: "tag" }],
    },
    taskItem: {
      attrs: { state: { default: "todo" } },
      content: "paragraph block*",
      toDOM: () => ["li", 0],
    },
    taskList: { content: "taskItem+", group: "block", toDOM: () => ["ul", 0] },
    text: { group: "inline" },
  },
});

let view: EditorView;

/** 지금 걸려 있는 밑줄 구간. 없으면 `null`. */
function hint() {
  return taskDateHintKey.getState(view.state);
}

/** 실제로 그려진 밑줄 — 데코레이션이 DOM까지 갔는지 본다. */
function hintEl(): HTMLElement | null {
  return view.dom.querySelector<HTMLElement>(`.${HINT_CLASS}`);
}

/** 태스크 한 줄, 커서는 그 줄 끝. 두 번째 인자는 태스크 밖 문단이다. */
function mount(line: string, tail?: string): EditorView {
  const blocks = [
    schema.node("taskList", null, [
      schema.node(
        "taskItem",
        null,
        line
          ? [schema.node("paragraph", null, [schema.text(line)])]
          : [schema.node("paragraph")],
      ),
    ]),
  ];
  if (tail) blocks.push(schema.node("paragraph", null, [schema.text(tail)]));
  const doc = schema.node("doc", null, blocks);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const v = new EditorView(place, {
    state: EditorState.create({
      doc,
      plugins: [createTaskDateHintPlugin()],
      // 태스크 줄 끝. taskList(0) → taskItem(1) → paragraph(2) → 내용은 3부터다.
      selection: TextSelection.create(doc, 3 + line.length),
    }),
  });
  return v;
}

/** 진짜 keydown. 아무도 처리하지 않았으면 `false`. */
function compose(type: "compositionend" | "compositionstart") {
  view.dom.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
}

function press(key: string, shiftKey = false): boolean {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    shiftKey,
  });
  view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

const text = () => view.state.doc.firstChild!.firstChild!.firstChild!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 16, 10, 0, 0)); // 수요일
  useSettingsStore.setState({ locale: "en", tasksEnabled: true });
});

afterEach(() => {
  vi.useRealTimers();
  view?.destroy();
  document.body.innerHTML = "";
});

describe("알아보기", () => {
  it("커서 앞의 표현에 밑줄이 선다", () => {
    view = mount("보고서 내일");
    expect(hint()?.iso).toBe("2026-09-17");
    expect(hintEl()?.textContent).toBe("내일");
  });

  it("무엇으로 확정될지 툴팁이 말한다", () => {
    view = mount("보고서 내일");
    expect(hintEl()?.getAttribute("title")).toContain("2026-09-17");
  });

  it("‼️ 태스크 줄이 아니면 알아보지 않는다", () => {
    // 밑줄만 긋고 Tab이 아무것도 못 하는 상태를 만들지 않는다.
    // ‼️ 바깥 문단도 **날짜 표현으로 끝나야** 이 단정이 무언가를 가른다. 끝이 그냥
    // 본문이면 가드가 없어도 null이라 테스트가 통과만 하고 아무것도 보지 않는다.
    view = mount("보고서", "뭐 하지 내일");
    const outside = view.state.doc.content.size - 1;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, outside)),
    );
    expect(view.state.doc.lastChild?.textContent).toBe("뭐 하지 내일");
    expect(hint()).toBeNull();
  });

  it("‼️ 태스크 기능을 끄면 밑줄도 Tab도 없다", () => {
    // Tab이 문서를 고치는 조작이라, 껐는데 문서가 바뀌는 일이 없어야 한다.
    view = mount("보고서 내일");
    expect(hint()).not.toBeNull();

    useSettingsStore.setState({ tasksEnabled: false });
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
    );
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, 3 + "보고서 내일".length),
      ),
    );
    expect(hint()).toBeNull();
    // Tab은 저절로 원래 주인에게 간다 — 따로 막을 곳이 없다.
    expect(press("Tab")).toBe(false);
  });

  it("선택 구간이 있으면 알아보지 않는다", () => {
    // ‼️ 구간의 **시작**이 표현 끝에 놓여야 한다. `$from`이 다른 데 있으면 가드가
    // 없어도 못 알아보므로 테스트가 아무것도 가르지 못한다.
    view = mount("보고서 내일 준비");
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, 3 + 6, 3 + 9),
      ),
    );
    expect(hint()).toBeNull();
  });

  it("커서가 표현에서 떨어지면 밑줄이 사라진다", () => {
    view = mount("보고서 내일");
    expect(hint()).not.toBeNull();
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
    );
    expect(hint()).toBeNull();
  });
});

describe("‼️ Tab은 원래 주인에게 돌아간다", () => {
  it("알아본 것이 없으면 Tab을 잡지 않는다", () => {
    // 잡으면 태스크 목록에서 들여쓰기가 죽는다. 그건 훨씬 자주 쓰는 조작이다.
    view = mount("보고서 쓰기");
    expect(press("Tab")).toBe(false);
  });

  it("Shift+Tab은 알아본 것이 있어도 잡지 않는다", () => {
    // 내어쓰기다. 확정과 아무 상관이 없다.
    view = mount("보고서 내일");
    expect(press("Tab", true)).toBe(false);
    expect(taskLineText(text())).toBe("보고서 내일");
  });

  it("다른 키는 지나간다", () => {
    view = mount("보고서 내일");
    expect(press("Enter")).toBe(false);
  });
});

describe("확정", () => {
  it("말을 지우고 §303 자리에 필드를 준다", () => {
    view = mount("보고서 내일");
    expect(press("Tab")).toBe(true);
    expect(taskLineText(text())).toBe("보고서 📅2026-09-17");
  });

  it("이미 있는 우선순위 앞에 선다", () => {
    view = mount("보고서 ⏫");
    // 커서를 마커 뒤가 아니라 표현 뒤에 두어야 하므로 다시 짓는다.
    view.destroy();
    view = mount("보고서 ⏫ 다음 주 월요일");
    expect(press("Tab")).toBe(true);
    expect(taskLineText(text())).toBe("보고서 📅2026-09-28 ⏫");
  });

  it("표현 앞의 공백을 남기지 않는다", () => {
    view = mount("회의 3일 후");
    press("Tab");
    expect(taskLineText(text())).toBe("회의 📅2026-09-19");
  });

  it("‼️ 줄 가운데에서 확정해도 공백이 겹치지 않는다", () => {
    // 커서가 줄 끝일 때는 `insertToken`의 뒤 공백 정리가 덮어 주지만, 가운데에서는
    // 아무도 치워 주지 않는다 — `보고서  준비`처럼 두 칸이 남는다.
    view = mount("보고서 내일 준비");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3 + 6)),
    );
    expect(press("Tab")).toBe(true);
    expect(taskLineText(text())).toBe("보고서 준비 📅2026-09-17");
  });

  it("‼️ 지우는 것도 UI 크롬의 편집이다", () => {
    // 표시가 없으면 vim이 이것을 사용자의 편집으로 읽어 visual 선택을 normal로 접는다.
    // 확정은 두 트랜잭션이므로 **둘 다** 달아야 한다.
    view = mount("보고서 내일");
    const dispatch = vi.spyOn(view, "dispatch");
    press("Tab");
    expect(dispatch.mock.calls).toHaveLength(2);
    for (const [tr] of dispatch.mock.calls) {
      expect(isVimExternalEdit(tr)).toBe(true);
    }
  });

  it("확정하면 밑줄이 사라진다", () => {
    view = mount("보고서 내일");
    press("Tab");
    expect(hint()).toBeNull();
    expect(hintEl()).toBeNull();
  });

  it("‼️ 인라인 노드가 앞에 있어도 제자리에 쓴다", () => {
    // `#tag`는 글자 없이 자리를 먹는다. 오프셋을 위치로 착각하면 확정이 태그를 덮는다.
    const doc = schema.node("doc", null, [
      schema.node("taskList", null, [
        schema.node("taskItem", null, [
          schema.node("paragraph", null, [
            schema.text("보고서 "),
            schema.node("tagNode", { name: "deep-work" }),
            schema.text(" 내일"),
          ]),
        ]),
      ]),
    ]);
    const place = document.createElement("div");
    document.body.appendChild(place);
    view = new EditorView(place, {
      state: EditorState.create({
        doc,
        plugins: [createTaskDateHintPlugin()],
        selection: TextSelection.atEnd(doc),
      }),
    });

    expect(press("Tab")).toBe(true);
    expect(taskLineText(text())).toBe("보고서 ￼ 📅2026-09-17");
    expect(text().child(1).type.name).toBe("tagNode");
  });
});

describe("‼️ 한글 조합", () => {
  it("조합 중에는 밑줄을 걸지 않는다", () => {
    // 조합 중인 텍스트 노드를 span으로 감싸면 IME가 깨진다. 조합이 끝난 뒤에 그린다.
    view = mount("보고서 내일");
    expect(hintEl()).not.toBeNull();

    compose("compositionstart");
    // 조합 중에 온 트랜잭션 하나(사용자가 글자를 하나 더 친 셈).
    view.dispatch(view.state.tr.setMeta("test", true));
    expect(hintEl()).toBeNull();
  });

  it("조합이 끝나면 다시 그린다", () => {
    view = mount("보고서 내일");
    compose("compositionstart");
    view.dispatch(view.state.tr.setMeta("test", true));
    expect(hintEl()).toBeNull();

    compose("compositionend");
    expect(hintEl()?.textContent).toBe("내일");
  });

  it("조합 중에도 상태는 알고 있다 — 끝나면 바로 쓸 수 있다", () => {
    view = mount("보고서 내일");
    compose("compositionstart");
    expect(hint()?.iso).toBe("2026-09-17");
  });
});

// ── Tab 우선순위 — 실제 Tiptap 확장 둘을 함께 세워 본다 ────────────────────
//
// 위의 테스트들은 이 플러그인만 꽂은 raw view라 "Tab을 잡는다/안 잡는다"까지만 본다.
// 실제 앱에서 Tab의 원래 주인은 `TaskItem`의 `sinkListItem`이고, 둘 중 누가 먼저
// 보는지는 `index.ts`의 **배열 순서**가 정한다(Tiptap이 확장 목록을 뒤집어 쌓는다).
// 그 순서가 틀리면 여기 있는 어느 단정도 깨지지 않은 채 기능만 죽는다.
describe("‼️ TaskItem과 함께 세웠을 때", () => {
  function realEditor(line: string) {
    return new Editor({
      content: `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>${line}</p></li><li data-type="taskItem" data-checked="false"><p>${line}</p></li></ul>`,
      extensions: [Document, Paragraph, Text, TaskList, TaskItem, TaskDateHint],
    });
  }

  function tabOn(editor: Editor): void {
    editor.commands.focus("end");
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Tab",
      }),
    );
  }

  it("알아본 날짜가 있으면 들여쓰기가 아니라 확정이다", () => {
    const editor = realEditor("보고서 내일");
    tabOn(editor);
    expect(editor.getText()).toContain("📅2026-09-17");
    editor.destroy();
  });

  it("알아본 것이 없으면 Tab은 여전히 들여쓴다", () => {
    const editor = realEditor("보고서 쓰기");
    const before = editor.getHTML();
    tabOn(editor);
    // 둘째 항목이 첫째 아래로 들어가므로 중첩 목록이 생긴다.
    expect(editor.getHTML()).not.toBe(before);
    expect(editor.getText()).not.toContain("📅");
    editor.destroy();
  });

  it("‼️ 앱의 확장 배열도 그 순서다", () => {
    // 위 두 단정은 "이 순서라면 이렇게 된다"까지만 본다. 앱이 실제로 그 순서를
    // 쓰는지는 `index.ts`가 정하고, 거기가 바뀌면 위의 것들은 초록불인 채 기능만 죽는다.
    const names = createBaramExtensions().map((e) => e.name);
    expect(names.indexOf("taskDateHint")).toBeGreaterThan(
      names.indexOf("taskItem"),
    );
  });
});

import type { Node as PmNode } from "@tiptap/pm/model";

import { Editor } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
// §7.1/§303 빈 task item 라운드트립 — 체크박스가 저장에서 사라지면 안 된다.
//
// 사용자가 리스트를 타이핑하는 내내 문서 끝에는 빈 task item이 있고 자동
// 저장은 기본값이다. 그 창에서 저장이 떨어지면 파일에 task가 아닌 항목이
// 남는다 — MD → PM → MD 정확 일치(§8.4)가 깨진다.
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    bulletList: { content: "listItem+", group: "block" },
    orderedList: {
      content: "listItem+",
      group: "block",
      attrs: { start: { default: 1 } },
    },
    listItem: { content: "paragraph block*" },
    taskList: { content: "taskItem+", group: "block" },
    taskItem: {
      content: "paragraph block*",
      attrs: { state: { default: "todo" } },
    },
    text: { group: "inline" },
  },
  marks: {},
});

function emptyItem(checked: boolean): PmNode {
  return schema.nodes.taskItem.create({ state: checked ? "done" : "todo" }, [
    schema.nodes.paragraph.create(),
  ]);
}

/** 노드 트리를 "type[attr]>child" 형태의 한 줄 요약으로 만든다. */
function outline(node: PmNode): string {
  const label =
    node.type.name === "taskItem"
      ? `taskItem(${node.attrs.state === "done" ? "x" : " "})`
      : node.type.name;
  const kids: string[] = [];
  node.forEach((child) => {
    kids.push(child.isText ? JSON.stringify(child.text) : outline(child));
  });
  return kids.length > 0 ? `${label}>[${kids.join(",")}]` : label;
}

function roundtrip(md: string): string {
  return prosemirrorToMarkdown(markdownToProsemirror(md, schema));
}

function textItem(text: string, checked = false): PmNode {
  return schema.nodes.taskItem.create({ state: checked ? "done" : "todo" }, [
    schema.nodes.paragraph.create(null, schema.text(text)),
  ]);
}

describe("빈 task item 라운드트립", () => {
  // canonical 직렬화형은 후행 공백 없는 `- [ ]`다. GFM은 내용 없는 체크박스를
  // 아예 task로 파싱하지 않으므로(`- [ ]`도 `- [ ] `도 checked=null) 어느
  // 표기도 상호운용에서 이득이 없다 — 그래서 후행 공백이 없는 쪽을 고른다.
  it.each([
    ["빈 항목 하나", "- [ ]\n"],
    ["체크된 빈 항목", "- [x]\n"],
    ["내용 + 뒤따르는 빈 항목", "- [ ] a\n- [ ]\n"],
    ["내용 + 체크된 빈 항목", "- [ ] a\n- [x]\n"],
    ["빈 항목이 앞", "- [ ]\n- [x] b\n"],
    ["이모지 필드 + 빈 항목", "- [ ] a 📅2026-08-30\n- [ ]\n"],
    ["중첩된 빈 항목", "- [ ] a\n  - [ ]\n"],
  ])("정확 일치: %s", (_, md) => {
    expect(roundtrip(md)).toBe(md);
  });

  it("후행 공백 표기는 canonical 형으로 정규화되고 그 뒤로 안정적이다", () => {
    // `- [ ] `(후행 공백)와 `- [x] `도 빈 task로 읽되, 저장은 canonical 형으로
    // 한다. 1회 정규화 후에는 더 이상 바뀌지 않아야 한다.
    for (const [input, canonical] of [
      ["- [ ] \n", "- [ ]\n"],
      ["- [x] \n", "- [x]\n"],
      ["- [X]\n", "- [x]\n"],
      ["- [ ] a\n- [ ] \n", "- [ ] a\n- [ ]\n"],
    ]) {
      expect(roundtrip(input)).toBe(canonical);
      expect(roundtrip(canonical)).toBe(canonical);
    }
  });

  it("빈 항목을 taskItem으로 파싱한다 — 리터럴 `[ ]` listItem이 아니라", () => {
    expect(outline(markdownToProsemirror("- [ ] a\n- [ ]\n", schema))).toBe(
      'doc>[taskList>[taskItem( )>[paragraph>["a"]],taskItem( )>[paragraph]]]',
    );
    expect(outline(markdownToProsemirror("- [x]\n", schema))).toBe(
      "doc>[taskList>[taskItem(x)>[paragraph]]]",
    );
    expect(outline(markdownToProsemirror("- [ ] \n", schema))).toBe(
      "doc>[taskList>[taskItem( )>[paragraph]]]",
    );
    // 중첩 — 안쪽도 bulletList가 아니라 taskList여야 한다
    expect(outline(markdownToProsemirror("- [ ] a\n  - [ ]\n", schema))).toBe(
      'doc>[taskList>[taskItem( )>[paragraph>["a"],taskList>[taskItem( )>[paragraph]]]]]',
    );
  });

  it("빈 taskItem을 체크박스와 함께 직렬화한다 — 맨 `-`가 아니라", () => {
    // 측정된 결함: `- [ ] a 📅2026-08-30\n-\n` — 빈 항목이 맨 `-`가 되어
    // 되읽을 때 taskItem이 아닌 listItem이 됐다.
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.taskList.create(null, [
        textItem("a 📅2026-08-30"),
        emptyItem(false),
      ]),
    ]);
    const md = prosemirrorToMarkdown(doc);
    expect(md).toBe("- [ ] a 📅2026-08-30\n- [ ]\n");
    expect(outline(markdownToProsemirror(md, schema))).toBe(
      'doc>[taskList>[taskItem( )>[paragraph>["a 📅2026-08-30"]],taskItem( )>[paragraph]]]',
    );
  });

  it("체크된 빈 taskItem도 체크 상태를 잃지 않는다", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.taskList.create(null, [emptyItem(true)]),
    ]);
    expect(prosemirrorToMarkdown(doc)).toBe("- [x]\n");
  });

  it("첫 문단만 빈 다중 블록 taskItem도 리스트 밖으로 새지 않는다", () => {
    // 측정된 결함: `-\n[ ] \n  more\n` — 체크박스가 열 0의 제 줄로 튀어나와
    // 리스트 구조 자체가 깨졌다.
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.taskList.create(null, [
        schema.nodes.taskItem.create({ state: "todo" }, [
          schema.nodes.paragraph.create(),
          schema.nodes.paragraph.create(null, schema.text("more")),
        ]),
      ]),
    ]);
    const md = prosemirrorToMarkdown(doc);
    expect(md).toBe("- [ ]\n\n  more\n");
    expect(outline(markdownToProsemirror(md, schema))).toBe(
      'doc>[taskList>[taskItem( )>[paragraph,paragraph>["more"]]]]',
    );
  });

  it("task가 아닌 항목을 task로 만들지 않는다", () => {
    // 빈 불릿 항목은 그대로 빈 불릿 항목이다
    expect(roundtrip("-\n")).toBe("-\n");
    expect(outline(markdownToProsemirror("-\n", schema))).toBe(
      "doc>[bulletList>[listItem>[paragraph]]]",
    );
    // 체크박스 뒤에 공백 없이 글자가 붙으면 GFM도 task가 아니다
    expect(outline(markdownToProsemirror("- [ ]x\n", schema))).toBe(
      'doc>[bulletList>[listItem>[paragraph>["[ ]x"]]]]',
    );
    // `[y]`는 체크박스가 아니다
    expect(outline(markdownToProsemirror("- [y]\n", schema))).toBe(
      'doc>[bulletList>[listItem>[paragraph>["[y]"]]]]',
    );
    // 순서 있는 리스트의 빈 체크박스는 건드리지 않는다 — taskList는 불릿
    // 전용이라 여기서 task로 승격하면 번호가 사라진다
    expect(outline(markdownToProsemirror("1. [ ]\n", schema))).toBe(
      'doc>[orderedList>[listItem>[paragraph>["[ ]"]]]]',
    );
  });
});

describe("실제 에디터에서 타이핑 중인 리스트를 저장할 때", () => {
  // 위 테스트들이 최소 스키마로 파이프라인 양쪽 끝을 각각 못박는다면, 이
  // 테스트는 사용자 자리에서 둘이 실제로 만나는지를 본다: 실제 Baram 확장
  // 스택에서 Enter로 만들어진 문서를 그대로 직렬화한다.
  // `tiptap-toggle.test.ts` 의 선례를 따른다.
  it("끝의 빈 항목이 체크박스를 달고 저장된다", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    editor.commands.setContent(
      markdownToProsemirror("- [ ] a\n", editor.schema).toJSON(),
    );

    // 항목 끝에서 Enter — 여기서부터 다음 글자를 치기 전까지 문서 끝에는 빈
    // task item이 있다. 자동 저장이 떨어지는 창이 바로 이 구간이다.
    editor.commands.focus("end");
    editor.commands.splitListItem("taskItem");

    const md = prosemirrorToMarkdown(editor.state.doc);
    expect(md).toBe("- [ ] a\n- [ ]\n");

    // 되읽었을 때도 여전히 task 두 개다
    const items: PmNode[] = [];
    markdownToProsemirror(md, editor.schema).descendants((node) => {
      if (node.type.name === "taskItem") items.push(node);
    });
    expect(items).toHaveLength(2);
    expect(items[1].textContent).toBe("");
    expect(items[1].attrs.state).toBe("todo");

    editor.destroy();
  });
});

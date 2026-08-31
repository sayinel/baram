// §18.18 M4 — `⏱` 값이 **저장을 견디는가**.
//
// 이 파일이 있는 이유는 설계가 고른 구분자가 실제로 틀렸기 때문이다. `1h27m@14:03`의
// `@`를 직렬화가 `\@`로 이스케이프한다(GFM 이메일 자동링크 방어). 우리 파서는 그 백슬래시를
// 되읽으므로 왕복은 "성립"하지만, 파일에는 남고 남의 도구는 그냥 깨진 값을 본다 — 그리고
// 이 프로젝트의 최상위 품질 기준은 **바이트 단위 왕복**이다.
//
// 그래서 구분자는 실측으로 골랐고, 이 스위트가 그 선택을 못박는다. 값 문법 자체는
// `utils/tasks/__tests__/task-timer.test.ts`가 따로 본다.
import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

const schema = new Schema({
  nodes: {
    bulletList: { content: "listItem+", group: "block" },
    doc: { content: "block+" },
    listItem: { content: "paragraph block*" },
    paragraph: { content: "inline*", group: "block" },
    taskItem: {
      attrs: { state: { default: "todo" } },
      content: "paragraph block*",
    },
    taskList: { content: "taskItem+", group: "block" },
    text: { group: "inline" },
  },
});

function roundtrip(md: string): string {
  return prosemirrorToMarkdown(markdownToProsemirror(md, schema));
}

describe("§18.18 the timer field survives a save", () => {
  it.each([
    ["a stopped clock", "- [x] a ⏱1h27m\n"],
    ["a running clock", "- [/] a ⏱1h27m+2026-08-31T14:03\n"],
    ["zero", "- [/] a ⏱0m+2026-08-31T14:03\n"],
    ["beside every other field", "- [/] a 📅2026-09-01 ⏫ ⏱2h 🔁every week\n"],
  ])("preserves %s byte for byte", (_label, md) => {
    expect(roundtrip(md)).toBe(md);
  });

  // ‼️ 이것이 구분자를 바꾸게 만든 측정이다. 통과하는 이유가 "우리가 되읽어서"가
  // 아니라 "애초에 손대지 않아서"여야 한다 — 그래서 백슬래시의 부재를 직접 본다.
  it("puts no escape character in the file", () => {
    expect(roundtrip("- [/] a ⏱1h27m+2026-08-31T14:03\n")).not.toContain("\\");
  });

  // `@`를 골랐다면 어떻게 됐는지 — 이 줄이 그 선택이 왜 틀렸는지의 증거다.
  it("would have escaped the separator the design first proposed", () => {
    expect(roundtrip("- [/] a ⏱1h27m@2026-08-31T14:03\n")).toBe(
      "- [/] a ⏱1h27m\\@2026-08-31T14:03\n",
    );
  });
});

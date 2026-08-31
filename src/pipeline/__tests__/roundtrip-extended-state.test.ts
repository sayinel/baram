// M4 §18.18 risk 1 — SPIKE: can `[/]` and `[-]` survive a roundtrip?
//
// GFM recognises only `[ ]` and `[x]` as task items. `- [/] doing` parses as an
// ordinary list item whose text begins with `[/]`, and serialising it back
// escapes the bracket — the design measured `- \[/] doing`. The design calls
// this "the only real risk" in M4 and says to settle it before anything else,
// because roundtrip fidelity is this project's top bar.
//
// The question this file answers: can the pipeline carry a non-GFM state
// without escaping it, and without mistaking ordinary list items for tasks?
import type { Node as PmNode } from "@tiptap/pm/model";

import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

const schema = new Schema({
  // A link mark is needed only so `- [text](url)` can be parsed at all — that
  // case exists to prove the marker reader does not reach for it.
  marks: {
    link: { attrs: { href: { default: "" }, title: { default: null } } },
  },
  nodes: {
    bulletList: { content: "listItem+", group: "block" },
    doc: { content: "block+" },
    listItem: { content: "paragraph block*" },
    orderedList: {
      attrs: { start: { default: 1 } },
      content: "listItem+",
      group: "block",
    },
    paragraph: { content: "inline*", group: "block", marks: "_" },
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

/** "taskItem(/)" / "listItem" — enough to see what a line became. */
function outline(node: PmNode): string {
  const label =
    node.type.name === "taskItem"
      ? `taskItem(${node.attrs.state as string})`
      : node.type.name;
  const kids: string[] = [];
  node.forEach((child) => {
    kids.push(child.isText ? JSON.stringify(child.text) : outline(child));
  });
  return kids.length > 0 ? `${label}>[${kids.join(",")}]` : label;
}

function shape(md: string): string {
  const doc = markdownToProsemirror(md, schema);
  const parts: string[] = [];
  doc.forEach((child) => parts.push(outline(child)));
  return parts.join("|");
}

describe("M4 spike — extended task states roundtrip", () => {
  it.each([
    ["doing alone", "- [/] 진행 중\n"],
    ["cancelled alone", "- [-] 취소됨\n"],
    ["mixed with standard states", "- [ ] a\n- [/] b\n- [x] c\n"],
    ["doing between two standard", "- [x] a\n- [/] b\n- [ ] c\n"],
    ["two extended in a row", "- [/] a\n- [-] b\n"],
  ])("preserves %s", (_label, md) => {
    expect(roundtrip(md)).toBe(md);
  });

  it("parses an extended marker into a task item, not a bullet", () => {
    expect(shape("- [/] 진행 중\n")).toBe(
      'taskList>[taskItem(doing)>[paragraph>["진행 중"]]]',
    );
  });

  // ‼️ §7.1's failure mode, with a different marker. Serialising an item with
  // no text writes `- [/] ` and the trailing space is trimmed on the way out,
  // so the marker comes back as ordinary text and the control vanishes — a
  // save-and-reopen away from a task the user can no longer tick. It happens
  // whenever someone clears the text of a doing item, which is one Backspace
  // too many, and autosave is on by default.
  it("keeps an EMPTY extended item a task across a save", () => {
    expect(roundtrip("- [/]\n")).toBe("- [/]\n");
    expect(shape("- [/]\n")).toBe("taskList>[taskItem(doing)>[paragraph]]");
    expect(shape("- [-]\n")).toBe("taskList>[taskItem(cancelled)>[paragraph]]");
  });
});

// ‼️ The dangerous half. `[<char>]` at the start of a list item is ordinary
// markdown that people write for other reasons — a citation key, a numbered
// reference, a placeholder. Widening the parser to "any bracketed character"
// would silently turn those into tasks and rewrite the file on next save.
//
// These assert SHAPE, not bytes, because remark escapes a leading `[` in a list
// item (`- [1] x` saves as `- \[1] x`) to stop it being read as a link
// reference. That predates this work and is not ours to change here — see the
// note at the end of this file.
describe("M4 spike — ordinary list items stay ordinary", () => {
  it.each([
    ["a numbered reference", "- [1] 참조\n"],
    ["an uppercase word", "- [TODO] 나중에\n"],
    ["an empty bracket pair", "- [] 빈 괄호\n"],
    ["a bracket mid-line", "- 앞 [/] 뒤\n"],
  ])("does not turn %s into a task", (_label, md) => {
    expect(shape(md)).toContain("bulletList");
    expect(shape(md)).not.toContain("taskItem");
  });

  it("keeps a link-looking prefix a link, not a task", () => {
    expect(shape("- [text](https://example.com)\n")).not.toContain("taskItem");
  });

  it("requires the space, so `[x]y` is not a marker", () => {
    // The marker is `[/] ` including the space. Without it there is no way to
    // tell a state from the start of a word.
    expect(shape("- [/]붙여쓰기\n")).not.toContain("taskItem");
  });
});

// FINDING (M4 spike, 2026-08-31) — pre-existing, NOT introduced here:
// remark escapes a leading `[` in a list item, so `- [1] 참조` round-trips to
// `- \[1] 참조`. That is a byte-level roundtrip violation against this
// project's top quality bar, and it affects ordinary markdown, not just tasks.
// It is left alone deliberately: the escape is remark's defence against the
// text being re-read as a link reference, and undoing it is a separate
// question from adding task states. Recorded so the next person does not
// discover it as a regression of this change.
describe("M4 spike — the escaping that was already there", () => {
  it("still escapes a leading bracket on an ordinary item", () => {
    expect(roundtrip("- [1] 참조\n")).toBe("- \\[1] 참조\n");
  });
});

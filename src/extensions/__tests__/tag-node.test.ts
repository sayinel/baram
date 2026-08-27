import { Schema } from "@tiptap/pm/model";
// §56m Tag Node tests — regex + serialization + roundtrip
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import {
  serializeTag,
  TAG_NODE_RE,
} from "../../pipeline/transformers/tag-transformer";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    blockquote: { content: "block+", group: "block" },
    bulletList: { content: "listItem+", group: "block" },
    orderedList: {
      content: "listItem+",
      group: "block",
      attrs: { start: { default: 1 } },
    },
    listItem: { content: "paragraph block*" },
    // 태그가 태스크 줄 안에 있을 때도 같은 어휘여야 한다 — 이월 결함이 보고된
    // 형태가 정확히 `- [ ] 초안 #someday-maybe 📅…`다.
    taskList: { content: "taskItem+", group: "block" },
    taskItem: {
      content: "paragraph block*",
      attrs: { checked: { default: false } },
    },
    codeBlock: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { language: { default: null } },
    },
    tagNode: {
      group: "inline",
      inline: true,
      atom: true,
      marks: "",
      attrs: { tag: { default: "" } },
    },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
  },
  marks: { bold: {}, italic: {}, code: { excludes: "_" }, strike: {} },
});

function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

describe("Tag Node", () => {
  describe("TAG_NODE_RE", () => {
    it("matches simple tag", () => {
      const text = "Hello #world tag";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("world");
    });

    it("matches tag at start of string", () => {
      const text = "#project is great";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("project");
    });

    it("matches nested tag with slash", () => {
      const text = "#project/baram is great";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("project/baram");
    });

    it("matches Korean tag", () => {
      const text = "오늘 #일기 쓰기";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("일기");
    });

    it("matches multiple tags", () => {
      const text = "#hello and #world";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(2);
      expect(matches[0][1]).toBe("hello");
      expect(matches[1][1]).toBe("world");
    });

    it("does not match heading (space after #)", () => {
      // "# Heading" has space after #, not word char
      const text = "# Heading text";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(0);
    });

    // ‼️ 하이픈은 태그 글자다. 인덱서(`md::INLINE_TAG_RE`)와 쓰는 쪽
    // (`task/tag.rs::is_tag_char`)이 이미 그렇게 보므로, 에디터만 하이픈에서 끊으면
    // 태그 패널이 `deep-work`라고 하는 것을 문서에서는 `#deep` + `-work`로 그린다.
    it("takes a hyphen as part of the tag, not as a boundary", () => {
      for (const [text, want] of [
        ["메모 #deep-work 끝", "deep-work"],
        ["- [ ] 초안 #someday-maybe 📅2026-08-30", "someday-maybe"],
        ["#a-b-c 여러 마디", "a-b-c"],
        ["중첩 #parent/child-two 끝", "parent/child-two"],
        ["한글 #할-일 끝", "할-일"],
      ]) {
        const m = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
        expect(m).toHaveLength(1);
        expect(m[0][1]).toBe(want);
      }
    });

    it("does not match mid-word hash", () => {
      // "abc#def" — # is not at start or after whitespace
      const text = "abc#def";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(0);
    });
  });

  describe("roundtrip", () => {
    it.each([
      ["tag in middle", "Hello #world tag"],
      ["tag at start", "#project is great"],
      ["multiple tags", "#hello and #world"],
      ["Korean tag", "오늘 #일기 쓰기"],
      ["nested tag", "#project/baram nested"],
      ["tag at end", "text #end"],
      ["tag with trailing space", "text #end "],
      // 하이픈 어휘가 라운드트립을 깨지 않는가 — 태그 노드가 되든 안 되든 바이트는
      // 같아야 한다. 이 줄들이 M2-b2 이월 결함(`#someday-maybe` 미룸 해제 불가)이
      // 겨냥한 실제 형태다.
      ["hyphenated tag", "메모 #deep-work 끝"],
      ["multi-segment hyphens", "#a-b-c 여러 마디"],
      ["nested with hyphen", "중첩 #parent/child-two 끝"],
      ["Korean hyphenated tag", "한글 #할-일 끝"],
      ["date-shaped tag", "#2026-08-27 회고"],
      [
        "hyphenated tag in a task line",
        "- [ ] 초안 #someday-maybe 📅2026-08-30",
      ],
    ])("%s: roundtrip preserves %s", (_label, input) => {
      const output = roundtrip(input);
      // remark-stringify adds trailing newline; strip for comparison
      expect(output.replace(/\n$/, "")).toBe(input.trimEnd());
    });

    it("no &#x20; when tagNode followed by space-only text node", () => {
      // Simulates InputRule: tagNode + text(" ") at end of paragraph
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("Hello "),
          schema.nodes.tagNode.create({ tag: "world" }),
          schema.text(" "),
        ]),
      ]);
      const md = prosemirrorToMarkdown(doc);
      expect(md).not.toContain("&#x20;");
      expect(md.replace(/\n$/, "")).toBe("Hello #world");
    });
  });

  describe("serializeTag", () => {
    it("serializes simple tag", () => {
      expect(serializeTag({ tag: "world" })).toBe("#world");
    });

    it("serializes nested tag", () => {
      expect(serializeTag({ tag: "project/baram" })).toBe("#project/baram");
    });

    it("serializes Korean tag", () => {
      expect(serializeTag({ tag: "일기" })).toBe("#일기");
    });
  });
});

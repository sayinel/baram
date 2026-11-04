// §5.1 — what an HTML block's text reads back as when the file is opened
// again, which decides how an edit to the block is committed
// (html-block-commit.test.tsx drives the block itself).
import { Editor } from "@tiptap/core";
import { afterAll, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../..";
import { markdownParser } from "../../../../pipeline/markdown-parser";
import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { htmlBlockContext, readHtmlBlock } from "../html-block-read-back";

const editor = new Editor({ content: "", extensions: createBaramExtensions() });
const schema = editor.schema;

afterAll(() => editor.destroy());

function kindOf(content: string): string {
  const reading = readHtmlBlock(content, schema);
  return reading.kind === "otherwise"
    ? `otherwise${reading.merges ? ", merges" : ""}`
    : reading.kind;
}

describe("text the file reads back as other blocks, the same", () => {
  // What fails these: keeping the text as one HTML block whenever it reads
  // as anything else.
  it.each([
    ["a blank line inside a div", "<div>\n\nhello\n</div>"],
    ["a line of only spaces inside a div", "<div>\n  \nhello\n</div>"],
    ["plain words", "plain words"],
    ["nothing", ""],
    ["a table", "| a |\n|---|\n| b |"],
    // What fails this one: comparing whether a list is loose, which the
    // editor drops from every list.
    ["a loose list", "- a\n\n- b"],
  ])("%s", (_label, content) => {
    expect(kindOf(content)).toBe("blocks");
  });
});

describe("where the block stands", () => {
  function typesIn(content: string, atStart: boolean, footnotes: string[]) {
    const reading = readHtmlBlock(content, schema, { atStart, footnotes });
    if (reading.kind !== "blocks") return reading.kind;
    const types: string[] = [];
    reading.blocks.descendants((node) => {
      types.push(node.type.name);
    });
    return types;
  }

  // What fails this: reading without the document's footnote definitions —
  // `[^1]` is then text, saved escaped, and the reference is gone.
  it("reads a footnote reference whose definition is elsewhere", () => {
    expect(typesIn("See[^1] here", false, ["1"])).toContain("footnoteRef");
  });

  // What fails this: reading after a paragraph, where `---` is a rule and the
  // line under it a heading.
  it("reads front matter in the document's first block", () => {
    expect(typesIn("---\ntitle: x\n---", true, [])).toEqual([
      "frontmatter",
      "text",
    ]);
  });

  it("is taken from the document", () => {
    const doc = markdownToProsemirror(
      "<div>x</div>\n\ntext[^a] and[^B]\n\n[^a]: one\n\n[^B]: two\n",
      schema,
    );
    expect(htmlBlockContext(doc, 0)).toEqual({
      atStart: true,
      footnotes: ["a", "b"],
    });
    expect(htmlBlockContext(doc, 1).atStart).toBe(false);
  });
});

describe("text the file reads as something else", () => {
  // What fails these: taking the blocks whenever the text reads as other
  // blocks, without asking whether they save as the same markdown — or, for
  // the list item, without asking the schema.
  it.each([
    ["an image tag, written back as an image", '<img src="a.png">'],
    ["a highlight tag, written back as `==x==`", "<mark>x</mark>"],
    ["an inline tag, read as its text", '<span style="color:red">warn</span>'],
    ["an empty pair of tags", "x <u></u>y"],
    ["a definition no link uses", "[foo]: /u"],
    ["a reference and its definition", "[a][x]\n\n[x]: /u"],
    ["a code fence's info string after the language", "```js title=x\nc\n```"],
    [
      "details with a class",
      '<details class="x">\n<summary>s</summary>\n\nbody\n\n</details>',
    ],
    ["a list item that starts with an HTML block", "- <div>x</div>"],
  ])("%s", (_label, content) => {
    expect(kindOf(content)).toBe("otherwise");
  });
});

describe("text that merges with the blocks next to it", () => {
  // What fails these: reading the text alone, with no paragraph before or
  // after it to merge with.
  it.each([
    ["an unclosed comment", "<!-- note"],
    ["an unclosed pre", "<pre>\nfoo"],
    ["an unclosed code fence", "```\ncode"],
    ["a definition list's description", ": x"],
  ])("%s", (_label, content) => {
    expect(kindOf(content)).toBe("otherwise, merges");
  });
});

describe("text that reads back as itself", () => {
  it.each([
    ["a div", "<div>x</div>"],
    ["an empty comment", "<!---->"],
  ])("%s", (_label, content) => {
    expect(kindOf(content)).toBe("itself");
  });
});

describe("what it costs", () => {
  // Counted, not timed: text that reaches the comparison is parsed three
  // times — read as the file would, and as a tree beside the tree its blocks
  // save as — however long it is or however much of it changes on the way
  // (text that reads as itself or merges, once). What fails this: asking
  // anything per block or per node with the parser.
  it.each([5, 40])("parses three times for %i changed paragraphs", (n) => {
    const parse = vi.spyOn(markdownParser, "parse");
    try {
      const text = Array.from(
        { length: n },
        (_, i) => `H<sub>${i}</sub>O and <mark>m</mark>`,
      ).join("\n\n");
      expect(kindOf(text)).toBe("otherwise");
      expect(parse).toHaveBeenCalledTimes(3);
    } finally {
      parse.mockRestore();
    }
  });
});

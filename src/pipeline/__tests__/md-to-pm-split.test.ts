// Tests for md-to-pm split: mutation-free conversion, text-splitter generic function
import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { extractBlockIdFromMdast } from "../convert-block-special";
import {
  splitTextWithBlockRefs,
  splitTextWithCustomInlineMarks,
  splitTextWithMentions,
  splitTextWithPattern,
  splitTextWithTags,
  splitTextWithWikilinks,
} from "../convert-inline-text";
import { markdownToProsemirror } from "../md-to-pm";

// Schema with blockId, wikilink, mention, blockReference, tagNode, custom marks
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      marks: "_",
      attrs: { blockId: { default: null } },
    },
    heading: {
      content: "inline*",
      group: "block",
      attrs: {
        level: { default: 1 },
        blockId: { default: null },
      },
    },
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
      attrs: { checked: { default: false } },
    },
    blockquote: { content: "block+", group: "block" },
    horizontalRule: { group: "block" },
    codeBlock: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { language: { default: null } },
    },
    image: {
      group: "block",
      atom: true,
      attrs: {
        src: { default: null },
        alt: { default: null },
        title: { default: null },
      },
    },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
    wikilink: {
      atom: true,
      inline: true,
      group: "inline",
      attrs: {
        target: { default: "" },
        display: { default: null },
        heading: { default: null },
        blockId: { default: null },
      },
    },
    mention: {
      atom: true,
      inline: true,
      group: "inline",
      attrs: {
        type: { default: "page" },
        value: { default: "" },
      },
    },
    blockReference: {
      atom: true,
      inline: true,
      group: "inline",
      attrs: {
        target: { default: "" },
        blockId: { default: null },
        display: { default: null },
      },
    },
    tagNode: {
      atom: true,
      inline: true,
      group: "inline",
      attrs: { tag: { default: "" } },
    },
  },
  marks: {
    bold: {},
    italic: {},
    code: { excludes: "_" },
    strike: {},
    highlight: {},
    subscript: {},
    superscript: {},
    link: {
      attrs: {
        href: { default: null },
        title: { default: null },
      },
      inclusive: false,
    },
  },
});

// ─── §30a: mdast mutation-free conversion ────────────────────────────────────

describe("mdast mutation-free: extractBlockIdFromMdast", () => {
  it("should not mutate the original node children", () => {
    const node = {
      type: "paragraph" as const,
      children: [{ type: "text" as const, value: "Hello world ^block123" }],
    };
    const originalChildren = JSON.parse(JSON.stringify(node.children));

    const result = extractBlockIdFromMdast(node);

    expect(result).not.toBeNull();
    expect(result!.blockId).toBe("block123");
    // Original node must be untouched
    expect(node.children).toEqual(originalChildren);
  });

  it("should return new stripped children without modifying original", () => {
    const originalText = { type: "text" as const, value: "Some text ^abc" };
    const node = {
      type: "heading" as const,
      children: [originalText],
    };

    const result = extractBlockIdFromMdast(node);

    expect(result).not.toBeNull();
    expect(result!.strippedChildren).not.toBe(node.children);
    // Original text node must be unchanged
    expect(originalText.value).toBe("Some text ^abc");
  });

  it("should return null when no block ID present", () => {
    const node = {
      type: "paragraph" as const,
      children: [{ type: "text" as const, value: "No block id here" }],
    };
    expect(extractBlockIdFromMdast(node)).toBeNull();
  });
});

describe("mdast mutation-free: markdownToProsemirror block ID", () => {
  it("should convert paragraph with block ID without mutating mdast", () => {
    const md = "Hello world ^block123\n";
    // Converting twice should produce the same result (no mutation side-effects)
    const doc1 = markdownToProsemirror(md, schema);
    const doc2 = markdownToProsemirror(md, schema);
    expect(doc1.toJSON()).toEqual(doc2.toJSON());
  });

  it("should extract blockId into paragraph attrs", () => {
    const md = "Hello world ^block123\n";
    const doc = markdownToProsemirror(md, schema);
    const para = doc.firstChild!;
    expect(para.attrs.blockId).toBe("block123");
    expect(para.textContent).toBe("Hello world");
  });

  it("should extract blockId from heading", () => {
    const md = "# Title ^hid\n";
    const doc = markdownToProsemirror(md, schema);
    const heading = doc.firstChild!;
    expect(heading.attrs.blockId).toBe("hid");
    expect(heading.textContent).toBe("Title");
  });
});

// ─── splitTextWithPattern generic function ───────────────────────────────────

describe("splitTextWithPattern", () => {
  it("should split text at pattern boundaries", () => {
    const re = /\[\[(\w+)\]\]/g;
    const nodes = splitTextWithPattern(
      "before [[link]] after",
      re,
      [],
      schema,
      (match) => schema.nodes.wikilink.create({ target: match[1] }),
    );
    expect(nodes).toHaveLength(3);
    expect(nodes[0].isText).toBe(true);
    expect(nodes[0].textContent).toBe("before ");
    expect(nodes[1].type.name).toBe("wikilink");
    expect(nodes[1].attrs.target).toBe("link");
    expect(nodes[2].isText).toBe(true);
    expect(nodes[2].textContent).toBe(" after");
  });

  it("should return empty array when no matches", () => {
    const re = /\[\[(\w+)\]\]/g;
    const nodes = splitTextWithPattern("no links here", re, [], schema, () =>
      schema.nodes.wikilink.create({ target: "x" }),
    );
    expect(nodes).toEqual([]);
  });

  it("should handle match at start of string", () => {
    const re = /\[\[(\w+)\]\]/g;
    const nodes = splitTextWithPattern(
      "[[first]] rest",
      re,
      [],
      schema,
      (match) => schema.nodes.wikilink.create({ target: match[1] }),
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0].type.name).toBe("wikilink");
    expect(nodes[1].textContent).toBe(" rest");
  });

  it("should handle match at end of string", () => {
    const re = /\[\[(\w+)\]\]/g;
    const nodes = splitTextWithPattern(
      "text [[end]]",
      re,
      [],
      schema,
      (match) => schema.nodes.wikilink.create({ target: match[1] }),
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0].textContent).toBe("text ");
    expect(nodes[1].type.name).toBe("wikilink");
  });

  it("should handle multiple matches", () => {
    const re = /\[\[(\w+)\]\]/g;
    const nodes = splitTextWithPattern(
      "a [[b]] c [[d]] e",
      re,
      [],
      schema,
      (match) => schema.nodes.wikilink.create({ target: match[1] }),
    );
    expect(nodes).toHaveLength(5); // text, wikilink, text, wikilink, text
  });

  it("should apply parent marks to text nodes", () => {
    const re = /\[\[(\w+)\]\]/g;
    const boldMark = schema.marks.bold.create();
    const nodes = splitTextWithPattern(
      "before [[link]] after",
      re,
      [boldMark],
      schema,
      (match) => schema.nodes.wikilink.create({ target: match[1] }),
    );
    // Text nodes should have bold mark
    expect(nodes[0].marks).toHaveLength(1);
    expect(nodes[0].marks[0].type.name).toBe("bold");
    expect(nodes[2].marks).toHaveLength(1);
  });
});

// ─── Text splitter thin wrappers ─────────────────────────────────────────────

describe("splitTextWithWikilinks", () => {
  it("should parse simple wikilink", () => {
    const nodes = splitTextWithWikilinks("see [[PageA]]", schema, []);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].textContent).toBe("see ");
    expect(nodes[1].type.name).toBe("wikilink");
    expect(nodes[1].attrs.target).toBe("PageA");
  });

  it("should parse wikilink with display text", () => {
    const nodes = splitTextWithWikilinks("[[Target|Label]]", schema, []);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].attrs.target).toBe("Target");
    expect(nodes[0].attrs.display).toBe("Label");
  });

  it("should return empty for no wikilinks", () => {
    const nodes = splitTextWithWikilinks("plain text", schema, []);
    expect(nodes).toEqual([]);
  });
});

describe("splitTextWithBlockRefs", () => {
  it("should parse block reference", () => {
    const nodes = splitTextWithBlockRefs("ref ((page#^abc123))", schema, []);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].textContent).toBe("ref ");
    expect(nodes[1].type.name).toBe("blockReference");
    expect(nodes[1].attrs.blockId).toBe("abc123");
    expect(nodes[1].attrs.target).toBe("page");
  });

  it("should return empty for no block refs", () => {
    const nodes = splitTextWithBlockRefs("just text", schema, []);
    expect(nodes).toEqual([]);
  });
});

describe("splitTextWithMentions", () => {
  it("should parse mention", () => {
    const nodes = splitTextWithMentions("hello @[[Alice]]", schema, []);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].textContent).toBe("hello ");
    expect(nodes[1].type.name).toBe("mention");
  });

  it("should return empty for no mentions", () => {
    const nodes = splitTextWithMentions("no mentions", schema, []);
    expect(nodes).toEqual([]);
  });
});

describe("splitTextWithTags", () => {
  it("should parse tag at start", () => {
    const nodes = splitTextWithTags("#hello world", schema, []);
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    // first should be tagNode
    const tagNode = nodes.find((n) => n.type.name === "tagNode");
    expect(tagNode).toBeDefined();
    expect(tagNode!.attrs.tag).toBe("hello");
  });

  it("should parse tag after space", () => {
    const nodes = splitTextWithTags("text #tag1", schema, []);
    expect(nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("should return empty for no tags", () => {
    const nodes = splitTextWithTags("no tags here", schema, []);
    expect(nodes).toEqual([]);
  });
});

describe("splitTextWithCustomInlineMarks", () => {
  it("should parse highlight ==text==", () => {
    const nodes = splitTextWithCustomInlineMarks(
      "before ==hi== after",
      schema,
      [],
    );
    expect(nodes).toHaveLength(3);
    expect(nodes[0].textContent).toBe("before ");
    expect(nodes[1].textContent).toBe("hi");
    expect(nodes[1].marks[0].type.name).toBe("highlight");
    expect(nodes[2].textContent).toBe(" after");
  });

  it("should parse superscript ^text^", () => {
    const nodes = splitTextWithCustomInlineMarks("x^2^y", schema, []);
    expect(nodes).toHaveLength(3);
    expect(nodes[1].marks[0].type.name).toBe("superscript");
  });

  it("should parse subscript ~text~", () => {
    const nodes = splitTextWithCustomInlineMarks("H~2~O", schema, []);
    expect(nodes).toHaveLength(3);
    expect(nodes[1].marks[0].type.name).toBe("subscript");
  });

  it("should return empty for no custom marks", () => {
    const nodes = splitTextWithCustomInlineMarks("plain text", schema, []);
    expect(nodes).toEqual([]);
  });
});

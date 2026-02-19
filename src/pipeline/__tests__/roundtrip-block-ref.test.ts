// §30b Block Reference + Block Embed roundtrip tests — MD → ProseMirror → MD
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

// Schema with blockReference (inline atom) and blockEmbed (block atom)
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
    blockquote: { content: "block+", group: "block" },
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
    horizontalRule: { group: "block" },
    image: {
      group: "block",
      atom: true,
      attrs: {
        src: { default: null },
        alt: { default: null },
        title: { default: null },
      },
    },
    codeBlock: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { language: { default: null } },
    },
    hardBreak: { inline: true, group: "inline" },
    blockReference: {
      inline: true,
      group: "inline",
      atom: true,
      marks: "",
      attrs: {
        target: { default: "" },
        blockId: { default: "" },
        display: { default: null },
      },
    },
    blockEmbed: {
      group: "block",
      atom: true,
      attrs: {
        target: { default: "" },
        blockId: { default: "" },
      },
    },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    code: { excludes: "_" },
    strike: {},
    link: {
      attrs: {
        href: { default: null },
        title: { default: null },
      },
      inclusive: false,
    },
    underline: {},
  },
});

function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

describe("§30b Block Reference Roundtrip", () => {
  it("((target#^id)) basic reference", () => {
    const input = "See ((architecture#^a3f2b1c8))\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("((target#^id|display)) with display text", () => {
    const input = "See ((architecture#^a3f2b1c8|핵심 원칙))\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("((#^id)) same-file reference", () => {
    const input = "Refer to ((#^a3f2b1c8))\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("text ((ref)) more text — block ref in middle of text", () => {
    const input = "before ((file#^abc123)) after\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("multiple block references in one paragraph", () => {
    const input = "See ((a#^id1)) and ((b#^id2))\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("**bold** followed by block ref", () => {
    const input = "**bold** ((file#^id1))\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("block ref followed by *italic*", () => {
    const input = "((file#^id1)) *italic*\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("((no-hash)) without #^ is NOT converted — stays as text", () => {
    const input = "((no-hash))\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("blockquote with block ref", () => {
    const input = "> see ((file#^id1))\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("list item with block ref", () => {
    const input = "- item ((file#^id1))\n";
    expect(roundtrip(input)).toBe(input);
  });
});

describe("§30b Block Embed Roundtrip", () => {
  it("{{embed ((target#^id))}} basic embed", () => {
    const input = "{{embed ((architecture#^a3f2b1c8))}}\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("{{embed ((#^id))}} same-file embed", () => {
    const input = "{{embed ((#^abc123))}}\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("embed with surrounding paragraphs", () => {
    const input = "before\n\n{{embed ((file#^id1))}}\n\nafter\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("embed text with extra content is NOT converted — stays as paragraph", () => {
    const input = "{{embed ((file#^id1))}} extra text\n";
    expect(roundtrip(input)).toBe(input);
  });
});

describe("§30b Block Reference PM Structure", () => {
  it("blockReference node has correct attrs", () => {
    const doc = markdownToProsemirror("See ((file#^abc123|display))\n", schema);
    const para = doc.firstChild!;
    expect(para.type.name).toBe("paragraph");
    // "See " text + blockReference node
    let foundRef = false;
    para.forEach((child) => {
      if (child.type.name === "blockReference") {
        foundRef = true;
        expect(child.attrs.target).toBe("file");
        expect(child.attrs.blockId).toBe("abc123");
        expect(child.attrs.display).toBe("display");
      }
    });
    expect(foundRef).toBe(true);
  });

  it("blockReference without display has null display", () => {
    const doc = markdownToProsemirror("((file#^abc123))\n", schema);
    const para = doc.firstChild!;
    let foundRef = false;
    para.forEach((child) => {
      if (child.type.name === "blockReference") {
        foundRef = true;
        expect(child.attrs.display).toBeNull();
      }
    });
    expect(foundRef).toBe(true);
  });

  it("same-file ref has empty target", () => {
    const doc = markdownToProsemirror("((#^abc123))\n", schema);
    const para = doc.firstChild!;
    let foundRef = false;
    para.forEach((child) => {
      if (child.type.name === "blockReference") {
        foundRef = true;
        expect(child.attrs.target).toBe("");
        expect(child.attrs.blockId).toBe("abc123");
      }
    });
    expect(foundRef).toBe(true);
  });
});

describe("§30b Block Embed PM Structure", () => {
  it("blockEmbed node has correct attrs", () => {
    const doc = markdownToProsemirror("{{embed ((file#^abc123))}}\n", schema);
    const embed = doc.firstChild!;
    expect(embed.type.name).toBe("blockEmbed");
    expect(embed.attrs.target).toBe("file");
    expect(embed.attrs.blockId).toBe("abc123");
  });

  it("same-file embed has empty target", () => {
    const doc = markdownToProsemirror("{{embed ((#^abc123))}}\n", schema);
    const embed = doc.firstChild!;
    expect(embed.type.name).toBe("blockEmbed");
    expect(embed.attrs.target).toBe("");
    expect(embed.attrs.blockId).toBe("abc123");
  });

  it("embed with extra text stays as paragraph (not blockEmbed)", () => {
    const doc = markdownToProsemirror("{{embed ((file#^id1))}} extra\n", schema);
    const node = doc.firstChild!;
    expect(node.type.name).toBe("paragraph");
  });
});

describe("§30b Schema guard — no blockReference in schema", () => {
  const schemaNoRef = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: {
        content: "inline*",
        group: "block",
        marks: "_",
        attrs: { blockId: { default: null } },
      },
      text: { group: "inline" },
    },
    marks: {},
  });

  it("((...)) stays as plain text when schema lacks blockReference", () => {
    const input = "See ((file#^abc123))\n";
    const doc = markdownToProsemirror(input, schemaNoRef);
    const output = prosemirrorToMarkdown(doc);
    expect(output).toBe(input);
  });
});

describe("§30b Schema guard — no blockEmbed in schema", () => {
  const schemaNoEmbed = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: {
        content: "inline*",
        group: "block",
        marks: "_",
        attrs: { blockId: { default: null } },
      },
      text: { group: "inline" },
    },
    marks: {},
  });

  it("{{embed ((...))}} stays as paragraph text when schema lacks blockEmbed", () => {
    const input = "{{embed ((file#^abc123))}}\n";
    const doc = markdownToProsemirror(input, schemaNoEmbed);
    const output = prosemirrorToMarkdown(doc);
    expect(output).toBe(input);
  });
});

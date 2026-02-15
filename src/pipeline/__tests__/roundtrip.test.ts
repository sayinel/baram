// Roundtrip tests — MD → ProseMirror → MD 변환 정합성 검증
// §8.4 최우선 품질 기준: 변환 후 원본과 정확히 일치해야 함
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

// Build a schema matching our extensions
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
  },
});

/** Helper: roundtrip a markdown string and compare */
function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

describe("Roundtrip: Headings", () => {
  it.each([
    ["H1", "# Heading 1\n"],
    ["H2", "## Heading 2\n"],
    ["H3", "### Heading 3\n"],
    ["H4", "#### Heading 4\n"],
    ["H5", "##### Heading 5\n"],
    ["H6", "###### Heading 6\n"],
  ])("%s roundtrip", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Roundtrip: Paragraphs", () => {
  it("simple paragraph", () => {
    expect(roundtrip("Hello world\n")).toBe("Hello world\n");
  });

  it("multiple paragraphs", () => {
    const input = "First paragraph\n\nSecond paragraph\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("preserves one empty paragraph between blocks", () => {
    const input = "Hello\n\n\n\nWorld\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("preserves two empty paragraphs between blocks", () => {
    const input = "Hello\n\n\n\n\n\nWorld\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("preserves empty paragraph between heading and paragraph", () => {
    const input = "# Title\n\n\n\nContent\n";
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Roundtrip: Blockquote", () => {
  it("simple blockquote", () => {
    const input = "> This is a quote\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("multi-line blockquote", () => {
    const input = "> Line one\n> Line two\n";
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Roundtrip: Lists", () => {
  it("bullet list", () => {
    const input = "- Item 1\n- Item 2\n- Item 3\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("ordered list", () => {
    const input = "1. First\n2. Second\n3. Third\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("task list", () => {
    const input = "- [ ] Todo\n- [x] Done\n";
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Roundtrip: Horizontal Rule", () => {
  it("thematic break", () => {
    const input = "---\n";
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Roundtrip: Code Block", () => {
  it("fenced code block with language", () => {
    const input = "```javascript\nconst x = 1;\n```\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("fenced code block without language", () => {
    const input = "```\nplain code\n```\n";
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Roundtrip: Inline Marks", () => {
  it("bold text", () => {
    const input = "This is **bold** text\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("italic text", () => {
    const input = "This is *italic* text\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("inline code", () => {
    const input = "This is `code` text\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("strikethrough", () => {
    const input = "This is ~~deleted~~ text\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("link", () => {
    const input = "Click [here](https://example.com) to visit\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("link with title", () => {
    const input = 'Click [here](https://example.com "Example") to visit\n';
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Roundtrip: Image", () => {
  it("basic image", () => {
    const input = "![Alt text](https://example.com/image.png)\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("image with title", () => {
    const input = '![Alt text](https://example.com/image.png "Title")\n';
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Roundtrip: Combined", () => {
  it("heading with bold text", () => {
    const input = "## **Bold** heading\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("paragraph with multiple marks", () => {
    const input = "This is **bold** and *italic* and `code`\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("complex document", () => {
    const input = [
      "# Title",
      "",
      "A paragraph with **bold** and *italic* text.",
      "",
      "> A blockquote",
      "",
      "- Item 1",
      "- Item 2",
      "",
      "---",
      "",
      "1. First",
      "2. Second",
      "",
      "```python",
      "print('hello')",
      "```",
      "",
    ].join("\n");
    expect(roundtrip(input)).toBe(input);
  });
});

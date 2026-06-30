import { Schema } from "@tiptap/pm/model";
// §5.5 Mermaid Block roundtrip tests
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

// Schema with mermaidBlock node
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    codeBlock: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { language: { default: null } },
    },
    mermaidBlock: {
      group: "block",
      atom: true,
      attrs: {
        code: { default: "" },
        width: { default: null },
        caption: { default: null },
      },
    },
    mathBlock: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { formula: { default: "" } },
    },
    horizontalRule: { group: "block" },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    code: { excludes: "_" },
  },
});

function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

describe("Roundtrip: Mermaid Block (§5.5)", () => {
  it("simple flowchart", () => {
    const input = "```mermaid\nflowchart LR\n  A --> B\n  B --> C\n```\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("sequence diagram", () => {
    const input =
      "```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi\n```\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("empty mermaid block", () => {
    const input = "```mermaid\n```\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mermaid block between other blocks", () => {
    const input =
      "# Title\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nSome text\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mermaid vs regular code block coexistence", () => {
    const input =
      '```javascript\nconsole.log("hello");\n```\n\n```mermaid\ngraph LR\n  A --> B\n```\n';
    expect(roundtrip(input)).toBe(input);
  });

  it("pie chart", () => {
    const input =
      '```mermaid\npie title Pets\n  "Dogs" : 386\n  "Cats" : 85\n```\n';
    expect(roundtrip(input)).toBe(input);
  });

  it("preserves width/caption stored as a %% baram-meta line", () => {
    const input =
      '```mermaid\n%% baram-meta: {"width":50,"caption":"My flow"}\nflowchart LR\n  A --> B\n```\n';
    expect(roundtrip(input)).toBe(input);
  });

  it("splits %% baram-meta out of the code attr (clean diagram)", () => {
    const input =
      '```mermaid\n%% baram-meta: {"width":60}\nflowchart LR\n  A --> B\n```\n';
    const doc = markdownToProsemirror(input, schema);
    const block = doc.firstChild!;
    expect(block.attrs.code).toBe("flowchart LR\n  A --> B");
    expect(block.attrs.width).toBe(60);
  });
});

describe("Mermaid Block: ProseMirror structure", () => {
  it("creates mermaidBlock node (not codeBlock) for mermaid language", () => {
    const input = "```mermaid\nflowchart LR\n  A --> B\n```\n";
    const doc = markdownToProsemirror(input, schema);
    const child = doc.firstChild!;
    expect(child.type.name).toBe("mermaidBlock");
    expect(child.attrs.code).toBe("flowchart LR\n  A --> B");
  });

  it("regular code block remains as codeBlock", () => {
    const input = '```javascript\nconsole.log("hello");\n```\n';
    const doc = markdownToProsemirror(input, schema);
    const child = doc.firstChild!;
    expect(child.type.name).toBe("codeBlock");
    expect(child.attrs.language).toBe("javascript");
  });
});

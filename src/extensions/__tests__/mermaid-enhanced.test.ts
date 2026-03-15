// §50 Mermaid Enhanced — utility function tests + roundtrip tests
import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import {
  detectMermaidType,
  MERMAID_TEMPLATES,
} from "../../utils/markdown/mermaid-utils";

describe("Mermaid Templates", () => {
  it("has 7 Phase 2 diagram types (original)", () => {
    const keys = Object.keys(MERMAID_TEMPLATES);
    expect(keys).toContain("flowchart");
    expect(keys).toContain("sequence");
    expect(keys).toContain("class");
    expect(keys).toContain("state");
    expect(keys).toContain("er");
    expect(keys).toContain("gantt");
    expect(keys).toContain("pie");
  });

  it("has 11 templates (7 original + 4 new)", () => {
    expect(Object.keys(MERMAID_TEMPLATES)).toHaveLength(11);
  });

  it("each template has label and non-empty code", () => {
    for (const [key, value] of Object.entries(MERMAID_TEMPLATES)) {
      expect(value.label).toBeTruthy();
      expect(value.code.length).toBeGreaterThan(0);
      // Template code should start with a valid mermaid keyword
      expect(detectMermaidType(value.code)).toBe(key);
    }
  });

  it("mindmap template exists", () => {
    expect(MERMAID_TEMPLATES.mindmap).toBeDefined();
    expect(MERMAID_TEMPLATES.mindmap.label).toBe("Mind Map");
  });

  it("timeline template exists", () => {
    expect(MERMAID_TEMPLATES.timeline).toBeDefined();
  });

  it("journey template exists", () => {
    expect(MERMAID_TEMPLATES.journey).toBeDefined();
  });

  it("gitgraph template exists", () => {
    expect(MERMAID_TEMPLATES.gitgraph).toBeDefined();
  });
});

describe("detectMermaidType", () => {
  it("detects flowchart", () => {
    expect(detectMermaidType("flowchart LR\n  A --> B")).toBe("flowchart");
  });

  it("detects graph (alias for flowchart)", () => {
    expect(detectMermaidType("graph TD\n  A --> B")).toBe("flowchart");
  });

  it("detects sequenceDiagram", () => {
    expect(detectMermaidType("sequenceDiagram\n  A->>B: Hello")).toBe(
      "sequence",
    );
  });

  it("detects classDiagram", () => {
    expect(detectMermaidType("classDiagram\n  class Foo")).toBe("class");
  });

  it("detects stateDiagram-v2", () => {
    expect(detectMermaidType("stateDiagram-v2\n  [*] --> S1")).toBe("state");
  });

  it("detects erDiagram", () => {
    expect(detectMermaidType("erDiagram\n  A ||--o{ B : has")).toBe("er");
  });

  it("detects gantt", () => {
    expect(detectMermaidType("gantt\n  title Plan")).toBe("gantt");
  });

  it("detects pie", () => {
    expect(detectMermaidType('pie title Stats\n  "A" : 50')).toBe("pie");
  });

  it("detects mindmap", () => {
    expect(detectMermaidType("mindmap\n  root")).toBe("mindmap");
  });

  it("detects timeline", () => {
    expect(detectMermaidType("timeline\n  title My Day")).toBe("timeline");
  });

  it("detects journey type", () => {
    expect(detectMermaidType("journey\n  title User Journey")).toBe("journey");
  });

  it("detects gitgraph type", () => {
    expect(detectMermaidType("gitGraph\n  commit")).toBe("gitgraph");
  });

  it("returns null for unknown", () => {
    expect(detectMermaidType("something else")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectMermaidType("")).toBeNull();
  });

  it("handles leading whitespace", () => {
    expect(detectMermaidType("  flowchart LR\n  A --> B")).toBe("flowchart");
  });
});

// ── Roundtrip tests (Extension level, §5.5) ──────────────────────────

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
      attrs: { code: { default: "" } },
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

describe("Roundtrip: Mermaid Block (Extension level, §5.5)", () => {
  it("basic graph TD block", () => {
    const input = "```mermaid\ngraph TD\n  A --> B\n```\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("flowchart LR block", () => {
    const input = "```mermaid\nflowchart LR\n  A --> B\n  B --> C\n```\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("sequenceDiagram block", () => {
    const input =
      "```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi\n```\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("pie chart block", () => {
    const input =
      '```mermaid\npie title Pets\n  "Dogs" : 386\n  "Cats" : 85\n```\n';
    expect(roundtrip(input)).toBe(input);
  });

  it("empty mermaid block", () => {
    const input = "```mermaid\n```\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mermaid block between heading and paragraph", () => {
    const input =
      "# Title\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nSome text\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mermaid block does not consume adjacent regular code block", () => {
    const input =
      '```javascript\nconsole.log("hello");\n```\n\n```mermaid\ngraph LR\n  A --> B\n```\n';
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Mermaid Block PM structure (Extension level)", () => {
  it("creates mermaidBlock node for mermaid language fence", () => {
    const input = "```mermaid\ngraph TD\n  A --> B\n```\n";
    const doc = markdownToProsemirror(input, schema);
    const node = doc.firstChild!;
    expect(node.type.name).toBe("mermaidBlock");
    expect(node.attrs.code).toBe("graph TD\n  A --> B");
  });

  it("mermaidBlock is atom (no children)", () => {
    const input = "```mermaid\nflowchart LR\n  A --> B\n```\n";
    const doc = markdownToProsemirror(input, schema);
    const node = doc.firstChild!;
    expect(node.childCount).toBe(0);
  });

  it("regular code block is not parsed as mermaidBlock", () => {
    const input = "```javascript\nconst x = 1;\n```\n";
    const doc = markdownToProsemirror(input, schema);
    const node = doc.firstChild!;
    expect(node.type.name).toBe("codeBlock");
  });

  it("multi-line diagram code preserved verbatim in attr", () => {
    const code = "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi";
    const input = `\`\`\`mermaid\n${code}\n\`\`\`\n`;
    const doc = markdownToProsemirror(input, schema);
    const node = doc.firstChild!;
    expect(node.attrs.code).toBe(code);
  });
});

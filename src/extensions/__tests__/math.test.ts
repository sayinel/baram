import { Schema } from "@tiptap/pm/model";
// §5.3 Math Extensions — roundtrip + PM structure tests
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

// Schema with mathBlock (block) and mathInline (inline) nodes
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
      attrs: { level: { default: 1 }, blockId: { default: null } },
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
    // §5.3 Math Block node — atom, formula stored in attrs
    mathBlock: {
      group: "block",
      atom: true,
      attrs: { formula: { default: "" } },
    },
    // §5.3 Math Inline node — atom, formula stored in attrs
    mathInline: {
      group: "inline",
      inline: true,
      atom: true,
      marks: "",
      attrs: { formula: { default: "" } },
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
    underline: {},
  },
});

function parse(input: string) {
  return markdownToProsemirror(input, schema);
}

function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

// ── Math Block roundtrip ─────────────────────────────────────────────

describe("Roundtrip: Math Block (§5.3)", () => {
  it("simple block math", () => {
    const input = "$$\nE=mc^2\n$$\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("multi-line block math", () => {
    const input = "$$\n\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("aligned environment", () => {
    const input =
      "$$\n\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}\n$$\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("empty formula", () => {
    const input = "$$\n\n$$\n";
    // Empty math block collapses the blank line
    expect(roundtrip(input)).toBe("$$\n$$\n");
  });

  it("block math between paragraphs", () => {
    const input = "Before.\n\n$$\nE=mc^2\n$$\n\nAfter.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("block math after heading", () => {
    const input = "# Title\n\n$$\nf(x) = x^2\n$$\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("sum with subscript and superscript", () => {
    const input = "$$\n\\sum_{i=0}^{n} i^2\n$$\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("matrix formula", () => {
    const input = "$$\n\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n$$\n";
    expect(roundtrip(input)).toBe(input);
  });
});

// ── Math Block PM structure ──────────────────────────────────────────

describe("Math Block PM structure", () => {
  it("creates mathBlock node with formula attr", () => {
    const doc = parse("$$\nE=mc^2\n$$\n");
    const node = doc.firstChild!;
    expect(node.type.name).toBe("mathBlock");
    expect(node.attrs.formula).toBe("E=mc^2");
  });

  it("mathBlock is atom (no children)", () => {
    const doc = parse("$$\nf(x)\n$$\n");
    const node = doc.firstChild!;
    expect(node.childCount).toBe(0);
  });

  it("multi-line formula preserved verbatim in attr", () => {
    const formula = "\\frac{a}{b}\\\\\n\\frac{c}{d}";
    const doc = parse(`$$\n${formula}\n$$\n`);
    const node = doc.firstChild!;
    expect(node.attrs.formula).toBe(formula);
  });

  it("empty formula stores empty string", () => {
    const doc = parse("$$\n\n$$\n");
    const node = doc.firstChild!;
    expect(node.type.name).toBe("mathBlock");
    expect(node.attrs.formula).toBe("");
  });

  it("regular code block with $$ in content is not mathBlock", () => {
    const doc = parse("```\n$$\nnot math\n$$\n```\n");
    const node = doc.firstChild!;
    expect(node.type.name).toBe("codeBlock");
  });
});

// ── Math Inline roundtrip ────────────────────────────────────────────

describe("Roundtrip: Math Inline (§5.3)", () => {
  it("simple inline math", () => {
    const input = "The formula $E=mc^2$ is famous.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("inline math at start of paragraph", () => {
    const input = "$x = 1$ starts the line.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("inline math at end of paragraph", () => {
    const input = "The result is $x^2$\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("multiple inline math in one paragraph", () => {
    const input = "Both $a$ and $b$ are variables.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("inline math with subscript", () => {
    const input = "Element $x_i$ is indexed.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("inline math with fraction", () => {
    const input = "The ratio is $\\frac{1}{2}$.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("standalone inline math paragraph", () => {
    const input = "$f(x) = x^2$\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("inline math in heading", () => {
    const input = "# Heading with $x^2$ math\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("inline math in blockquote", () => {
    const input = "> Quote with $E=mc^2$ inline.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("inline math in list item", () => {
    const input = "- Item with $x + y = z$\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("inline math adjacent to bold text", () => {
    const input = "**Bold** then $x^2$ formula.\n";
    expect(roundtrip(input)).toBe(input);
  });
});

// ── Math Inline PM structure ─────────────────────────────────────────

describe("Math Inline PM structure", () => {
  it("creates mathInline node with formula attr", () => {
    const doc = parse("See $E=mc^2$ here.\n");
    const para = doc.firstChild!;
    expect(para.type.name).toBe("paragraph");

    // paragraph: text "See ", mathInline, text " here."
    expect(para.childCount).toBe(3);
    expect(para.child(0).isText).toBe(true);
    expect(para.child(0).text).toBe("See ");
    expect(para.child(1).type.name).toBe("mathInline");
    expect(para.child(1).attrs.formula).toBe("E=mc^2");
    expect(para.child(2).isText).toBe(true);
    expect(para.child(2).text).toBe(" here.");
  });

  it("mathInline is atom (no children)", () => {
    const doc = parse("$f(x)$ formula.\n");
    const mathNode = doc.firstChild!.firstChild!;
    expect(mathNode.childCount).toBe(0);
  });

  it("multiple mathInline nodes in one paragraph", () => {
    const doc = parse("Both $a$ and $b$.\n");
    const para = doc.firstChild!;
    // text "Both ", mathInline(a), text " and ", mathInline(b), text "."
    const mathNodes: string[] = [];
    para.forEach((child) => {
      if (child.type.name === "mathInline") {
        mathNodes.push(child.attrs.formula as string);
      }
    });
    expect(mathNodes).toEqual(["a", "b"]);
  });

  it("formula attribute preserved verbatim", () => {
    const doc = parse("Formula $\\frac{1}{2}$ here.\n");
    const para = doc.firstChild!;
    let formula = "";
    para.forEach((child) => {
      if (child.type.name === "mathInline") formula = child.attrs.formula;
    });
    expect(formula).toBe("\\frac{1}{2}");
  });

  it("standalone inline math is only child in paragraph", () => {
    const doc = parse("$x^2$\n");
    const para = doc.firstChild!;
    expect(para.firstChild!.type.name).toBe("mathInline");
    expect(para.firstChild!.attrs.formula).toBe("x^2");
  });
});

// ── Mixed: block math + inline math in same document ────────────────

describe("Mixed Math Block and Inline", () => {
  it("inline and block math in same document", () => {
    const input = "Use $f(x)$ inline.\n\n$$\n\\int f(x)\\,dx\n$$\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("block math followed by paragraph with inline math", () => {
    const input = "$$\na^2 + b^2 = c^2\n$$\n\nWhere $a$, $b$, $c$ are sides.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("multiple block math blocks", () => {
    const input = "$$\nx = 1\n$$\n\n$$\ny = 2\n$$\n";
    expect(roundtrip(input)).toBe(input);
  });
});

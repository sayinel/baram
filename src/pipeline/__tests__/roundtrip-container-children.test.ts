import type { Node as PmNode } from "@tiptap/pm/model";

// §5.1 Which conversion a node's children take is decided by the node. mdast calls both
// block and inline HTML `html`, so a first child of that type cannot say. Routing on the
// first child against a list of inline types took a quote opening with an HTML block
// through the inline conversion, which dropped every block in it. A footnote reference
// was not on that list, so a paragraph opening with one went through the block
// conversion, which dropped the text after it.
//
// What fails this: routing on the first child with `html` on the list and
// `footnoteReference` off it, as it was, turns the first and third blocks red. With
// `html` off and `footnoteReference` on, the second block goes red. Sending every node's
// children through the block conversion fails the second block too.
import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

const schema = getSchema(createBaramExtensions());

function nodeTypes(doc: PmNode): string[] {
  const types: string[] = [];
  doc.descendants((node) => {
    types.push(node.type.name);
  });
  return types;
}

function roundtrip(markdown: string): string {
  return prosemirrorToMarkdown(markdownToProsemirror(markdown, schema));
}

describe("an HTML block first in a container of blocks", () => {
  it.each([
    ["a quote: a comment, then text", "> <!-- note -->\n>\n> para\n"],
    ["a quote: a div, then text", "> <div>x</div>\n>\n> para\n"],
    ["a quote: a comment alone", "> <!-- note -->\n"],
    ["a callout body", "> [!note]\n> <!-- note -->\n>\n> para\n"],
    ["a footnote definition", "x[^1]\n\n[^1]: <!-- note -->\n\n    para\n"],
  ])("keeps its bytes: %s", (_name, markdown) => {
    expect(roundtrip(markdown)).toBe(markdown);
  });

  it("a table's width comment first in a quote still gives the table its widths", () => {
    const markdown =
      "> <!-- colwidths:100,200 -->\n>\n> | A | B |\n> | - | - |\n> | 1 | 2 |\n";
    const doc = markdownToProsemirror(markdown, schema);
    const widths: unknown[] = [];
    doc.descendants((node) => {
      if (node.type.name === "tableHeader") widths.push(node.attrs.colwidth);
    });

    expect(widths).toEqual([[100], [200]]);
    expect(prosemirrorToMarkdown(doc)).toBe(markdown);
  });

  it("a details block first in a quote is a toggle that keeps its body", () => {
    const markdown =
      "> <details>\n> <summary>t</summary>\n>\n> body\n>\n> </details>\n";
    const doc = markdownToProsemirror(markdown, schema);

    expect(nodeTypes(doc)).toContain("toggle");
    expect(prosemirrorToMarkdown(doc)).toBe(markdown);
  });
});

describe("HTML that really is inline stays inline", () => {
  it.each([
    ["first in a paragraph", "<mark>x</mark> y\n", "==x== y\n"],
    ["first in a heading", "# <mark>x</mark> y\n", "# ==x== y\n"],
    ["first in a paragraph in a quote", "> <mark>x</mark> y\n", "> ==x== y\n"],
    ["first in a list item", "- <mark>x</mark> y\n", "- ==x== y\n"],
  ])("reads as a mark: %s", (_name, markdown, expected) => {
    expect(roundtrip(markdown)).toBe(expected);
  });

  it("a paragraph is what holds it", () => {
    const doc = markdownToProsemirror("> <mark>x</mark> y\n", schema);

    expect(nodeTypes(doc)).toContain("paragraph");
    expect(nodeTypes(doc)).not.toContain("htmlBlock");
  });
});

describe("a footnote reference first in a paragraph keeps the text after it", () => {
  it.each([
    ["a paragraph", "[^1] text\n\n[^1]: def\n"],
    ["a heading", "# [^1] text\n\n[^1]: def\n"],
    ["a link after it", "[^1] [a](http://x)\n\n[^1]: def\n"],
    ["a quote", "> [^1] text\n\n[^1]: def\n"],
    ["a list item", "- [^1] text\n\n[^1]: def\n"],
    ["a task item", "- [ ] [^1] text\n\n[^1]: def\n"],
    ["another footnote's body", "x[^2]\n\n[^1]: def\n\n[^2]: [^1] text\n"],
  ])("%s", (_name, markdown) => {
    expect(roundtrip(markdown)).toBe(markdown);
  });
});

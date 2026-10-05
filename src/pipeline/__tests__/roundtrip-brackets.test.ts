// §7.1 — which `[` the serializer writes raw, and which it still escapes.
//
// remark-stringify escapes every `[` in body text because a `[x]` could be a
// shortcut reference to a `[x]: url` defined anywhere in the document. Baram's
// output never holds such a definition — the schema has no node for one and the
// loader turns references into inline links (`reference-links.ts`) — so the
// serializer's `text` handler (`serializer.ts`) writes a `[` raw unless it could
// still start something. Each `describe` below is one reason a `[` stays escaped;
// dropping that reason from the handler fails the rows under it.
import type { Node as PmNode } from "@tiptap/pm/model";

import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

const schema = getSchema(createBaramExtensions());

const load = (md: string): PmNode => markdownToProsemirror(md, schema);
const roundtrip = (md: string): string => prosemirrorToMarkdown(load(md));

/** The saved file reads back as the document that was saved. */
function expectSameDocumentAfterSave(md: string): void {
  const before = load(md);
  const after = load(prosemirrorToMarkdown(before));
  expect(after.toJSON()).toEqual(before.toJSON());
}

/** A one-paragraph document — for text no markdown loads into (a typed or
 *  pasted `$_GET`, a bare `#tag`). */
function paragraphOf(...content: Record<string, unknown>[]): PmNode {
  return schema.nodeFromJSON({
    content: [{ content, type: "paragraph" }],
    type: "doc",
  });
}

/** `doc` saved and loaded again is `doc`. */
function expectSameAfterSave(doc: PmNode): void {
  expect(load(prosemirrorToMarkdown(doc)).toJSON()).toEqual(doc.toJSON());
}

/** Every link mark's href in the document. */
function linkHrefs(doc: PmNode): string[] {
  const hrefs: string[] = [];
  doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === "link") hrefs.push(mark.attrs.href as string);
    }
  });
  return hrefs;
}

describe("a bracket that starts nothing is written as it was typed", () => {
  it.each([
    ["a paragraph prefix", "[중요] 그냥 문단\n"],
    ["a list item prefix", "- [중요] 항목\n"],
    ["a task's text", "- [ ] [중요] 할 일\n"],
    ["mid-line in a task", "- [ ] 할 일 [중요] 끝\n"],
    ["a numbered reference in a list", "- [1] 참조\n"],
    ["an ordered list item", "1. [1] Smith, J.\n"],
    ["a citation key", "see [@smith2020, p. 3] here\n"],
    ["two citation keys", "see [@a; @b] here\n"],
    ["inside bold", "**[중요]** 제목\n"],
    ["in a heading", "# [중요] 제목\n"],
    ["in a table cell", "| a |\n| - |\n| [중요] 셀 |\n"],
    ["in a block quote", "> [중요] 인용\n"],
    ["after a soft line break", "첫 줄\n[중요] 둘째 줄\n"],
    ["nested pairs", "[a [b] c] 끝\n"],
    ["an exclamation mark before it", "Wow![1] here\n"],
    ["beside a wikilink", "[[a]] 와 [중요]\n"],
    ["beside a block reference", "((note#^abc)) 와 [중요]\n"],
  ])("%s", (_label, md) => {
    expect(roundtrip(md)).toBe(md);
  });
});

describe("a footnote call stays escaped", () => {
  it("does not become a call to a footnote the document defines", () => {
    expectSameDocumentAfterSave("x \\[^1] y\n\n[^1]: note\n");
    expect(roundtrip("x \\[^1] y\n\n[^1]: note\n")).toContain("x \\[^1] y");
  });
});

describe("a bracket that could open a definition stays escaped", () => {
  it.each([
    ["a whole label", "\\[x]: y\n"],
    ["a label closed in a later node", "\\[a **b**]: c\n"],
    ["a label around an escaped bracket", "\\[a \\[^b]: c] d\n"],
    // Escaping the inner `[` lets the `]` before `:` reach the outer one.
    ["a label around a closed pair", "\\[a \\[b]: c] d\n"],
  ])("%s", (_label, md) => {
    expectSameDocumentAfterSave(md);
    expect(roundtrip(md)).toBe(md);
  });
});

describe("a GFM task check at the start of an item stays escaped", () => {
  it.each([
    ["unchecked", "- \\[ ] plain item\n"],
    ["checked", "- \\[x] plain item\n"],
    ["checked, uppercase", "- \\[X] plain item\n"],
  ])("%s", (_label, md) => {
    expectSameDocumentAfterSave(md);
    expect(roundtrip(md)).toBe(md);
  });
});

describe("a bracket shaped like a link, reference or span keeps today's bytes", () => {
  // remark already escapes a `(` right after `]`, so none of these could form
  // a link in Baram. Escaping the `[` too keeps files that were saved before
  // byte-identical, and `{` is Pandoc's bracketed span (`[x]{.cls}`), which the
  // Pandoc export keeps on for underline.
  it.each([
    ["an inline link", "\\[a]\\(b) text\n"],
    ["a full and a collapsed reference", "\\[a]\\[b] and \\[c]\\[]\n"],
    ["a Pandoc span", "\\[span]{.cls}\n"],
    ["an inner link inside a pair", "\\[a \\[b]\\(c)\n"],
  ])("%s", (_label, md) => {
    expectSameDocumentAfterSave(md);
    expect(roundtrip(md)).toBe(md);
  });

  it("link text keeps its brackets escaped", () => {
    const md = "Source: [\\[특집\\] 기사](https://example.com/a)\n";
    expect(roundtrip(md)).toBe(md);
  });
});

describe("a closing bracket right before a block reference", () => {
  // remark escapes a `(` after `]` in text, but a block reference is written
  // verbatim, so `]((note#^abc))` is a live inline link destination. The
  // highlight shorthand also writes its text verbatim, which leaves `==[x==`
  // with an open bracket that this `]` would close.
  it("does not let an earlier open bracket become a link", () => {
    const md = "==\\[x== \\[y] z]((note#^abc))\n";
    expectSameDocumentAfterSave(md);
    expect(linkHrefs(load(roundtrip(md)))).toEqual([]);
  });
});

describe("every `$` in text is escaped", () => {
  // remark skips the escape on a `$` whose next character it escapes anyway
  // (mdast-util-math's pattern carries an `after` key even when it is
  // undefined), so `$_GET … $_POST` was saved as inline math. The handler
  // writes every `$` as `\$`.
  it("keeps text that names variables text", () => {
    const doc = paragraphOf({
      text: "price $_GET and $_POST here",
      type: "text",
    });
    expect(prosemirrorToMarkdown(doc)).toBe(
      "price \\$\\_GET and \\$\\_POST here\n",
    );
    expectSameAfterSave(doc);
  });

  it("escapes a `$` before a raw bracket", () => {
    expect(
      prosemirrorToMarkdown(paragraphOf({ text: "$[a] b", type: "text" })),
    ).toBe("\\$[a] b\n");
  });

  it("escapes a `$` in link text", () => {
    const md = "[a \\$\\_x](https://example.com)\n";
    expectSameDocumentAfterSave(md);
    expect(roundtrip(md)).toBe(md);
  });

  // A backslash inside `<…>` is a character of the URL, not an escape.
  it.each([
    ["a URL", "<http://a.com/$x>\n"],
    ["an e-mail address", "see <mailto:a$b@c.com> here\n"],
  ])("leaves a `$` in %s autolink alone", (_label, md) => {
    expect(roundtrip(md)).toBe(md);
  });

  // The `]` a `[` pairs with in its own text must be one the parser sees. Math
  // opened by a raw `$` hid it, the `[` stayed open, and a `]` in a later text
  // closed it on a block reference — which became the link's destination.
  it("does not let math hide the bracket a block reference then closes", () => {
    const doc = paragraphOf(
      { text: "[$_GET 값] 과 $_POST 비교 ", type: "text" },
      { marks: [{ type: "bold" }], text: "중요", type: "text" },
      { text: " [링크]", type: "text" },
      { attrs: { blockId: "abc", target: "note" }, type: "blockReference" },
    );
    expectSameAfterSave(doc);
    expect(linkHrefs(load(prosemirrorToMarkdown(doc)))).toEqual([]);
  });
});

// §56l — a `#` that starts a line is a heading marker only when a space, a tab
// or the line end follows it, so `#tag` there is written raw. That used to be a
// regex over the whole saved string, which also took the backslash off `\#`
// inside code, math, and after a literal backslash.
describe("a `#` at the start of a line", () => {
  // Built as documents: loading `#tag` makes a tag node, which is written
  // verbatim. A `#tag` stays text only when it arrived some other way — pasted
  // as plain text, say — and then it is saved for the loader to turn into a tag.
  it.each([
    ["a tag", "#tag 앞머리"],
    ["a Korean tag", "#태그 앞머리"],
  ])("is written raw before %s", (_label, text) => {
    const doc = schema.nodeFromJSON({
      content: [{ content: [{ text, type: "text" }], type: "paragraph" }],
      type: "doc",
    });
    expect(prosemirrorToMarkdown(doc)).toBe(`${text}\n`);
  });

  it("stays escaped when it would start a heading", () => {
    expectSameDocumentAfterSave("\\# not a heading\n");
    expect(roundtrip("\\# not a heading\n")).toBe("\\# not a heading\n");
  });

  it.each([
    ["a code block", "```\n\\#define X\n```\n"],
    ["inline code", "inline `\\#x` here\n"],
    ["inline math", "math $\\#y$ here\n"],
    ["a block of math", "$$\n\\#z\n$$\n"],
  ])("keeps the backslash in %s", (_label, md) => {
    expect(roundtrip(md)).toBe(md);
  });

  it("keeps a literal backslash before a tag", () => {
    expectSameDocumentAfterSave("a \\\\#tag\n");
  });
});

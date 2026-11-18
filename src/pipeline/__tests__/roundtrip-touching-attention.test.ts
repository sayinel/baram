// §7.1 — bold and italic runs that touch each other read back as they were.
//
// mdast-util-to-markdown 2.2.3 picks the marker of a bold or italic run before
// checking how the line reads: where a `*` run would touch a sibling or
// enclosing run with the same marker it starts from `_` (`**a**_b_`), and
// repairs from there. 2.2.2 started from `*` everywhere (`**a***b*`) and moved
// to `_` only where its check found a run that would not pair. Both versions offer the same
// candidates, `*` then `_` (`handle/emphasis.js`, `handle/strong.js`).
//
// Offering only `*` would keep 2.2.2's bytes for most inputs, but the repair
// draws from the same list: where `*` cannot pair (a bold run ending in a
// space, then italic) there is nothing left to switch to, and the run is lost
// on reload. These cases pin that.
import type { Node as PmNode } from "@tiptap/pm/model";

import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

const schema = getSchema(createBaramExtensions());

const load = (md: string): PmNode => markdownToProsemirror(md, schema);

/** A paragraph of text runs, each `[text, mark names]`. */
function paragraph(...runs: [string, string[]][]): PmNode {
  return schema.nodeFromJSON({
    content: [
      {
        content: runs.map(([text, marks]) => ({
          marks: marks.map((type) => ({ type })),
          text,
          type: "text",
        })),
        type: "paragraph",
      },
    ],
    type: "doc",
  });
}

describe("bold and italic runs that touch each other", () => {
  // What fails these: offering only `*` to bold and italic (an `attention`
  // with `markers: ["*"]` on the serializer's emphasis and strong handlers) —
  // the first two lose their marks on reload.
  it.each([
    [
      "bold ending in a space, then italic",
      paragraph(["a ", ["bold"]], ["b", ["italic"]]),
    ],
    [
      "italic, then bold starting with a space",
      paragraph(["a", ["italic"]], [" b", ["bold"]]),
    ],
    ["bold, then italic", paragraph(["a", ["bold"]], ["b", ["italic"]])],
    ["italic, then bold", paragraph(["a", ["italic"]], ["b", ["bold"]])],
    [
      "bold, italic, bold",
      paragraph(["a", ["bold"]], ["b", ["italic"]], ["c", ["bold"]]),
    ],
    [
      "bold, then bold italic",
      paragraph(["a", ["bold"]], ["b", ["bold", "italic"]]),
    ],
    [
      "bold italic, then italic",
      paragraph(["a", ["bold", "italic"]], ["b", ["italic"]]),
    ],
    [
      "inside a word",
      paragraph(["x", []], ["a", ["bold"]], ["b", ["italic"]], ["y", []]),
    ],
  ])("%s", (_name, doc) => {
    expect(load(prosemirrorToMarkdown(doc)).eq(doc)).toBe(true);
  });

  // What fails these: the same `*`-only change — the first two no longer read
  // back as the document that was opened.
  it.each(["***a* b**", "**a *b* c**", "**a***b*", "x**a***b*y"])(
    "%s reads back as the document it came from",
    (md) => {
      const opened = load(md);
      expect(load(prosemirrorToMarkdown(opened)).eq(opened)).toBe(true);
    },
  );
});

describe("what 2.2.3 writes for touching runs", () => {
  // Not a goal, a record: 2.2.2 wrote `**a***b*` and `x**a***b*y`. What fails
  // these: a mdast-util-to-markdown that picks markers differently — compare
  // its output with these before moving MEASURED in
  // src/utils/editor/__tests__/literal-measured-stack.test.ts.
  it.each([
    ["**a***b*", "**a**_b_\n"],
    ["*a***b**", "*a*__b__\n"],
    ["x**a***b*y", "x**a**_&#x62;_&#x79;\n"],
    ["***a***", "***a***\n"],
  ])("%s is saved as %j", (md, saved) => {
    expect(prosemirrorToMarkdown(load(md))).toBe(saved);
  });
});

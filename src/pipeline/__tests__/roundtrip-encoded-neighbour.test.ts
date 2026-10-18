// §7.1 — a backslash in text right before a character remark writes as a
// character reference.
//
// Beside a bold or italic run remark may write a character that is not
// punctuation (a letter, a digit, a space) as a character reference so the
// run opens or closes (`**e&#x20;**&#x66;`, mdast-util-to-markdown's
// `encodeInfo`). It does not look at what comes before that character: text
// `use \n` before a bold run was written `use \&#x6E;**…**`, where the
// backslash now escapes the `&` — the text read back as `use &#x6E;`, and the
// next save kept it so.
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

describe("a backslash before a character written as a reference", () => {
  // What fails these: leaving that backslash as it is — it escapes the `&` of
  // the reference.
  it.each([
    [
      "before bold",
      paragraph(["use \\n", []], ["(old)", ["bold"]], [" now", []]),
    ],
    [
      "before italic",
      paragraph(["use \\n", []], ["(old)", ["italic"]], [" now", []]),
    ],
  ])("%s reads back as written", (_label, doc) => {
    const saved = prosemirrorToMarkdown(doc);
    expect(load(saved).toJSON()).toEqual(doc.toJSON());
    expect(prosemirrorToMarkdown(load(saved))).toBe(saved);
  });

  // Control: a backslash before a letter with no run beside it keeps its
  // bytes — nothing is encoded there.
  it("a backslash with no run beside it is written as it is", () => {
    const md = "C:\\data and more\n";
    expect(prosemirrorToMarkdown(load(md))).toBe(md);
  });
});

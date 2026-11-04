// §7.1 — a strikethrough whose text starts or ends with a space is written so it
// closes.
//
// remark-gfm wrote `~~` around the text without looking at what is next to it,
// so `a ~~e ~~f` did not close: the strikethrough was lost on reload and the
// next save wrote `\~\~`. Bold and italic were already written so they close
// (`**e&#x20;**&#x66;`); strikethrough is now written the same way
// (`serializer.ts`).
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

describe("a strikethrough whose text starts or ends with a space", () => {
  // What fails these: writing `~~` around the text without encoding the
  // character beside it.
  it.each([
    [
      "a space at the end",
      paragraph(["a ", []], ["e ", ["strike"]], ["f", []]),
    ],
    [
      "a space at the start",
      paragraph(["a", []], [" e", ["strike"]], [" f", []]),
    ],
  ])("%s reads back as written", (_label, doc) => {
    const saved = prosemirrorToMarkdown(doc);
    expect(load(saved).toJSON()).toEqual(doc.toJSON());
    expect(prosemirrorToMarkdown(load(saved))).toBe(saved);
  });

  // Control: strikethrough with nothing to encode keeps its bytes.
  it("plain strikethrough keeps its bytes", () => {
    const md = "a ~~b c~~ d\n";
    expect(prosemirrorToMarkdown(load(md))).toBe(md);
  });
});

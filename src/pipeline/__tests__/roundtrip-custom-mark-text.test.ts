// §7.1 — the text of a highlight, subscript or superscript written as its
// shorthand (`==x==`, `~x~`, `^x^`) is escaped like any other text.
//
// The shorthand used to be built as a string and written verbatim, so its text
// skipped the escaping every other text gets: a highlighted `[a](b)` was saved
// as `==[a](b)==` and read back as a link, a highlighted `<b>` read back as an
// HTML tag and disappeared, `&amp;` came back as `&`.
import type { Node as PmNode } from "@tiptap/pm/model";

import { getSchema } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownParser } from "../markdown-parser";
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

/** `doc` saved reads back as `doc`, and saving that again writes the same. */
function expectSameAfterSave(doc: PmNode): void {
  const saved = prosemirrorToMarkdown(doc);
  expect(load(saved).toJSON()).toEqual(doc.toJSON());
  expect(prosemirrorToMarkdown(load(saved))).toBe(saved);
}

const MARKS = ["highlight", "subscript", "superscript"];

describe("the shorthand's text is escaped", () => {
  // What fails these: writing the text into the shorthand as it is.
  it.each([
    ["a link's spelling", "[a](b)"],
    ["asterisks", "*a*"],
    ["underscores", "_a_"],
    ["backticks", "`a`"],
    ["a tag's spelling", "<b>"],
    ["a character reference's spelling", "&amp;"],
    ["a trailing backslash", "a\\"],
    ["dollar signs", "$x$"],
  ])("%s", (_label, text) => {
    for (const mark of MARKS) {
      expectSameAfterSave(paragraph([text, [mark]], [" tail", []]));
    }
  });

  it("writes the escapes the same text gets outside the mark", () => {
    const plain = prosemirrorToMarkdown(paragraph(["[a](b) t", []]));
    expect(plain).toBe("\\[a]\\(b) t\n");
    expect(
      prosemirrorToMarkdown(paragraph(["[a](b)", ["highlight"]], [" t", []])),
    ).toBe(`==${plain.slice(0, -" t\n".length)}== t\n`);
  });

  // Controls: text with nothing to escape and no delimiter character beside it
  // keeps the shorthand byte for byte.
  it.each([
    ["two words", "==two words== tail\n"],
    ["a subscript", "H~2~O tail\n"],
    ["a superscript", "mc^2^ tail\n"],
  ])("%s", (_label, md) => {
    expect(prosemirrorToMarkdown(load(md))).toBe(md);
  });
});

describe("a shorthand before text that starts with its delimiter's character", () => {
  // The loader reads the shorthand from text after its escapes are taken out
  // (`convert-inline-custom-marks.ts`), so a `~` right after `~b~` is next to
  // the delimiter even when it is written `\~`: `~b~\~ y` read as `~b~~ y` and
  // lost the subscript. What fails this: judging the text after it only by the
  // character remark writes first (the backslash). Before it, the escaped `~`
  // is the last character written and the serializer's own check sees it.
  it("is written as tags", () => {
    expectSameAfterSave(paragraph(["b", ["subscript"]], ["~ y", []]));
  });
});

describe("a shorthand whose text only looks like a web address keeps it", () => {
  // No link forms in these, so the shorthand reads back. Tags are not a
  // neutral fallback: text after `<mark>` is read again as markdown, so a
  // leading `#todo` became a tag and `~2~` a subscript. What fails these:
  // deciding by the spelling of an address instead of by whether one forms.
  it.each([
    [
      "an ellipsis after the scheme",
      paragraph(["#todo https://…", ["highlight"]], [" t", []]),
    ],
    [
      "a scheme alone, then a tag",
      paragraph(["see https://", ["highlight"]], ["#todo", []]),
    ],
    [
      "a subscript's spelling before it",
      paragraph(["H~2~O http://", ["highlight"]], [" t", []]),
    ],
    [
      "a domain the autolink refuses",
      paragraph(["#t www.a_b.c_d", ["highlight"]], [" t", []]),
    ],
    [
      "a scheme with nothing after it",
      paragraph(["#t-http://", ["subscript"]], [" t", []]),
    ],
    [
      "a scheme right after a letter",
      paragraph(["#thttp://x.y", ["highlight"]], [" t", []]),
    ],
    [
      "a scheme right after a digit",
      paragraph(["#1https://x.y", ["superscript"]], [" t", []]),
    ],
  ])("%s", (_label, doc) => {
    expect(prosemirrorToMarkdown(doc)).not.toContain("<");
    expectSameAfterSave(doc);
  });
});

describe("a shorthand beside a character the loader does not pair with keeps its bytes", () => {
  // `^` text can neither start nor end with `^`, and `==b===` reads `==b==`
  // first (`serializer.ts` `CUSTOM_MARKS`), so these read back as they are.
  // What fails these: writing tags whenever the character next to the
  // shorthand is its delimiter's.
  it.each([
    ["a caret before a superscript", "a^^b^ tail\n"],
    ["a caret after a superscript", "^b^^ y\n"],
    ["an equals sign after a highlight", "==b=== y\n"],
  ])("%s", (_label, md) => {
    expect(prosemirrorToMarkdown(load(md))).toBe(md);
  });
});

describe("a shorthand that its neighbours would change is written as tags", () => {
  // The delimiter's character outside the shorthand changes how it reads:
  // `~~a~~` and `~b~` saved side by side were `~~a~~~b~`, which closes
  // neither, and `a=` before `==b==` was `a===b==`, a highlight starting one
  // character early. What fails these: writing the shorthand without looking
  // at the characters around it.
  it.each([
    [
      "a subscript after strikethrough",
      paragraph(["a", ["strike"]], ["b", ["subscript"]]),
    ],
    [
      "a subscript before strikethrough",
      paragraph(["b", ["subscript"]], ["a", ["strike"]]),
    ],
    [
      "a highlight after an equals sign",
      paragraph(["a=", []], ["b", ["highlight"]]),
    ],
  ])("%s", (_label, doc) => {
    expectSameAfterSave(doc);
  });
});

describe("a shorthand around a web address is written as tags", () => {
  // A web address takes the closing delimiter into its link:
  // `==https://example.com==` read back as a link to `https://example.com==`
  // and the highlight was lost, and so was a subscript once remark escaped the
  // address's `:` (`serializer.ts` `readsBackAsText` says why). The text still
  // reads back as a link, as a GFM autolink literal in text does, but keeps
  // its mark. What fails these: writing the shorthand without asking whether
  // it reads back.
  it.each([
    ["highlight", "https://example.com"],
    ["superscript", "see https://example.com"],
    ["highlight", "www.example.com"],
    ["subscript", "https://example.com"],
    ["subscript", "see www.example.com"],
  ])("%s %s", (mark, text) => {
    const reloaded = load(
      prosemirrorToMarkdown(paragraph(["x ", []], [text, [mark]], [" y", []])),
    );
    const paragraphNode = reloaded.firstChild as PmNode;
    const marked: string[] = [];
    paragraphNode.forEach((child) => {
      if (child.marks.some((m) => m.type.name === mark)) {
        marked.push(child.text ?? "");
      }
    });
    expect(marked.join("")).toBe(text);
    expect(paragraphNode.textContent).toBe(`x ${text} y`);
  });
});

describe("the read-back parse", () => {
  // `serializer.ts` parses a shorthand only when its text spells a web
  // address, and remembers the answer (`readsBackAsText`) — the next save
  // writes the same shorthands. Counted, not timed. What fails this:
  // dropping the spelling check (three parses) or the memory (a second
  // parse, on the second save).
  it("parses once, only the shorthand that spells an address", () => {
    const parse = vi.spyOn(markdownParser, "parse");
    try {
      const doc = paragraph(
        ["a", ["highlight"]],
        [" b ", []],
        ["c", ["subscript"]],
        [" ", []],
        ["see https://x.y/read-back-count", ["superscript"]],
        [" t", []],
      );
      prosemirrorToMarkdown(doc);
      expect(parse).toHaveBeenCalledTimes(1);
      prosemirrorToMarkdown(doc);
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
  });
});

// The canonical prose word/char counter (§4.8). Every case below is a number the app
// reported WRONG before this module existed — the status bar and the Word Count plugin
// disagreed, and both were wrong, in opposite directions.
import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import {
  countDocumentChars,
  countDocumentWords,
  countWords,
} from "../word-count";

const schema = getSchema(createBaramExtensions());
const words = (md: string) =>
  countDocumentWords(markdownToProsemirror(md, schema));
const chars = (md: string) =>
  countDocumentChars(markdownToProsemirror(md, schema));

describe("countWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countWords("one two three")).toBe(3);
  });

  it("is 0 for empty and whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
  });

  it("collapses runs of whitespace rather than counting empty tokens", () => {
    expect(countWords("  one   two  \n\n three ")).toBe(3);
  });
});

describe("block boundaries", () => {
  // ‼️ THE original defect. `doc.textContent` is `textBetween(0, size, "")`, and
  // `Fragment.textBetween` guards its separator with `&& blockSeparator` — "" is falsy, so
  // NO separator was inserted and the last word of every block fused with the first word
  // of the next. The error was exactly (textblocks - 1).
  it("does not fuse the last word of a block with the first of the next", () => {
    expect(words("Hello world\n\nSecond paragraph here\n")).toBe(5);
  });

  it("counts every single-word paragraph (was: 1 for all ten)", () => {
    const md = Array.from({ length: 10 }, (_, i) => `word${i}`).join("\n\n");
    expect(words(md)).toBe(10);
  });

  it("counts table cells separately (was: 1 for a whole 2x2 table)", () => {
    expect(words("| alpha | beta |\n| - | - |\n| one | two |\n")).toBe(4);
  });

  it("counts across a blockquote and a following list", () => {
    expect(words("> quoted line\n\n- item one\n- item two\n")).toBe(6);
  });

  it("does not fuse words across a hard break", () => {
    expect(words("Hello there\\\nworld again\n")).toBe(4);
  });
});

describe("code is not prose", () => {
  // `spec.code` is a PROPERTY, not an enumeration: codeBlock and frontmatter both set it,
  // and a future code-ish node inherits the exclusion instead of silently counting.
  it("excludes fenced code block contents", () => {
    expect(
      words("Intro sentence.\n\n```js\nconst a = 1;\n```\n\nOutro sentence.\n"),
    ).toBe(4);
  });

  it("excludes frontmatter YAML", () => {
    expect(
      words("---\ntitle: My Note\ntags: [a, b]\n---\n\nBody text here.\n"),
    ).toBe(3);
  });
});

describe("markdown syntax is not prose", () => {
  // The plugin counted the markdown SOURCE, so `#`, `-`, `**` and `|` were words.
  it("counts heading text but not its hashes", () => {
    expect(words("# Title Here\n")).toBe(2);
  });

  it("counts list item text but not its bullets", () => {
    expect(words("- first item\n- second item\n")).toBe(4);
  });

  it("counts emphasised words once, without their markers", () => {
    expect(words("Some **bold** text and *italic* words.\n")).toBe(6);
  });
});

describe("visible inline atoms are prose", () => {
  // These render as text the reader sees, but they are ProseMirror ATOMS, so they
  // contributed 0 words — a wikilink-heavy note counted far below what is on screen.
  it("counts a wikilink's display text", () => {
    expect(words("See [[Some Page]] for details\n")).toBe(5);
  });

  it("counts a wikilink's alias rather than its target", () => {
    // "See Some Page now" = 4. The slug would give "See some-page now" = 3, so this pins
    // WHICH attribute is read, not merely that one of them is.
    expect(words("See [[some-page|Some Page]] now\n")).toBe(4);
  });

  it("counts a tag", () => {
    expect(words("Tagged #alpha here\n")).toBe(3);
  });
});

describe("generated and non-prose atoms are excluded", () => {
  it("excludes a math block's formula", () => {
    expect(words("Before.\n\n$$\nx^2 + y^2\n$$\n\nAfter.\n")).toBe(2);
  });

  it("excludes an inline formula", () => {
    // Paired with a block boundary on purpose: exclusion alone was already true of the old
    // `textContent`, so this would not have discriminated between the two implementations.
    expect(words("Let $x^2 + 1$ be it\n\nnext line\n")).toBe(5);
  });

  it("excludes a mermaid diagram's source", () => {
    expect(
      words("Before.\n\n```mermaid\ngraph TD\nA --> B\n```\n\nAfter.\n"),
    ).toBe(2);
  });

  it("excludes an image's alt text", () => {
    // Same reason as the inline formula: the boundary makes it fail today, and the alt text
    // ("a red bird") would push it to 9 if a leaf-text policy started counting attrs.
    expect(
      words("Look at this\n\n![a red bird](bird.png)\n\nthere it is\n"),
    ).toBe(6);
  });
});

describe("countDocumentChars", () => {
  it("counts the prose it counted words in, not the markdown source", () => {
    // "Hello world" + "\n" + "Second one" — the separator is one char, and none of the
    // `#`/`-`/`**` the plugin was counting is here.
    expect(chars("# Hello world\n\nSecond one\n")).toBe(
      "Hello world\nSecond one".length,
    );
  });

  it("is 0 for an empty document", () => {
    expect(chars("")).toBe(0);
  });

  // ‼️ Blank lines become real empty `paragraph` nodes (the pipeline's
  // `enrichWithEmptyParagraphs`), so a block that contributes no text must contribute no
  // SEPARATOR either — otherwise the tooltip's character count grows with the document's
  // blank lines. Mutation testing found this one: dropping the emptiness check changed
  // nothing in any other assertion.
  it("does not spend a separator on an empty block", () => {
    expect(chars("a\n\n\n\nb\n")).toBe("a\nb".length);
  });
});

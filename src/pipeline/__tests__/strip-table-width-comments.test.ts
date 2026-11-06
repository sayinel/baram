// §5.5 — stripTableWidthComments removes block-level colwidths comments from markdown text.
import { describe, expect, it } from "vitest";

import { stripTableWidthComments } from "../convert-table-colwidths";

const TABLE = "| A | B |\n| --- | --- |\n";

describe("stripTableWidthComments", () => {
  it.each([
    ["blank line after", `<!-- colwidths:200,300 -->\n\n${TABLE}`, TABLE],
    ["no blank line", `<!-- colwidths:200,300 -->\n${TABLE}`, TABLE],
    [
      "a leading BOM stays",
      "\uFEFF<!-- colwidths:1,2 -->\n\n| A | B |\n| - | - |\n",
      "\uFEFF| A | B |\n| - | - |\n",
    ],
    [
      "a leading BOM stays once, when the first line stays too",
      "\uFEFFintro\n\n<!-- colwidths:1,2 -->\n\n| A | B |\n| - | - |\n",
      "\uFEFFintro\n\n| A | B |\n| - | - |\n",
    ],
    [
      "two tables",
      `<!-- colwidths:1,2 -->\n\n${TABLE}\nmid\n\n<!-- colwidths:3,4 -->\n\n${TABLE}`,
      `${TABLE}\nmid\n\n${TABLE}`,
    ],
    [
      "inside a quote",
      "> <!-- colwidths:1,2 -->\n>\n> | A | B |\n> | - | - |\n",
      "> | A | B |\n> | - | - |\n",
    ],
    [
      "inside a list item",
      "- a\n\n  <!-- colwidths:1,2 -->\n\n  | A | B |\n  | - | - |\n",
      "- a\n\n  | A | B |\n  | - | - |\n",
    ],
    [
      "CRLF",
      "<!-- colwidths:1,2 -->\r\n\r\n| A | B |\r\n| - | - |\r\n",
      "| A | B |\r\n| - | - |\r\n",
    ],
    [
      "CR only",
      "a\r\r<!-- colwidths:1,2 -->\r\r| A | B |\r| - | - |\r",
      "a\r\r| A | B |\r| - | - |\r",
    ],
    ["no final newline", "a\n\n<!-- colwidths:1,2 -->", "a\n\n"],
    [
      "a quote line after a root comment",
      "<!-- colwidths:1,2 -->\n>\nx\n",
      ">\nx\n",
    ],
    [
      "a nested quote line after a quoted comment",
      "> <!-- colwidths:1,2 -->\n> >\n> > x\n",
      "> >\n> > x\n",
    ],
    [
      "text directly above, blank below",
      "para\n<!-- colwidths:1,2 -->\n\nx\n",
      "para\n\nx\n",
    ],
    [
      "list item text directly above",
      "- a\n  <!-- colwidths:1,2 -->\n  \n  b\n",
      "- a\n  \n  b\n",
    ],
    [
      "tight in a list item, as the serializer writes it",
      "- a\n  <!-- colwidths:100,100 -->\n  | A | B |\n  | - | - |\n  | 1 | 2 |\n",
      "- a\n  | A | B |\n  | - | - |\n  | 1 | 2 |\n",
    ],
    [
      "text directly above, table directly below",
      "para\n<!-- colwidths:1,2 -->\n| A | B |\n| - | - |\n",
      "para\n| A | B |\n| - | - |\n",
    ],
  ])("removes the comment: %s", (_, input, expected) => {
    expect(stripTableWidthComments(input)).toBe(expected);
  });

  it.each([
    ["fenced code", "```\n<!-- colwidths:1,2 -->\n```\n"],
    ["inline code", "`<!-- colwidths:1,2 -->`\n"],
    ["inside a sentence", "글 <!-- colwidths:1,2 --> 글\n"],
    ["on a list marker's line", "- <!-- colwidths:1,2 -->\n"],
    ["front matter", "---\ntitle: <!-- colwidths:1,2 -->\n---\n"],
    ["another comment", "<!-- note -->\n"],
    ["text directly above and below", "para\n<!-- colwidths:1,2 -->\nx\n"],
    ["trailing spaces after the comment", "<!-- colwidths:1,2 -->   \n"],
    [
      "inside a continuing html block",
      "<div>\n<!-- colwidths:1,2 -->\n</div>\n",
    ],
  ])("leaves it alone: %s", (_, input) => {
    expect(stripTableWidthComments(input)).toBe(input);
  });
});

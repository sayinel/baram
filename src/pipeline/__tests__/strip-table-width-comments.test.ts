// §5.5 — stripTableWidthComments removes block-level colwidths comments from markdown text.
import { describe, expect, it } from "vitest";

import { stripTableWidthComments } from "../convert-table-colwidths";

const TABLE = "| A | B |\n| --- | --- |\n";

describe("stripTableWidthComments", () => {
  it.each([
    ["blank line after", `<!-- colwidths:200,300 -->\n\n${TABLE}`, TABLE],
    ["no blank line", `<!-- colwidths:200,300 -->\n${TABLE}`, TABLE],
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
  ])("leaves it alone: %s", (_, input) => {
    expect(stripTableWidthComments(input)).toBe(input);
  });
});

// issue 527 — the markdown export routes (Pandoc, Notion) never ship a link
// whose destination the link policy refuses.
//
// Issue 499 settled the rule for the HTML/PDF route: the document MODEL keeps
// every destination byte-for-byte, and each consumer applies
// `isAllowedLinkHref` at its own output point. The markdown routes hand a
// serialized string to pandoc / the Notion importer, so their output point is
// that string. `stripDisallowedMarkdownLinks` parses it with the editor's own
// grammar and rewrites only the refused links to their labels — re-serialized
// so a label that starts like a block (`# heading`, `- item`) cannot become
// one — and a clean document comes back as the very same string.
//
// Reparsing the output is the assertion that matters for the block-starter
// cases: the exact escape the serializer picks is its business, the absence
// of a heading / list / rule / quote where a link used to be is ours.
import type { Table } from "mdast";

import { toString } from "mdast-util-to-string";
import { describe, expect, it } from "vitest";

import { parseMdast } from "../../../pipeline/parse-mdast";
import { stripDisallowedMarkdownLinks } from "../export-markdown-links";
import { convertForNotion } from "../notion-export";
import { convertForPandoc } from "../pandoc-export";

/** Top-level block types of the parsed output. */
function blockTypes(markdown: string): string[] {
  return parseMdast(markdown).children.map((n) => n.type);
}

/** Destinations of every link the output still contains. */
function linkUrls(markdown: string): string[] {
  const urls: string[] = [];
  const walk = (node: { children?: unknown[]; type: string; url?: string }) => {
    if (node.type === "link" && node.url !== undefined) urls.push(node.url);
    for (const child of node.children ?? []) {
      walk(child as { children?: unknown[]; type: string; url?: string });
    }
  };
  walk(parseMdast(markdown));
  return urls;
}

describe("inline links", () => {
  it("replaces a javascript: link with its label", () => {
    expect(
      stripDisallowedMarkdownLinks(
        "[click me](javascript:alert(document.domain))\n",
      ),
    ).toBe("click me\n");
  });

  it("touches only the refused link; the rest of the document is byte-identical", () => {
    const input =
      "# T\n\nsee [good](https://example.com/a) and [bad](vbscript:x) here\n\n- item\n";
    expect(stripDisallowedMarkdownLinks(input)).toBe(
      "# T\n\nsee [good](https://example.com/a) and bad here\n\n- item\n",
    );
  });

  it("keeps the label's inline formatting", () => {
    expect(
      stripDisallowedMarkdownLinks(
        "[**bold** and `code` label](javascript:x)\n",
      ),
    ).toBe("**bold** and `code` label\n");
  });

  it("judges the DECODED destination: angle brackets, character references, tabs", () => {
    expect(stripDisallowedMarkdownLinks("[x](<javascript:alert(1)>)\n")).toBe(
      "x\n",
    );
    expect(
      stripDisallowedMarkdownLinks("[x](&#106;avascript:alert(1))\n"),
    ).toBe("x\n");
    expect(stripDisallowedMarkdownLinks("[x](<java\tscript:alert(1)>)\n")).toBe(
      "x\n",
    );
  });

  it("fails closed on a destination the URL parser rejects", () => {
    expect(stripDisallowedMarkdownLinks("[x](http://[)\n")).toBe("x\n");
  });

  it("turns an angle autolink into plain text", () => {
    const out = stripDisallowedMarkdownLinks("see <javascript:alert(1)> now\n");
    expect(out).toBe("see javascript:alert(1) now\n");
    expect(linkUrls(out)).toEqual([]);
  });

  it("refuses a protocol-relative destination like the HTML route does", () => {
    expect(stripDisallowedMarkdownLinks("[e](//evil.example/x)\n")).toBe("e\n");
  });

  it("handles adjacent links, an empty label, CRLF and astral characters", () => {
    expect(
      stripDisallowedMarkdownLinks("[a](javascript:x)[b](javascript:y)\n"),
    ).toBe("ab\n");
    expect(stripDisallowedMarkdownLinks("x [](javascript:x) y\n")).toBe(
      "x  y\n",
    );
    expect(
      stripDisallowedMarkdownLinks("a [b](javascript:x) c\r\n\r\nnext\r\n"),
    ).toBe("a b c\r\n\r\nnext\r\n");
    expect(stripDisallowedMarkdownLinks("😀 [b](javascript:x) 한글\n")).toBe(
      "😀 b 한글\n",
    );
  });
});

describe("a label that starts like a block stays inline text", () => {
  it.each([
    ["[# heading](javascript:x)\n", "heading"],
    ["[- item](javascript:x)\n", "item"],
    ["[1. numbered](javascript:x)\n", "numbered"],
    ["[> quote](javascript:x)\n", "quote"],
    ["[---](javascript:x)\n", "-"],
  ])("%s", (input, visible) => {
    const out = stripDisallowedMarkdownLinks(input);
    expect(blockTypes(out)).toEqual(["paragraph"]);
    expect(linkUrls(out)).toEqual([]);
    expect(out).toContain(visible);
  });

  it("a multi-line label cannot form a setext heading or a rule", () => {
    const out = stripDisallowedMarkdownLinks("[foo\n---](javascript:x)\n");
    expect(blockTypes(out)).toEqual(["paragraph"]);
    expect(out).toContain("foo");
  });
});

describe("what the label's surroundings demand", () => {
  it("writes a multi-line label on one line so container marks survive", () => {
    const quoted = stripDisallowedMarkdownLinks(
      "> [first\n> second](javascript:x)\n",
    );
    expect(quoted).toBe("> first second\n");
    const quote = parseMdast(quoted).children[0];
    expect(quote.type).toBe("blockquote");
    expect(toString(quote)).toBe("first second");

    expect(
      stripDisallowedMarkdownLinks("- [first\n  second](javascript:x)\n"),
    ).toBe("- first second\n");
    // A hard break inside the label renders as a space too.
    expect(stripDisallowedMarkdownLinks("[a  \nb](javascript:x) c\n")).toBe(
      "a b c\n",
    );
  });

  it("escapes pandoc's definition-list colon; remark already escapes ~ and | at a line start", () => {
    expect(
      stripDisallowedMarkdownLinks("Term\n[: Definition](javascript:x)\n"),
    ).toBe("Term\n\\: Definition\n");
    expect(stripDisallowedMarkdownLinks("[~ Definition](javascript:x)\n")).toBe(
      "\\~ Definition\n",
    );
    expect(stripDisallowedMarkdownLinks("[| line block](javascript:x)\n")).toBe(
      "\\| line block\n",
    );
  });

  it("escapes pandoc's example and fancy list markers; remark already escapes 1. and 1)", () => {
    expect(
      stripDisallowedMarkdownLinks("[(@case) Label](javascript:x)\n"),
    ).toBe("\\(@case) Label\n");
    expect(stripDisallowedMarkdownLinks("[(a) Label](javascript:x)\n")).toBe(
      "\\(a) Label\n",
    );
    expect(stripDisallowedMarkdownLinks("[a. Label](javascript:x)\n")).toBe(
      "a\\. Label\n",
    );
    expect(stripDisallowedMarkdownLinks("[iv) Label](javascript:x)\n")).toBe(
      "iv\\) Label\n",
    );
    expect(stripDisallowedMarkdownLinks("[1) Label](javascript:x)\n")).toBe(
      "1\\) Label\n",
    );
    // A word that merely ends in a period is not a marker.
    expect(stripDisallowedMarkdownLinks("[Note. Label](javascript:x)\n")).toBe(
      "Note. Label\n",
    );
  });

  it("keeps a trailing # or {attribute} visible at the end of a heading", () => {
    const hash = stripDisallowedMarkdownLinks("# [foo #](javascript:x)\n");
    expect(hash).toBe("# foo \\#\n");
    expect(toString(parseMdast(hash).children[0])).toBe("foo #");
    expect(
      stripDisallowedMarkdownLinks("# [Visible {#owned}](javascript:x)\n"),
    ).toBe("# Visible \\{#owned}\n");
  });

  it("flattens a multi-line math label and leaves math's own \\| alone in a cell", () => {
    expect(
      stripDisallowedMarkdownLinks("> [$x\n> (a) y$](javascript:x)\n"),
    ).toBe("> $x (a) y$\n");
    const table = stripDisallowedMarkdownLinks(
      "| [$a\\|b$](javascript:x) | k |\n| --- | --- |\n| 1 | 2 |\n",
    );
    expect(table).toBe("| $a\\|b$ | k |\n| --- | --- |\n| 1 | 2 |\n");
    const header = (parseMdast(table).children[0] as Table).children[0];
    expect(header.children).toHaveLength(2);
  });
});

describe("reference-style links", () => {
  it("rewrites every reference form to its label; the definition stays (it renders as nothing)", () => {
    const input =
      "[label][ref] and [ref] and [ref][]\n\n[ref]: javascript:alert(1)\n";
    expect(stripDisallowedMarkdownLinks(input)).toBe(
      "label and ref and ref\n\n[ref]: javascript:alert(1)\n",
    );
  });

  it("resolves a definition that comes before its reference", () => {
    expect(
      stripDisallowedMarkdownLinks("[ref]: javascript:x\n\n[l][ref]\n"),
    ).toBe("[ref]: javascript:x\n\nl\n");
  });

  it("treats duplicate definitions as refused when ANY of them is (pandoc takes the last, CommonMark the first)", () => {
    expect(
      stripDisallowedMarkdownLinks(
        "[l][r]\n\n[r]: https://ok.example/\n[r]: javascript:x\n",
      ),
    ).toBe("l\n\n[r]: https://ok.example/\n[r]: javascript:x\n");
    expect(
      stripDisallowedMarkdownLinks(
        "[l][r]\n\n[r]: javascript:x\n[r]: https://ok.example/\n",
      ),
    ).toBe("l\n\n[r]: javascript:x\n[r]: https://ok.example/\n");
  });

  it("works inside a list item and a block quote without disturbing their markers", () => {
    expect(
      stripDisallowedMarkdownLinks("- [r]: javascript:x\n  [item][r]\n"),
    ).toBe("- [r]: javascript:x\n  item\n");
    expect(
      stripDisallowedMarkdownLinks("> [r]: javascript:x\n> [q][r]\n"),
    ).toBe("> [r]: javascript:x\n> q\n");
  });

  it("leaves an image reference alone even when it shares the refused definition", () => {
    // Image sources are outside this policy (parity with 499, which did not
    // scrub <img src>); the link reference beside it is still rewritten.
    expect(
      stripDisallowedMarkdownLinks(
        "[l][ref] ![alt][ref]\n\n[ref]: javascript:x\n",
      ),
    ).toBe("l ![alt][ref]\n\n[ref]: javascript:x\n");
  });
});

describe("inside a GFM table cell", () => {
  // The parsed label has its pipes DECODED (`a \| b` → `a | b`); written back
  // bare they would end the cell early. Code spans are no exception in GFM.
  const TABLE =
    "| [a \\| b](javascript:x) | [`c\\|d`](javascript:y) | **[e \\| f](javascript:z)** |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n";

  it("escapes the label's pipes so every cell stays one cell", () => {
    const out = stripDisallowedMarkdownLinks(TABLE);
    expect(out).toBe(
      "| a \\| b | `c\\|d` | **e \\| f** |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n",
    );
    const table = parseMdast(out).children[0] as Table;
    expect(table.type).toBe("table");
    const header = table.children[0];
    expect(header.children).toHaveLength(3);
    expect(header.children.map((cell) => toString(cell))).toEqual([
      "a | b",
      "c|d",
      "e | f",
    ]);
  });
});

describe("a splice that could fuse with its neighbours", () => {
  // `<` + label + `>` is an angle autolink, `&` + label + `;` a character
  // reference, `[` + label + `](…)` or `]` a link or reference. A naive
  // splice would have written those with its own hands; escaping the left
  // neighbour keeps the visible text and forms none of them.
  it("escapes a fusing left neighbour so no autolink, entity or link is formed", () => {
    const autolink = stripDisallowedMarkdownLinks(
      "<[javascript:x](javascript:y)>\n",
    );
    expect(autolink).toBe("\\<javascript:x>\n");
    expect(linkUrls(autolink)).toEqual([]);

    expect(stripDisallowedMarkdownLinks("&[amp](javascript:x);\n")).toBe(
      "\\&amp;\n",
    );
    expect(toString(parseMdast("\\&amp;\n"))).toBe("&amp;");

    // (A relative destination on the outside: with an https:// one, GFM's
    // literal-autolink rule would linkify the bare URL text and muddy the
    // "no link formed" assertion.)
    const link = stripDisallowedMarkdownLinks("[[x](javascript:y)](page.md)\n");
    expect(link).toBe("\\[x](page.md)\n");
    expect(linkUrls(link)).toEqual([]);

    expect(
      stripDisallowedMarkdownLinks(
        "[[x](javascript:y)]\n\n[x]: javascript:z\n",
      ),
    ).toBe("\\[x]\n\n[x]: javascript:z\n");
  });

  it("leaves a left neighbour alone when it is already escaped", () => {
    // `\&` is already literal; a second backslash would render as `\&`.
    expect(stripDisallowedMarkdownLinks("\\&[amp](javascript:x);\n")).toBe(
      "\\&amp;\n",
    );
    expect(
      stripDisallowedMarkdownLinks("\\<[javascript:x](javascript:y)>\n"),
    ).toBe("\\<javascript:x>\n");
    expect(
      stripDisallowedMarkdownLinks("\\[[x](javascript:y)](page.md)\n"),
    ).toBe("\\[x](page.md)\n");
    // An even run is escaped backslashes; the neighbour is live and gets one.
    expect(stripDisallowedMarkdownLinks("\\\\&[amp](javascript:x);\n")).toBe(
      "\\\\\\&amp;\n",
    );
  });

  it("breaks syntax the right neighbour would complete: list markers and entities", () => {
    const list = stripDisallowedMarkdownLinks("[1](javascript:x). item\n");
    expect(list).toBe("1\\. item\n");
    expect(blockTypes(list)).toEqual(["paragraph"]);
    expect(stripDisallowedMarkdownLinks("[iv](javascript:x)) item\n")).toBe(
      "iv\\) item\n",
    );
    // Mid-line the escape is harmless and keeps the rule simple.
    expect(stripDisallowedMarkdownLinks("see [1](javascript:x). done\n")).toBe(
      "see 1\\. done\n",
    );

    const entity = stripDisallowedMarkdownLinks("[&](javascript:x)amp;\n");
    expect(entity).toBe("\\&amp;\n");
    expect(toString(parseMdast(entity))).toBe("&amp;");
    expect(stripDisallowedMarkdownLinks("[a&am](javascript:x)p; b\n")).toBe(
      "a\\&amp; b\n",
    );
    // No entity is completed here, so no escape either.
    expect(stripDisallowedMarkdownLinks("[a & b](javascript:x) c\n")).toBe(
      "a & b c\n",
    );
  });

  it("an empty label at a line's content start does not hand the line to a block opener", () => {
    for (const [input, expected] of [
      ["[](javascript:x)- item\n", "\\- item\n"],
      ["[](javascript:x)# heading\n", "\\# heading\n"],
      ["[](javascript:x)---\n", "\\---\n"],
      ["[](javascript:x)1. item\n", "1\\. item\n"],
      [
        "[](javascript:x)[r]: https://ok.example/\n",
        "\\[r]: https://ok.example/\n",
      ],
    ]) {
      const out = stripDisallowedMarkdownLinks(input);
      expect(out).toBe(expected);
      expect(blockTypes(out)).toEqual(["paragraph"]);
    }
    // Inside a container the content start is after its marker.
    const quoted = stripDisallowedMarkdownLinks("> [](javascript:x)- item\n");
    expect(quoted).toBe("> \\- item\n");
    expect(parseMdast(quoted).children[0].type).toBe("blockquote");
    expect(blockTypes(quoted)).toEqual(["blockquote"]);
    // Mid-line nothing opens a block, so nothing is escaped — the emphasis
    // that followed the link stays emphasis.
    expect(stripDisallowedMarkdownLinks("see [](javascript:x)*x*\n")).toBe(
      "see *x*\n",
    );
  });

  it("settles on deeply nested angle brackets in one extra pass, not one per layer", () => {
    const wrapped = `${"<".repeat(20)}[javascript:x](javascript:y)${">".repeat(20)}\n`;
    const out = stripDisallowedMarkdownLinks(wrapped);
    expect(out).toContain("\\<javascript:x>");
    expect(linkUrls(out)).toEqual([]);
  });
});

describe("what is never a link", () => {
  it("leaves code spans and fences alone", () => {
    const input = "`[x](javascript:y)`\n\n```\n[x](javascript:y)\n```\n";
    expect(stripDisallowedMarkdownLinks(input)).toBe(input);
  });

  it("leaves YAML frontmatter and math alone", () => {
    const input = "---\nurl: javascript:x\n---\n\n$[a](javascript:b)$\n";
    expect(stripDisallowedMarkdownLinks(input)).toBe(input);
  });

  it("returns the same string for a document with nothing to refuse", () => {
    const input =
      "[a](page.md) [b](#frag) [c](mailto:x@y.z) [d](ftp://h/f) <https://h/p> www.example.com\n\n[e]: https://ok.example/\n[f][e]\n";
    expect(stripDisallowedMarkdownLinks(input)).toBe(input);
  });

  it("lets the wikilink conversions' relative .md links through", () => {
    const md = "see [[Other Page|alias]] and [x](javascript:y)\n";
    expect(stripDisallowedMarkdownLinks(convertForPandoc(md))).toBe(
      "see [alias](Other%20Page.md) and x\n",
    );
    expect(stripDisallowedMarkdownLinks(convertForNotion(md))).toBe(
      "see [alias](Other%20Page.md) and x\n",
    );
  });
});

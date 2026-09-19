// notion-export.test.ts — Tests for Baram -> Notion markdown conversion
import { describe, expect, it } from "vitest";

import {
  convertCalloutsForNotion,
  convertDefinitionListsForNotion,
  convertFootnotesForNotion,
  convertForNotion,
  convertHighlightForNotion,
  convertInlineMathForNotion,
  convertSubscriptForNotion,
  convertSuperscriptForNotion,
  convertToggleForNotion,
  convertUnderlineForNotion,
  convertWikilinksForNotion,
  stripBlockRefsForNotion,
  stripMermaidMetaForNotion,
  stripTocForNotion,
  toUnicodeSubscript,
  toUnicodeSuperscript,
} from "../export/notion-export";

// ---------------------------------------------------------------------------
// 1. toUnicodeSubscript
// ---------------------------------------------------------------------------
describe("toUnicodeSubscript", () => {
  it("converts digits to subscript", () => {
    const result = toUnicodeSubscript("012");
    expect(result.text).toBe("\u2080\u2081\u2082");
    expect(result.complete).toBe(true);
  });

  it("converts available letters to subscript", () => {
    const result = toUnicodeSubscript("aen");
    expect(result.text).toBe("\u2090\u2091\u2099");
    expect(result.complete).toBe(true);
  });

  it("returns complete=false for unmapped characters", () => {
    const result = toUnicodeSubscript("abc");
    // 'a' maps, 'b' doesn't, 'c' doesn't
    expect(result.complete).toBe(false);
  });

  it("converts special characters", () => {
    const result = toUnicodeSubscript("+-=()");
    expect(result.text).toBe("\u208A\u208B\u208C\u208D\u208E");
    expect(result.complete).toBe(true);
  });

  it("handles empty string", () => {
    const result = toUnicodeSubscript("");
    expect(result.text).toBe("");
    expect(result.complete).toBe(true);
  });

  it("handles mixed mapped and unmapped", () => {
    const result = toUnicodeSubscript("H2O");
    // H not mapped, 2 mapped, O not mapped
    expect(result.complete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. toUnicodeSuperscript
// ---------------------------------------------------------------------------
describe("toUnicodeSuperscript", () => {
  it("converts digits to superscript", () => {
    const result = toUnicodeSuperscript("123");
    expect(result.text).toBe("\u00B9\u00B2\u00B3");
    expect(result.complete).toBe(true);
  });

  it("converts available letters to superscript", () => {
    const result = toUnicodeSuperscript("abc");
    expect(result.text).toBe("\u1D43\u1D47\u1D9C");
    expect(result.complete).toBe(true);
  });

  it("returns complete=false for unmapped characters like uppercase", () => {
    const result = toUnicodeSuperscript("AB");
    expect(result.complete).toBe(false);
  });

  it("converts special characters", () => {
    const result = toUnicodeSuperscript("+-");
    expect(result.text).toBe("\u207A\u207B");
    expect(result.complete).toBe(true);
  });

  it("handles empty string", () => {
    const result = toUnicodeSuperscript("");
    expect(result.text).toBe("");
    expect(result.complete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. convertWikilinksForNotion
// ---------------------------------------------------------------------------
describe("convertWikilinksForNotion", () => {
  it("converts simple wikilink", () => {
    expect(convertWikilinksForNotion("See [[my page]] here")).toBe(
      "See [my page](my%20page.md) here",
    );
  });

  it("converts wikilink with alias", () => {
    expect(convertWikilinksForNotion("See [[my page|click here]]")).toBe(
      "See [click here](my%20page.md)",
    );
  });

  it("converts wikilink with heading", () => {
    expect(convertWikilinksForNotion("See [[page#section one]]")).toBe(
      "See [page > section one](page.md#section%20one)",
    );
  });

  it("encodes spaces in filename as %20", () => {
    expect(convertWikilinksForNotion("[[my long page name]]")).toBe(
      "[my long page name](my%20long%20page%20name.md)",
    );
  });

  it("leaves external links unchanged", () => {
    const input = "[Google](https://google.com)";
    expect(convertWikilinksForNotion(input)).toBe(input);
  });

  it("converts multiple wikilinks in one line", () => {
    const input = "See [[page A]] and [[page B]]";
    const result = convertWikilinksForNotion(input);
    expect(result).toBe("See [page A](page%20A.md) and [page B](page%20B.md)");
  });

  it("does not convert wikilinks inside inline code", () => {
    const input = "Use `[[page]]` syntax";
    expect(convertWikilinksForNotion(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// 4. convertCalloutsForNotion
// ---------------------------------------------------------------------------
describe("convertCalloutsForNotion", () => {
  it("converts tip callout without title", () => {
    const input = "> [!tip]\n> This is a tip";
    const result = convertCalloutsForNotion(input);
    expect(result).toBe("> \u{1F4A1} **Tip**: This is a tip");
  });

  it("converts warning callout with title", () => {
    const input = "> [!warning] Be careful\n> Don't do this";
    const result = convertCalloutsForNotion(input);
    expect(result).toBe("> \u{26A0}\u{FE0F} **Be careful**\n> Don't do this");
  });

  it("uses note emoji for unknown type", () => {
    const input = "> [!custom]\n> Some content";
    const result = convertCalloutsForNotion(input);
    expect(result).toContain("\u{1F4DD}");
  });

  it("handles multiline callout body", () => {
    const input = "> [!info]\n> Line one\n> Line two\n> Line three";
    const result = convertCalloutsForNotion(input);
    expect(result).toContain("**Info**: Line one");
    expect(result).toContain("> Line two");
    expect(result).toContain("> Line three");
  });

  it("returns unchanged text when no callouts present", () => {
    const input = "# Hello\n\nJust a normal paragraph.";
    expect(convertCalloutsForNotion(input)).toBe(input);
  });

  it("handles callout with no body content", () => {
    const input = "> [!note]";
    const result = convertCalloutsForNotion(input);
    expect(result).toBe("> \u{1F4DD} **Note**");
  });

  it("handles danger callout", () => {
    const input = "> [!danger]\n> Critical issue";
    const result = convertCalloutsForNotion(input);
    expect(result).toContain("\u{1F525}");
    expect(result).toContain("**Danger**: Critical issue");
  });
});

// ---------------------------------------------------------------------------
// 5. convertInlineMathForNotion
// ---------------------------------------------------------------------------
describe("convertInlineMathForNotion", () => {
  it("converts single-dollar inline math to double-dollar", () => {
    const input = "The formula $E = mc^2$ is famous";
    expect(convertInlineMathForNotion(input)).toBe(
      "The formula $$E = mc^2$$ is famous",
    );
  });

  it("does not touch already-double-dollar block math", () => {
    const input = "$$\nx^2 + y^2 = r^2\n$$";
    expect(convertInlineMathForNotion(input)).toBe(input);
  });

  it("does not modify math inside inline code", () => {
    const input = "Use `$x$` for inline math";
    expect(convertInlineMathForNotion(input)).toBe(input);
  });

  it("converts inline math that wraps a code span (#634)", () => {
    // Only the `$` delimiters must sit outside code; the interior is carried
    // over verbatim. Judged by overlap the span stayed `$…$`, which Notion
    // shows as literal dollar signs, not math.
    expect(convertInlineMathForNotion("$a `x` b$")).toBe("$$a `x` b$$");
  });

  it("opens no formula inside a path or a tag (issue 544)", () => {
    // A `$` in a destination is a path's character, not an opener: two
    // URLs with a `$` each, in one paragraph, paired across their
    // destinations and both broke.
    expect(convertInlineMathForNotion("![](p/$a b$.png)")).toBe(
      "![](p/$a b$.png)",
    );
    expect(
      convertInlineMathForNotion(
        "[a](https://x/?q=$1) and [b](https://y/?q=$2)",
      ),
    ).toBe("[a](https://x/?q=$1) and [b](https://y/?q=$2)");
    expect(convertInlineMathForNotion('[id]: p/$a$.png "t"')).toBe(
      '[id]: p/$a$.png "t"',
    );
    // A formula opened before a link owns it, as the editor's does.
    expect(convertInlineMathForNotion("$a [x](u) b$")).toBe("$$a [x](u) b$$");
  });

  it("converts multiple inline math expressions", () => {
    const input = "Where $a$ and $b$ are constants";
    expect(convertInlineMathForNotion(input)).toBe(
      "Where $$a$$ and $$b$$ are constants",
    );
  });

  it("converts a price pair exactly as the editor renders it — as a formula (issue 636)", () => {
    // remark-math with single dollars reads `$10 or $` as inline math, and
    // so does the editor on screen; the export shows Notion the same
    // document. Whether prices should be math at all is the editor
    // grammar's question, not the export's.
    expect(convertInlineMathForNotion("Price is $10 or $20")).toBe(
      "Price is $$10 or $$20",
    );
  });

  describe("pairs dollars the way the editor's parser does (issue 636)", () => {
    it("lets whichever opened first own the other's delimiters", () => {
      // The formula opened at the first `$` owns the backtick inside it and
      // closes at the `$` inside what would have been a code span — the
      // editor shows `a `x` as the formula and the rest as text. A code
      // span opened first owns its dollar.
      expect(convertInlineMathForNotion("$a `x$y` b$")).toBe("$$a `x$$y` b$");
      expect(convertInlineMathForNotion("`$` and $x$")).toBe("`$` and $$x$$");
      expect(convertInlineMathForNotion("`unclosed $x$")).toBe(
        "`unclosed $$x$$",
      );
    });

    it("closes a run with the next run of the same length only", () => {
      expect(convertInlineMathForNotion("$a $$x$$ b$")).toBe("$$a $$x$$ b$$");
      expect(convertInlineMathForNotion("$a $$ b$")).toBe("$$a $$ b$$");
      expect(convertInlineMathForNotion("$$x$$")).toBe("$$x$$");
      expect(convertInlineMathForNotion("$$$x$$$")).toBe("$$$x$$$");
    });

    it("reads a backslash before an opener only: it shortens the run, and a closer is never escaped", () => {
      expect(convertInlineMathForNotion("\\$$x$")).toBe("\\$$$x$$");
      expect(convertInlineMathForNotion("$x\\$")).toBe("$$x\\$$");
    });

    it("has no whitespace or digit rules, as the editor has none", () => {
      expect(convertInlineMathForNotion("$ x$")).toBe("$$ x$$");
      expect(convertInlineMathForNotion("$x$5")).toBe("$$x$$5");
      expect(convertInlineMathForNotion("a$b$c")).toBe("a$$b$$c");
    });

    it("pairs within a line, and never across a blank line", () => {
      expect(convertInlineMathForNotion("$a\nb$")).toBe("$a\nb$");
      expect(convertInlineMathForNotion("$a\r\n\r\nb$")).toBe("$a\r\n\r\nb$");
    });

    it("leaves display math alone, unclosed included", () => {
      expect(convertInlineMathForNotion("$$\n$x$\n")).toBe("$$\n$x$\n");
    });
  });
});

// ---------------------------------------------------------------------------
// 6. convertHighlightForNotion
// ---------------------------------------------------------------------------
describe("convertHighlightForNotion", () => {
  it("converts basic highlight to bold", () => {
    expect(convertHighlightForNotion("This is ==highlighted== text")).toBe(
      "This is **highlighted** text",
    );
  });

  it("converts multiple highlights", () => {
    expect(convertHighlightForNotion("==one== and ==two==")).toBe(
      "**one** and **two**",
    );
  });

  it("returns text unchanged when no highlights", () => {
    const input = "No highlights here.";
    expect(convertHighlightForNotion(input)).toBe(input);
  });

  it("does not convert == inside code", () => {
    const input = "Use `==highlight==` syntax";
    expect(convertHighlightForNotion(input)).toBe(input);
  });

  it("converts a highlight that wraps a code span (#634)", () => {
    // Same rule as inline math: a mark may wrap code, so `==a `x` b==` must
    // still become bold instead of reaching Notion as a literal `==`.
    expect(convertHighlightForNotion("==a `x` b==")).toBe("**a `x` b**");
  });

  it("never rewrites a path or a tag: a `==` there is not a mark (issue 544)", () => {
    // The pandoc pass has protected markup since issue 544; this one read a
    // destination as text and wrote `**a**` into the file name.
    expect(convertHighlightForNotion("![](p/==a==.png)")).toBe(
      "![](p/==a==.png)",
    );
    expect(convertHighlightForNotion('<img src="p/==a==.png">')).toBe(
      '<img src="p/==a==.png">',
    );
    // A highlight WRAPPING a link still converts: its delimiters are text.
    expect(convertHighlightForNotion("==see [d](u) now==")).toBe(
      "**see [d](u) now**",
    );
  });

  describe("finds its closer past a `==` inside code (issue 636)", () => {
    it("pairs across a code span holding the delimiter", () => {
      // The match is found on a shadow in which the code span is filler:
      // the `==` inside it is no closer, and the real closer behind the
      // span is found instead of being thrown away with the rejected one.
      expect(convertHighlightForNotion("==a `x==y` b==")).toBe(
        "**a `x==y` b**",
      );
      expect(convertHighlightForNotion("==a `==` b==")).toBe("**a `==` b**");
      expect(convertHighlightForNotion("`==` then ==hi==")).toBe(
        "`==` then **hi**",
      );
    });

    it("keeps display math protected, and a `$$` inside code is code", () => {
      // An unclosed display block runs to the end; a `$$$` block is not
      // closed by `$$`; a `$$` inside a code span opens nothing.
      expect(convertHighlightForNotion("$$\n==inside==\n")).toBe(
        "$$\n==inside==\n",
      );
      expect(convertHighlightForNotion("$$$\nx\n$$\n==still math==\n")).toBe(
        "$$$\nx\n$$\n==still math==\n",
      );
      expect(convertHighlightForNotion("- $$\n  ==x==\n  $$$\n==y==")).toBe(
        "- $$\n  ==x==\n  $$$\n**y**",
      );
      expect(convertHighlightForNotion("`$$` ==live== $$")).toBe(
        "`$$` **live** $$",
      );
    });

    it("closes a fence written with CRLF or lone CR line breaks", () => {
      expect(
        convertHighlightForNotion("```\r\n==code==\r\n```\r\n==live=="),
      ).toBe("```\r\n==code==\r\n```\r\n**live**");
      expect(convertHighlightForNotion("```\r==code==\r```\r==live==")).toBe(
        "```\r==code==\r```\r**live**",
      );
    });

    it("keeps its own line rule, and counts code units so an astral character inside code shifts nothing", () => {
      expect(convertHighlightForNotion("==a\nb== c")).toBe("==a\nb== c");
      expect(convertHighlightForNotion("==a `😀==` b== ==c==")).toBe(
        "**a `😀==` b** **c**",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 7. convertSubscriptForNotion
// ---------------------------------------------------------------------------
describe("convertSubscriptForNotion", () => {
  it("crosses a soft line break, as the editor's mark does", () => {
    expect(convertSubscriptForNotion("A~b\nc~D")).toBe("A$$_{b\nc}$$D");
  });

  it("leaves a pair that swallows code alone and still converts the next pair (issue 636)", () => {
    // The first pair is found as a pair on the shadow and refused for
    // wrapping code; its closer is consumed with it, not offered to the
    // next opener as `~ and ~` once was.
    expect(convertSubscriptForNotion("~a `x~y` b~ and ~c d~")).toBe(
      "~a `x~y` b~ and $$_{c d}$$",
    );
  });

  it("never touches a path or a tag: the marks live in text, not in markup (issue 544)", () => {
    // The pandoc pass has protected markup since issue 544; this one read a
    // destination as text and wrote `$$_{a b}$$` — or `note₁`, with no
    // fallback to notice — into a path that then names no file.
    expect(convertSubscriptForNotion("![alt](p/~a b~.png)")).toBe(
      "![alt](p/~a b~.png)",
    );
    expect(convertSubscriptForNotion('<img src="p/~a b~.png">')).toBe(
      '<img src="p/~a b~.png">',
    );
    // The definition's region is its destination: the title is text, and
    // so is the mark after it.
    expect(convertSubscriptForNotion('[id]: p/~a~.png "t" ~b c~')).toBe(
      '[id]: p/~a~.png "t" $$_{b c}$$',
    );
    expect(convertSubscriptForNotion("![](assets/note~1~.png)")).toBe(
      "![](assets/note~1~.png)",
    );
    // One tilde per path, two paths in a paragraph — a Windows 8.3 name or
    // a `~user` URL twice — paired ACROSS the destinations and broke both.
    expect(
      convertSubscriptForNotion("![](a/FILENA~1.PNG)\n![](b/FILENA~2.PNG)"),
    ).toBe("![](a/FILENA~1.PNG)\n![](b/FILENA~2.PNG)");
    expect(
      convertSubscriptForNotion(
        "[x](https://h.edu/~alice/) and [y](https://h.edu/~bob/)",
      ),
    ).toBe("[x](https://h.edu/~alice/) and [y](https://h.edu/~bob/)");
    // A mark after a destination still converts.
    expect(convertSubscriptForNotion("![](p/~a.png) ~c d~")).toBe(
      "![](p/~a.png) $$_{c d}$$",
    );
  });

  it("refuses a pair that wraps a link or a tag, as it refuses one that wraps code", () => {
    // The interior is the mark's to rewrite, so a destination or a tag
    // inside it is not its text; the pandoc pass has the same rule.
    expect(convertSubscriptForNotion("~a [x](u) b~")).toBe("~a [x](u) b~");
    expect(convertSubscriptForNotion("~<u>x</u>~")).toBe("~<u>x</u>~");
    // The refused pair is consumed, as every refused pair is: its closer
    // is not offered to the `~` after it.
    expect(convertSubscriptForNotion("~a <u>x</u> c~d~")).toBe(
      "~a <u>x</u> c~d~",
    );
  });

  it("does not protect `$…$` itself: in the pipeline the math pass has already rewritten it", () => {
    // The pandoc passes ask for `inlineMath`; these must not, or a formula
    // the math pass left alone would hide the mark inside it. Standalone,
    // the mark inside a single-dollar pair converts.
    expect(convertSubscriptForNotion("$a ~x y~ b$")).toBe("$a $$_{x y}$$ b$");
    expect(convertSuperscriptForNotion("$a ^x y^ b$")).toBe("$a $$^{x y}$$ b$");
  });

  it("converts digit subscript to Unicode", () => {
    const result = convertSubscriptForNotion("H~2~O");
    expect(result).toBe("H\u2082O");
  });

  it("converts letter subscript to Unicode when available", () => {
    const result = convertSubscriptForNotion("x~n~");
    expect(result).toBe("x\u2099");
  });

  it("falls back to math for unmapped characters", () => {
    const result = convertSubscriptForNotion("A~BC~");
    expect(result).toBe("A$$_{BC}$$");
  });

  it("does NOT match ~~strikethrough~~", () => {
    const input = "This is ~~struck~~";
    expect(convertSubscriptForNotion(input)).toBe(input);
  });

  it("handles subscript next to strikethrough without confusion", () => {
    const input = "~2~ and ~~strike~~";
    const result = convertSubscriptForNotion(input);
    expect(result).toContain("\u2082");
    expect(result).toContain("~~strike~~");
  });
});

// ---------------------------------------------------------------------------
// 8. convertSuperscriptForNotion
// ---------------------------------------------------------------------------
describe("convertSuperscriptForNotion", () => {
  it("converts digit superscript to Unicode", () => {
    const result = convertSuperscriptForNotion("x^2^");
    expect(result).toBe("x\u00B2");
  });

  it("converts letter superscript to Unicode when available", () => {
    const result = convertSuperscriptForNotion("e^n^");
    expect(result).toBe("e\u207F");
  });

  it("falls back to math for unmapped characters", () => {
    const result = convertSuperscriptForNotion("2^AB^");
    expect(result).toBe("2$$^{AB}$$");
  });

  it("handles multiple superscripts", () => {
    const result = convertSuperscriptForNotion("x^2^ + y^3^");
    expect(result).toBe("x\u00B2 + y\u00B3");
  });

  it("never touches a path or a tag, and refuses a pair that wraps one (issue 544)", () => {
    expect(convertSuperscriptForNotion("see [ref](docs/x^2^.md)")).toBe(
      "see [ref](docs/x^2^.md)",
    );
    expect(convertSuperscriptForNotion('<img src="p/x^2.png"> ^3^')).toBe(
      '<img src="p/x^2.png"> \u00B3',
    );
    expect(convertSuperscriptForNotion("^see [x](u)^")).toBe("^see [x](u)^");
  });
});

// ---------------------------------------------------------------------------
// 9. convertFootnotesForNotion
// ---------------------------------------------------------------------------
describe("convertFootnotesForNotion", () => {
  it("converts a single footnote", () => {
    const input = "Text with a note[^1].\n\n[^1]: This is the note.";
    const result = convertFootnotesForNotion(input);
    expect(result).toContain("Text with a note(1).");
    expect(result).toContain("**Notes**");
    expect(result).toContain("1. **1**: This is the note.");
  });

  it("converts multiple footnotes", () => {
    const input = "A[^1] and B[^2].\n\n[^1]: First note.\n[^2]: Second note.";
    const result = convertFootnotesForNotion(input);
    expect(result).toContain("A(1) and B(2).");
    expect(result).toContain("1. **1**: First note.");
    expect(result).toContain("2. **2**: Second note.");
  });

  it("returns unchanged when no footnotes", () => {
    const input = "No footnotes here.";
    expect(convertFootnotesForNotion(input)).toBe(input);
  });

  it("handles named footnotes", () => {
    const input = "Text[^abc].\n\n[^abc]: Named note.";
    const result = convertFootnotesForNotion(input);
    expect(result).toContain("Text(abc).");
    expect(result).toContain("**abc**: Named note.");
  });
});

// ---------------------------------------------------------------------------
// 10. stripBlockRefsForNotion
// ---------------------------------------------------------------------------
describe("stripBlockRefsForNotion", () => {
  it("removes inline block references", () => {
    const input = "See ((target#^abc123)) for details";
    expect(stripBlockRefsForNotion(input)).toBe("See  for details");
  });

  it("removes block ID suffixes at end of lines", () => {
    const input = "Some paragraph text ^blockid";
    expect(stripBlockRefsForNotion(input)).toBe("Some paragraph text");
  });

  it("returns unchanged when no block refs", () => {
    const input = "Normal text without refs.";
    expect(stripBlockRefsForNotion(input)).toBe(input);
  });

  it("handles multiple block refs in one document", () => {
    const input = "Line one ^id1\nLine two ^id2";
    const result = stripBlockRefsForNotion(input);
    expect(result).toBe("Line one\nLine two");
  });
});

// ---------------------------------------------------------------------------
// 11. convertDefinitionListsForNotion
// ---------------------------------------------------------------------------
describe("convertDefinitionListsForNotion", () => {
  it("converts HTML dl/dt/dd to bold term + colon definition", () => {
    const input = "<dl>\n<dt>Term</dt>\n<dd>Definition</dd>\n</dl>";
    const result = convertDefinitionListsForNotion(input);
    expect(result).toBe("**Term**\n: Definition");
  });

  it("converts multiple dt/dd pairs", () => {
    const input =
      "<dl>\n<dt>Term 1</dt>\n<dd>Def 1</dd>\n<dt>Term 2</dt>\n<dd>Def 2</dd>\n</dl>";
    const result = convertDefinitionListsForNotion(input);
    expect(result).toBe("**Term 1**\n: Def 1\n\n**Term 2**\n: Def 2");
  });

  it("converts plain text definition format and keeps colon prefix", () => {
    const input = "API\n: Application Programming Interface";
    const result = convertDefinitionListsForNotion(input);
    expect(result).toBe("**API**\n: Application Programming Interface");
  });

  it("returns unchanged when no definition lists", () => {
    const input = "Just a normal paragraph.";
    expect(convertDefinitionListsForNotion(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// 12. stripTocForNotion
// ---------------------------------------------------------------------------
describe("stripTocForNotion", () => {
  it("removes [TOC] line", () => {
    const input = "# Title\n\n[TOC]\n\n## Section";
    const result = stripTocForNotion(input);
    expect(result).not.toContain("[TOC]");
    expect(result).toContain("# Title");
    expect(result).toContain("## Section");
  });

  it("handles case insensitive [toc]", () => {
    const input = "[toc]\n\nContent";
    const result = stripTocForNotion(input);
    expect(result).not.toContain("[toc]");
  });

  it("returns unchanged when no TOC", () => {
    const input = "# Title\n\n## Section";
    expect(stripTocForNotion(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// 13. convertToggleForNotion
// ---------------------------------------------------------------------------
describe("convertToggleForNotion", () => {
  it("converts basic toggle", () => {
    const input = "<details><summary>FAQ</summary>\n\nAnswer here.\n</details>";
    const result = convertToggleForNotion(input);
    expect(result).toContain("**\u25B6 FAQ**");
    expect(result).toContain("Answer here.");
  });

  it("converts toggle with multiline body", () => {
    const input =
      "<details><summary>Details</summary>\n\nLine 1\nLine 2\nLine 3\n</details>";
    const result = convertToggleForNotion(input);
    expect(result).toContain("**\u25B6 Details**");
    expect(result).toContain("Line 1");
    expect(result).toContain("Line 2");
    expect(result).toContain("Line 3");
  });

  it("handles toggle with empty body", () => {
    const input = "<details><summary>Empty</summary></details>";
    const result = convertToggleForNotion(input);
    expect(result).toBe("**\u25B6 Empty**");
  });
});

// ---------------------------------------------------------------------------
// 14. convertUnderlineForNotion
// ---------------------------------------------------------------------------
describe("convertUnderlineForNotion", () => {
  it("leaves a tag inside code or math alone, and converts an underline that wraps code (issue 636)", () => {
    expect(convertUnderlineForNotion("`<u>x</u>`")).toBe("`<u>x</u>`");
    expect(convertUnderlineForNotion("$$<u>x</u>$$")).toBe("$$<u>x</u>$$");
    expect(convertUnderlineForNotion("<u>a `x` b</u>")).toBe("*a `x` b*");
  });

  it("converts basic underline to italic", () => {
    expect(convertUnderlineForNotion("This is <u>underlined</u> text")).toBe(
      "This is *underlined* text",
    );
  });

  it("converts multiple underlines", () => {
    const input = "<u>one</u> and <u>two</u>";
    expect(convertUnderlineForNotion(input)).toBe("*one* and *two*");
  });

  it("returns unchanged when no underlines", () => {
    const input = "Normal text.";
    expect(convertUnderlineForNotion(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// 15. stripMermaidMetaForNotion
// ---------------------------------------------------------------------------
describe("stripMermaidMetaForNotion", () => {
  it("removes the baram-meta comment but keeps the mermaid fence + code", () => {
    const md = [
      "```mermaid",
      '%% baram-meta: {"width":60}',
      "graph TD",
      "  A --> B",
      "```",
    ].join("\n");
    const out = stripMermaidMetaForNotion(md);
    expect(out).toContain("```mermaid");
    expect(out).toContain("graph TD");
    expect(out).toContain("A --> B");
    expect(out).not.toContain("baram-meta");
  });

  it("leaves non-mermaid code fences untouched", () => {
    const md = ["```js", "const x = 1; // baram-meta", "```"].join("\n");
    expect(stripMermaidMetaForNotion(md)).toBe(md);
  });

  it("does not strip meta from a mermaid fence nested in an outer code block", () => {
    const md = [
      "````markdown",
      "```mermaid",
      '%% baram-meta: {"width":50}',
      "graph TD",
      "```",
      "````",
    ].join("\n");
    expect(stripMermaidMetaForNotion(md)).toBe(md);
  });
});

describe("convertForNotion + mermaid", () => {
  it("preserves a mermaid code block", () => {
    const md = ["```mermaid", "graph TD", "  A --> B", "```"].join("\n");
    const out = convertForNotion(md);
    expect(out).toContain("```mermaid");
    expect(out).toContain("A --> B");
  });

  it("strips baram-meta from a mermaid block through the full pipeline", () => {
    const md = [
      "```mermaid",
      '%% baram-meta: {"width":60}',
      "graph TD",
      "  A --> B",
      "```",
    ].join("\n");
    const out = convertForNotion(md);
    expect(out).not.toContain("baram-meta");
    expect(out).toContain("```mermaid");
    expect(out).toContain("A --> B");
  });
});

// ---------------------------------------------------------------------------
// 16. convertForNotion (full document integration)
// ---------------------------------------------------------------------------
describe("convertForNotion", () => {
  it("keeps its own `$$_{…}$$` subscript output readable by the passes after it (issue 636)", () => {
    // The subscript pass writes `$$_{a\nb}$$` across a line break; the
    // superscript pass must read it as inline math, not as a display block
    // opened by a `$$` line and never closed. A display block opens on a
    // line that is nothing but its `$$`.
    expect(convertForNotion("~a\nb~ ^2^")).toBe("$$_{a\nb}$$ ²");
    // A mark does not cross a blank line — the editor has none there, and
    // a wrapper written across one was math to no later pass.
    expect(convertForNotion("~a\n\nb~ ^2^")).toBe("~a\n\nb~ ²");
    expect(convertForNotion("~a\n\nb^2^~")).toBe("~a\n\nb²~");
    // The wrapper's content is math to every pass after it: a tag inside
    // converted math stays, and so does a superscript inside the wrapper.
    // A mark wrapping a tag is refused — the tag is markup, not the mark's
    // text (issue 544) — and the tag then converts on its own.
    expect(convertForNotion("$<u>x</u>$")).toBe("$$<u>x</u>$$");
    expect(convertForNotion("~x ^2^~")).toBe("$$_{x ^2^}$$");
    expect(convertForNotion("~<u>x</u>~")).toBe("~*x*~");
    // A blockquote's bare `>` line is a paragraph break too.
    expect(convertForNotion("> ~A\n>\n> B~ ^2^")).toBe("> ~A\n>\n> B~ ²");
    // Beside a lone dollar no wrapper is written — it would fuse into a
    // `$$$` run no later pass reads — while a Unicode mark still converts.
    expect(convertForNotion("$~<u>x</u>~")).toBe("$~*x*~");
    expect(convertForNotion("~<u>x</u>~$")).toBe("~*x*~$");
    expect(convertForNotion("$~a~")).toBe("$ₐ");
    expect(convertForNotion("~a~$")).toBe("ₐ$");
  });

  it("preserves frontmatter unchanged", () => {
    const input = "---\ntitle: My Doc\ntags: [a, b]\n---\n\n# Hello";
    const result = convertForNotion(input);
    expect(result).toContain("---\ntitle: My Doc\ntags: [a, b]\n---");
  });

  it("preserves standard markdown unchanged", () => {
    const input =
      "# Heading\n\n**bold** and *italic*\n\n- list item\n\n| a | b |\n| --- | --- |\n| 1 | 2 |";
    expect(convertForNotion(input)).toBe(input);
  });

  it("preserves code blocks unchanged", () => {
    const input = "```js\nconst x = $y;\nconst [[a]] = b;\n```";
    expect(convertForNotion(input)).toBe(input);
  });

  it("converts a full document with mixed elements", () => {
    const input = [
      "---",
      "title: Test",
      "---",
      "",
      "# My Document",
      "",
      "[TOC]",
      "",
      "> [!tip] Pro tip",
      "> Do this thing",
      "",
      "See [[other page]] for more.",
      "",
      "The formula $E=mc^2$ is important.",
      "",
      "==Highlighted== text and ~2~O.",
      "",
      "Text with footnote[^1].",
      "",
      "[^1]: The footnote content.",
    ].join("\n");

    const result = convertForNotion(input);

    // Frontmatter preserved
    expect(result).toContain("title: Test");

    // TOC removed
    expect(result).not.toContain("[TOC]");

    // Callout converted
    expect(result).toContain("\u{1F4A1}");
    expect(result).toContain("**Pro tip**");

    // Wikilink converted
    expect(result).toContain("[other page](other%20page.md)");

    // Inline math converted
    expect(result).toContain("$$E=mc^2$$");

    // Highlight converted
    expect(result).toContain("**Highlighted**");

    // Subscript converted (digit -> Unicode)
    expect(result).toContain("\u2082");

    // Footnote converted
    expect(result).toContain("(1)");
    expect(result).toContain("**Notes**");
  });

  it("handles empty document", () => {
    expect(convertForNotion("")).toBe("");
  });

  it("converts underline and superscript together", () => {
    const input = "<u>underline</u> and x^2^";
    const result = convertForNotion(input);
    expect(result).toContain("*underline*");
    expect(result).toContain("\u00B2");
  });

  it("converts definition list in full document with colon", () => {
    const input =
      "# Glossary\n\n<dl>\n<dt>API</dt>\n<dd>Application Programming Interface</dd>\n</dl>\n\nMore text.";
    const result = convertForNotion(input);
    expect(result).toContain("**API**\n: Application Programming Interface");
  });

  it("strips block references in full document", () => {
    const input = "Paragraph text ^blockid\n\nSee ((target#^ref123)) inline.";
    const result = convertForNotion(input);
    expect(result).not.toContain("^blockid");
    expect(result).not.toContain("((target#^ref123))");
  });

  it("preserves external links", () => {
    const input =
      "Visit [Google](https://google.com) or [Docs](https://docs.example.com/api).";
    expect(convertForNotion(input)).toBe(input);
  });

  it("preserves block math unchanged", () => {
    const input = "$$\n\\int_{a}^{b} f(x) dx = F(b) - F(a)\n$$";
    expect(convertForNotion(input)).toBe(input);
  });

  it("preserves block math with superscript and subscript in LaTeX", () => {
    const input = "Text before\n\n$$\nx^2 + y^2 = z^2\n$$\n\nText after";
    expect(convertForNotion(input)).toBe(input);
  });

  it("preserves block math while converting surrounding inline marks", () => {
    const input =
      "==highlighted== and x^2^\n\n$$\n\\sum_{i=0}^{n} a_i x^i\n$$\n\nMore ~0~ text";
    const result = convertForNotion(input);
    expect(result).toContain("**highlighted**");
    expect(result).toContain("\u00B2"); // superscript 2
    expect(result).toContain("$$\n\\sum_{i=0}^{n} a_i x^i\n$$"); // math untouched
    expect(result).toContain("\u2080"); // subscript 0
  });
});

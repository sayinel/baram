// §55 Pandoc Extended Export — convertForPandoc() preprocessing tests
import { describe, expect, it } from "vitest";

import {
  convertCalloutsForPandoc,
  convertForPandoc,
  convertHighlightForPandoc,
  convertSubscriptForPandoc,
  convertSuperscriptForPandoc,
  convertToggleForPandoc,
  convertUnderlineForPandoc,
  convertWikilinksForPandoc,
  stripBlockRefsForPandoc,
  stripTocForPandoc,
} from "../export/pandoc-export";

describe("§55 convertWikilinksForPandoc", () => {
  it("converts simple wikilink", () => {
    expect(convertWikilinksForPandoc("See [[MyPage]]")).toBe(
      "See [MyPage](MyPage.md)",
    );
  });

  it("converts wikilink with alias", () => {
    expect(convertWikilinksForPandoc("[[Target|display text]]")).toBe(
      "[display text](Target.md)",
    );
  });

  it("converts wikilink with heading", () => {
    expect(convertWikilinksForPandoc("[[Page#Section]]")).toBe(
      "[Page > Section](Page.md#Section)",
    );
  });

  it("preserves wikilinks inside code blocks", () => {
    const md = "```\n[[NotALink]]\n```";
    expect(convertWikilinksForPandoc(md)).toBe(md);
  });

  it("preserves wikilinks inside inline code", () => {
    const md = "Use `[[syntax]]` for links";
    expect(convertWikilinksForPandoc(md)).toBe(md);
  });

  it("handles spaces in page names", () => {
    expect(convertWikilinksForPandoc("[[My Page]]")).toBe(
      "[My Page](My%20Page.md)",
    );
  });
});

describe("§55 convertCalloutsForPandoc", () => {
  it("converts callout with title", () => {
    const input = "> [!tip] Pro tip";
    expect(convertCalloutsForPandoc(input)).toBe("> **Tip**: Pro tip");
  });

  it("converts callout without title", () => {
    const input = "> [!warning]";
    expect(convertCalloutsForPandoc(input)).toBe("> **Warning**");
  });

  it("preserves callout body lines", () => {
    const input = "> [!note] Title\n> Body line 1\n> Body line 2";
    const result = convertCalloutsForPandoc(input);
    expect(result).toContain("> **Note**: Title");
    expect(result).toContain("> Body line 1");
    expect(result).toContain("> Body line 2");
  });

  it("strips collapse indicators (+ and -)", () => {
    expect(convertCalloutsForPandoc("> [!tip]+ Expanded")).toBe(
      "> **Tip**: Expanded",
    );
    expect(convertCalloutsForPandoc("> [!tip]- Collapsed")).toBe(
      "> **Tip**: Collapsed",
    );
  });
});

describe("§55 convertToggleForPandoc", () => {
  it("converts details/summary to blockquote", () => {
    const input =
      "<details><summary>Click me</summary>\n\nHidden content\n</details>";
    const result = convertToggleForPandoc(input);
    expect(result).toContain("> **\u25B6 Click me**");
    expect(result).toContain("> Hidden content");
  });

  it("handles toggle without body", () => {
    const input = "<details><summary>Empty</summary></details>";
    const result = convertToggleForPandoc(input);
    expect(result).toBe("> **\u25B6 Empty**");
  });
});

describe("§55 stripTocForPandoc", () => {
  it("removes [TOC] lines", () => {
    const input = "# Title\n\n[TOC]\n\n## Section";
    expect(stripTocForPandoc(input)).toBe("# Title\n\n## Section");
  });

  it("is case insensitive", () => {
    expect(stripTocForPandoc("[toc]\nContent")).toBe("\nContent");
  });
});

describe("§55 stripBlockRefsForPandoc", () => {
  it("removes block references", () => {
    expect(stripBlockRefsForPandoc("See ((file#^abc123))")).toBe("See ");
  });

  it("removes block IDs", () => {
    expect(stripBlockRefsForPandoc("Some text ^blockid")).toBe("Some text");
  });

  it("preserves normal text with carets", () => {
    expect(stripBlockRefsForPandoc("a^2 + b^2")).toBe("a^2 + b^2");
  });
});

describe("§55 convertHighlightForPandoc", () => {
  it("never rewrites `==` inside inline math", () => {
    expect(convertHighlightForPandoc("$a == b$ and $c == d$")).toBe(
      "$a == b$ and $c == d$",
    );
    expect(convertHighlightForPandoc("Use $x==y$ in $p==q$ here")).toBe(
      "Use $x==y$ in $p==q$ here",
    );
  });

  it("converts highlight to bold", () => {
    expect(convertHighlightForPandoc("This is ==important== text")).toBe(
      "This is **important** text",
    );
  });

  it("handles multiple highlights", () => {
    expect(convertHighlightForPandoc("==one== and ==two==")).toBe(
      "**one** and **two**",
    );
  });

  it("preserves highlight in code", () => {
    expect(convertHighlightForPandoc("`==code==`")).toBe("`==code==`");
  });
});

describe("§55 convertSubscriptForPandoc", () => {
  it("keeps pandoc's own `~x~` spelling and escapes inner spaces", () => {
    expect(convertSubscriptForPandoc("H~2~O")).toBe("H~2~O");
    expect(convertSubscriptForPandoc("~a b~")).toBe("~a\\ b~");
    // An escape the author already wrote is not doubled.
    expect(convertSubscriptForPandoc("~a\\ b~")).toBe("~a\\ b~");
  });

  it("does not touch strikethrough or a span that crosses a line", () => {
    expect(convertSubscriptForPandoc("~~deleted~~")).toBe("~~deleted~~");
    expect(convertSubscriptForPandoc("~a\nb~")).toBe("~a\nb~");
  });

  it("follows the editor's hugging rule: prose with two tildes is prose", () => {
    const prose = "AI가 ~90,000까지 올라가 ( ~1.05 GB cliff)다.";
    expect(convertSubscriptForPandoc(prose)).toBe(prose);
    expect(convertSubscriptForPandoc("see ~/x and ~/y")).toBe(
      "see ~/x and ~/y",
    );
  });

  it("never rewrites inline math, nor a span that would swallow a code span", () => {
    expect(convertSubscriptForPandoc("$a~b c~$")).toBe("$a~b c~$");
    expect(convertSuperscriptForPandoc("$a^2 + b^2 = c^2$")).toBe(
      "$a^2 + b^2 = c^2$",
    );
    expect(convertSubscriptForPandoc("~a `x y` b~")).toBe("~a `x y` b~");
    // Prices are prose to pandoc's math rule and stay editable.
    expect(convertSubscriptForPandoc("$5 and $6 ~a b~")).toBe(
      "$5 and $6 ~a\\ b~",
    );
    // A literal `\$` opens no math, so the mark after it is still a mark;
    // `\\$` is an escaped backslash and LIVE math; math may cross a line
    // break and its TeX is left alone.
    expect(convertSubscriptForPandoc("\\$x~a b~$y$")).toBe("\\$x~a\\ b~$y$");
    expect(convertSubscriptForPandoc("\\\\$a~b c~$")).toBe("\\\\$a~b c~$");
    expect(convertSubscriptForPandoc("$a~x y~\nb$")).toBe("$a~x y~\nb$");
  });

  it("never touches a path or a tag: the marks live in text, not in markup", () => {
    expect(
      convertSubscriptForPandoc('<img src="img/~draft file~.png" width="50%">'),
    ).toBe('<img src="img/~draft file~.png" width="50%">');
    expect(convertSubscriptForPandoc("![a](img/~x y~.png) ~b c~")).toBe(
      "![a](img/~x y~.png) ~b\\ c~",
    );
    // An escaped `<` is prose, and `<u~a` is no tag name: the mark converts.
    expect(convertSubscriptForPandoc("\\<u~a b~>")).toBe("\\<u~a\\ b~>");
  });

  it("protects a fence inside a blockquote or a list item", () => {
    expect(convertSubscriptForPandoc("> ```\n> ~a b~\n> ```\n")).toBe(
      "> ```\n> ~a b~\n> ```\n",
    );
    expect(convertSubscriptForPandoc("- x\n\n  ```\n  ~a b~\n  ```\n")).toBe(
      "- x\n\n  ```\n  ~a b~\n  ```\n",
    );
    // A `> ```` line inside a column-zero block does not close it …
    expect(convertSubscriptForPandoc("```\ncode\n> ```\n~a b~\n```\n")).toBe(
      "```\ncode\n> ```\n~a b~\n```\n",
    );
    // … a longer closer does, and an unclosed fence runs to the end.
    expect(convertSubscriptForPandoc("```\n~a b~\n````\n~c d~\n")).toBe(
      "```\n~a b~\n````\n~c\\ d~\n",
    );
    expect(convertSubscriptForPandoc("```\n~a b~\n")).toBe("```\n~a b~\n");
  });

  it("preserves subscript in code", () => {
    expect(convertSubscriptForPandoc("`~sub~`")).toBe("`~sub~`");
  });
});

describe("§55 convertSuperscriptForPandoc", () => {
  it("keeps pandoc's own `^x^` spelling, `n` included, and escapes inner spaces", () => {
    expect(convertSuperscriptForPandoc("x^2^")).toBe("x^2^");
    // The old character class excluded the letter `n` by accident.
    // A span with `n` AND a space shows the conversion actually ran.
    expect(convertSuperscriptForPandoc("x^n m^")).toBe("x^n\\ m^");
    expect(convertSuperscriptForPandoc("x^a b^")).toBe("x^a\\ b^");
    expect(convertSubscriptForPandoc("a~b\tc~")).toBe("a~b\\ c~");
  });

  it("does not match across lines, inside footnote refs, or with spaces at the edges", () => {
    expect(convertSuperscriptForPandoc("x^a\nb^")).toBe("x^a\nb^");
    expect(convertSuperscriptForPandoc("see[^1] and [^2]")).toBe(
      "see[^1] and [^2]",
    );
    expect(convertSuperscriptForPandoc("^ up or ^ down")).toBe(
      "^ up or ^ down",
    );
  });

  it("preserves superscript in code", () => {
    expect(convertSuperscriptForPandoc("`x^2^`")).toBe("`x^2^`");
  });
});

describe("§55 convertUnderlineForPandoc", () => {
  it("turns the serializer's <u> tags into pandoc's underline span", () => {
    expect(convertUnderlineForPandoc("a <u>under line</u> b")).toBe(
      "a [under line]{.underline} b",
    );
    expect(convertUnderlineForPandoc("<u>**bold** and _em_</u>")).toBe(
      "[**bold** and _em_]{.underline}",
    );
  });

  it("leaves code and unmatched tags alone", () => {
    expect(convertUnderlineForPandoc("`<u>x</u>`")).toBe("`<u>x</u>`");
    expect(convertUnderlineForPandoc("<u>open only")).toBe("<u>open only");
  });

  it("keeps a link inside, escapes brackets that do not pair, spans a soft break, allows <", () => {
    expect(convertUnderlineForPandoc("<u>see [x](y)</u>")).toBe(
      "[see [x](y)]{.underline}",
    );
    // A lone `]` would close the span early and leave `{.underline}` visible.
    expect(convertUnderlineForPandoc("<u>a]b</u>")).toBe("[a\\]b]{.underline}");
    expect(convertUnderlineForPandoc("<u>[a</u>")).toBe("[\\[a]{.underline}");
    // Parity: `\\]` is an escaped backslash and a LIVE bracket — it gets its
    // own escape; `\]` is already escaped and is left alone.
    expect(convertUnderlineForPandoc("<u>a\\\\]b</u>")).toBe(
      "[a\\\\\\]b]{.underline}",
    );
    expect(convertUnderlineForPandoc("<u>a\\]b</u>")).toBe(
      "[a\\]b]{.underline}",
    );
    expect(convertUnderlineForPandoc("<u>a < b<br>c\nd</u>")).toBe(
      "[a < b<br>c\nd]{.underline}",
    );
    // A blank line ends the paragraph; the tags stay (and the filter drops them).
    expect(convertUnderlineForPandoc("<u>a\n\nb</u>")).toBe("<u>a\n\nb</u>");
    // Math inside an underline is no reason to lose the underline.
    expect(convertUnderlineForPandoc("<u>see $E=mc^2$ here</u>")).toBe(
      "[see $E=mc^2$ here]{.underline}",
    );
    // Only the bracket without a partner is escaped; the link keeps its own.
    expect(
      convertUnderlineForPandoc("<u>[link](https://example.com) a]b</u>"),
    ).toBe("[[link](https://example.com) a\\]b]{.underline}");
  });
});

describe("§55 convertForPandoc (orchestrator)", () => {
  it("applies all conversions", () => {
    const input = [
      "# Document",
      "",
      "[TOC]",
      "",
      "> [!note] Important",
      "> Read this",
      "",
      "Link: [[MyPage]]",
      "",
      "==highlighted== and H~2~O and x^2^ and <u>under</u>",
      "",
      "Ref: ((doc#^abc))",
      "",
      "Some text ^blockid",
    ].join("\n");

    const result = convertForPandoc(input);

    // TOC removed
    expect(result).not.toContain("[TOC]");
    // Callout converted
    expect(result).toContain("> **Note**: Important");
    // Wikilink converted
    expect(result).toContain("[MyPage](MyPage.md)");
    // Highlight → bold
    expect(result).toContain("**highlighted**");
    // Subscript and superscript stay in pandoc's own spelling — never HTML,
    // which the export's policy filter would drop.
    expect(result).toContain("H~2~O and x^2^");
    expect(result).not.toContain("<sub>");
    // Underline → pandoc's span; the raw `<u>` would be dropped by the filter.
    expect(result).toContain("[under]{.underline}");
    // Block refs removed
    expect(result).not.toContain("((doc#^abc))");
    expect(result).not.toContain("^blockid");
  });

  it("preserves definition lists (Pandoc native)", () => {
    const input = "Term\n: Definition text";
    expect(convertForPandoc(input)).toBe(input);
  });

  it("preserves footnotes (Pandoc native)", () => {
    const input = "Text[^1]\n\n[^1]: Footnote content";
    expect(convertForPandoc(input)).toBe(input);
  });

  it("preserves math (Pandoc native)", () => {
    const input = "Inline $E=mc^2$ and block:\n\n$$\nx = \\frac{-b}{2a}\n$$";
    expect(convertForPandoc(input)).toBe(input);
  });

  it("preserves code blocks entirely", () => {
    const input = [
      "```python",
      "# [[wikilink]] in code",
      "x = ==highlight==",
      "```",
    ].join("\n");
    expect(convertForPandoc(input)).toBe(input);
  });
});

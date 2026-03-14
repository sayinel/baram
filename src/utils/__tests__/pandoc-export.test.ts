// §55 Pandoc Extended Export — convertForPandoc() preprocessing tests
import { describe, expect, it } from "vitest";

import {
  convertCalloutsForPandoc,
  convertForPandoc,
  convertHighlightForPandoc,
  convertSubscriptForPandoc,
  convertSuperscriptForPandoc,
  convertToggleForPandoc,
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
  it("converts subscript to <sub> tag", () => {
    expect(convertSubscriptForPandoc("H~2~O")).toBe("H<sub>2</sub>O");
  });

  it("does not touch strikethrough", () => {
    expect(convertSubscriptForPandoc("~~deleted~~")).toBe("~~deleted~~");
  });

  it("preserves subscript in code", () => {
    expect(convertSubscriptForPandoc("`~sub~`")).toBe("`~sub~`");
  });
});

describe("§55 convertSuperscriptForPandoc", () => {
  it("converts superscript to <sup> tag", () => {
    expect(convertSuperscriptForPandoc("x^2^")).toBe("x<sup>2</sup>");
  });

  it("preserves superscript in code", () => {
    expect(convertSuperscriptForPandoc("`x^2^`")).toBe("`x^2^`");
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
      "==highlighted== and H~2~O and x^2^",
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
    // Subscript → <sub>
    expect(result).toContain("<sub>2</sub>");
    // Superscript → <sup>
    expect(result).toContain("<sup>2</sup>");
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

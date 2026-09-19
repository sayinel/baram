// issue 636 — the regions the export converters must not rewrite, and the
// pairing of a converter's delimiters across them.
import { describe, expect, it } from "vitest";

import {
  collectCodeRegions,
  inlineMathSpans,
  inlineSpans,
  replaceOutsideCode,
  splitLines,
} from "../markdown-code-regions";

const spansOf = (md: string, mathCrossesLines = true) =>
  inlineSpans(md, splitLines(md), { mathCrossesLines, skip: [] }).map(
    ({ end, kind, n, start }) => [kind, n, md.slice(start, end)],
  );

describe("splitLines", () => {
  it("breaks on \\n, \\r\\n and a lone \\r, keeping every offset", () => {
    const md = "a\nb\r\nc\rd";
    expect(splitLines(md)).toEqual([
      { end: 1, next: 2, start: 0 },
      { end: 3, next: 5, start: 2 },
      { end: 6, next: 7, start: 5 },
      { end: 8, next: 8, start: 7 },
    ]);
    // A final break leaves an empty last line, as `split("\n")` did.
    expect(splitLines("a\n").at(-1)).toEqual({ end: 2, next: 2, start: 2 });
  });
});

describe("inlineSpans — code spans and formulas as the editor pairs them", () => {
  it("lets whichever opened first own the other's delimiters", () => {
    expect(spansOf("$a `x$y` b$")).toEqual([["math", 1, "$a `x$"]]);
    expect(spansOf("`a $b$ c` d $e$")).toEqual([
      ["code", 1, "`a $b$ c`"],
      ["math", 1, "$e$"],
    ]);
  });

  it("closes a run with the next run of exactly the same length", () => {
    expect(spansOf("$a $$ b$ c")).toEqual([["math", 1, "$a $$ b$"]]);
    expect(spansOf("``a`b`` c")).toEqual([["code", 2, "``a`b``"]]);
    expect(spansOf("$$$x$$$ and $$y$$")).toEqual([
      ["math", 3, "$$$x$$$"],
      ["math", 2, "$$y$$"],
    ]);
  });

  it("reads a backslash before an opener only", () => {
    expect(spansOf("\\$$x$")).toEqual([["math", 1, "$x$"]]);
    expect(spansOf("$x\\$")).toEqual([["math", 1, "$x\\$"]]);
    expect(spansOf("\\`a`")).toEqual([]);
    expect(spansOf("`a\\`b`")).toEqual([["code", 1, "`a\\`"]]);
  });

  it("stops at a blank line — of spaces, CRLF or a lone CR — and a formula at its line when asked", () => {
    expect(spansOf("$a\nb$")).toEqual([["math", 1, "$a\nb$"]]);
    expect(spansOf("$a\nb$", false)).toEqual([]);
    expect(spansOf("$a\n \t\nb$")).toEqual([]);
    expect(spansOf("$a\r\n\r\nb$")).toEqual([]);
    expect(spansOf("$a\r\rb$")).toEqual([]);
    expect(spansOf("> $a\n>\n> b$")).toEqual([]);
    expect(spansOf("> $a\n> b$")).toEqual([["math", 1, "$a\n> b$"]]);
    expect(spansOf("`a\r\nb`")).toEqual([["code", 1, "`a\r\nb`"]]);
  });

  it("goes on behind a run nothing closes", () => {
    expect(spansOf("`unclosed $x$")).toEqual([["math", 1, "$x$"]]);
    expect(spansOf("$a $b$")).toEqual([["math", 1, "$a $"]]);
  });

  it("honours a skip region only while nothing is open", () => {
    const md = "`a $$` ==x== $$ and `b`";
    const skip = [{ end: 6, start: 3 }]; // the `$$` inside the code span
    const lines = splitLines(md);
    expect(
      inlineSpans(md, lines, { mathCrossesLines: true, skip }).map((s) => [
        s.kind,
        md.slice(s.start, s.end),
      ]),
    ).toEqual([
      ["code", "`a $$`"],
      ["code", "`b`"],
    ]);
    const honoured = [{ end: 4, start: 1 }]; // `a b` — a region before any run
    expect(
      inlineSpans("xa bx `c`", splitLines("xa bx `c`"), {
        mathCrossesLines: true,
        skip: honoured,
      }).map((s) => s.kind),
    ).toEqual(["skip", "code"]);
  });
});

describe("inlineMathSpans", () => {
  it("returns the one-dollar formulas of a line, fences and display math stepped over", () => {
    const md = "$a$ `$b$` $$c$$\n```\n$d$\n```\n$$\n$e$\n$$\n$f$";
    expect(
      inlineMathSpans(md).map(({ end, start }) => md.slice(start, end)),
    ).toEqual(["$a$", "$f$"]);
  });
});

describe("collectCodeRegions", () => {
  it("merges fences, display math, code spans and — on request — one-dollar formulas and markup", () => {
    const md = "`a\nb` $c\nd$ x";
    expect(collectCodeRegions(md)).toEqual([{ end: 5, start: 0 }]);
    expect(collectCodeRegions(md, { inlineMath: true })).toEqual([
      { end: 5, start: 0 },
      { end: 11, start: 6 },
    ]);
    const url = "[x](u/$) ~a b~c$";
    // The destination region starts at the `]` the pattern anchors on.
    expect(collectCodeRegions(url, { inlineMath: true, markup: true })).toEqual(
      [{ end: 8, start: 2 }],
    );
  });

  it("closes a fence on a CRLF or lone-CR line, and an unclosed display block runs to the end", () => {
    expect(collectCodeRegions("```\r\nx\r\n```\r\ny")).toEqual([
      { end: 11, start: 0 },
    ]);
    expect(collectCodeRegions("```\rx\r```\ry")).toEqual([
      { end: 9, start: 0 },
    ]);
    expect(collectCodeRegions("$$\nx\n\ny")).toEqual([{ end: 7, start: 0 }]);
    expect(collectCodeRegions("$$$\nx\n$$\ny\n$$$\nz")).toEqual([
      { end: 14, start: 0 },
    ]);
    // A block opened on a list item's line, closed by a longer run; a
    // blockquoted one; and `$$x$$` on a line is inline, not a block.
    expect(collectCodeRegions("- $$\n  ==x==\n  $$$\ny")).toEqual([
      { end: 18, start: 0 },
    ]);
    expect(collectCodeRegions("> $$\n> x\n> $$\ny")).toEqual([
      { end: 13, start: 0 },
    ]);
    expect(collectCodeRegions("$$x$$ y")).toEqual([{ end: 5, start: 0 }]);
    // A `$$` line with anything after the run is no block opener; the run
    // pairs inline, across a line break, like any two-dollar run.
    expect(collectCodeRegions("$$ meta\n==x==\n$$\n==y==")).toEqual([
      { end: 16, start: 0 },
    ]);
    // Two-dollar runs on either side of a blank line pair with nothing —
    // a paragraph ends there — and a `$$` inside a code span is code.
    expect(collectCodeRegions("$$_{a\n\nb}$$ x")).toEqual([]);
    expect(collectCodeRegions("`$$` x $$")).toEqual([{ end: 4, start: 0 }]);
  });
});

describe("replaceOutsideCode", () => {
  it("hands the replacer the original text of the match and its groups, an absent group as undefined", () => {
    const seen: unknown[][] = [];
    const out = replaceOutsideCode(
      "==a `x==y` b== and ==c==",
      /==((?:(?!==).)+)==/g,
      (match, inner) => {
        seen.push([match, inner]);
        return `**${inner}**`;
      },
      { guard: "delimiters" },
    );
    expect(out).toBe("**a `x==y` b** and **c**");
    expect(seen).toEqual([
      ["==a `x==y` b==", "a `x==y` b"],
      ["==c==", "c"],
    ]);
    expect(
      replaceOutsideCode(
        "a `b` c",
        /(a)(z)?( )/g,
        (_m, g1, g2, g3) => `[${g1}|${String(g2)}|${g3}]`,
      ),
    ).toBe("[a|undefined| ]`b` c");
  });

  it("consumes a refused span match instead of offering its closer to the next opener", () => {
    expect(
      replaceOutsideCode(
        "~a `x~y` b~ and ~c d~",
        /(?<!~)~(?!~)([^~]+)(?<!~)~(?!~)/g,
        (_m, inner) => `_{${inner}}`,
      ),
    ).toBe("~a `x~y` b~ and _{c d}");
  });

  it("lets the pattern decide whether it crosses a line, and a multi-line code span leaks no delimiter", () => {
    expect(
      replaceOutsideCode(
        "[[a\nb]] `c\n==d` e ==f==",
        /==([^=]+)==/g,
        (_m, x) => `<${x}>`,
        {
          guard: "delimiters",
        },
      ),
    ).toBe("[[a\nb]] `c\n==d` e <f>");
    expect(
      replaceOutsideCode("[[a\nb]]", /\[\[([^\]]+)\]\]/g, () => "LINK"),
    ).toBe("LINK");
    expect(
      replaceOutsideCode(
        "A~b\nc~D",
        /(?<!~)~(?!~)([^~]+)(?<!~)~(?!~)/g,
        (_m, x) => `_{${x}}`,
      ),
    ).toBe("A_{b\nc}D");
  });

  it("steps over an empty match and counts code units", () => {
    expect(replaceOutsideCode("ab", /x*/g, () => "-")).toBe("ab");
    expect(
      replaceOutsideCode(
        "==a `😀==` b== ==c==",
        /==((?:(?!==).)+)==/g,
        (_m, x) => `**${x}**`,
        {
          guard: "delimiters",
        },
      ),
    ).toBe("**a `😀==` b** **c**");
  });

  it("stays linear on runs nothing closes and on many refused matches", () => {
    let text = "";
    for (let k = 1; k <= 300; k++)
      text += `\`${"`".repeat(k % 7)}a${"$".repeat(k % 5)}`;
    text = `${text}\n`.repeat(30) + "==z==";
    const pairs = `${"~a `x~y` b~ ".repeat(3000)}==z==`;
    const started = performance.now();
    expect(
      replaceOutsideCode(text, /==(z)==/g, () => "Z", { inlineMath: true }),
    ).toContain("Z");
    expect(
      replaceOutsideCode(pairs, /(?<!~)~(?!~)([^~]+)(?<!~)~(?!~)/g, () => "S"),
    ).toContain("==z==");
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

// issue 631 — the raw regions a text opens and closes, and the document's
// closer index that decides whether an opener nothing closes is real.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closerIndex,
  type CloserOracle,
  rawRegions,
} from "../export-raw-regions";

describe("rawRegions — the region a text opens and does not close", () => {
  const openedBy = (value: string): null | RegExp =>
    rawRegions(value).open?.until ?? null;

  it("names the closer of a comment or verbatim element the text opens and does not close", () => {
    expect(openedBy("<script>")?.test("</script>")).toBe(true);
    expect(openedBy("<script>")?.test("</scripture>")).toBe(false);
    expect(openedBy("<pre>x</pre><style>")?.test("</STYLE >")).toBe(true);
    expect(openedBy("<div>\n<!--")?.test("-->")).toBe(true);
    expect(openedBy("<div>\n<!--")?.test("--!>")).toBe(true);
    // Closed within the text, or closed at once: nothing carries over.
    expect(openedBy("<!-- x --> <img>")).toBeNull();
    expect(openedBy("<!--> x")).toBeNull();
    expect(openedBy("<script>a</script><img>")).toBeNull();
    expect(openedBy("<div>plain</div>")).toBeNull();
  });

  it("reads openers by the tag grammar: one inside an attribute value opens nothing, a raw TeX environment does", () => {
    expect(openedBy('<div title="<script>">[x')).toBeNull();
    expect(openedBy('<div title="<!--">[x')).toBeNull();
    expect(openedBy('<div title="\\begin{figure}">[x')).toBeNull();
    // pandoc's raw TeX: an environment runs to its own `\end`, blank lines
    // and html nodes included.
    expect(openedBy("\\begin{verbatim}")?.test("\\end{verbatim}")).toBe(true);
    expect(openedBy("\\begin{verbatim}")?.test("\\end{figure}")).toBe(false);
    expect(openedBy("\\begin{figure*} x")?.test("\\end{figure*}")).toBe(true);
    expect(openedBy("\\begin{a}\\end{a} tail")).toBeNull();
    expect(openedBy("\\begin{a}\\end{b}")?.test("\\end{a}")).toBe(true);
  });

  describe("with the document's oracle", () => {
    afterEach(() => vi.restoreAllMocks());
    const oracle = (over: Partial<CloserOracle>): CloserOracle => ({
      afterNode: () => true,
      anyFrom: () => true,
      ...over,
    });

    it("skips an opener the document never closes and finds the real one behind it", () => {
      const value = "x \\begin{missing} y \\begin{verbatim} z";
      const regions = rawRegions(
        value,
        oracle({ anyFrom: (key) => key !== "tex:missing" }),
      );
      expect(regions.open?.at).toBe(value.indexOf("\\begin{verbatim}"));
      expect(regions.open?.until.test("\\end{verbatim}")).toBe(true);
    });

    it("opens nothing when the closer is neither in the text nor after the node, and indexes the text's closers once", () => {
      const value =
        "\\begin{a} \\begin{a} \\begin{a} <!-- <!-- <script> <script>";
      const exec = vi.spyOn(RegExp.prototype, "exec");
      const regions = rawRegions(value, oracle({ afterNode: () => false }));
      expect(regions.open).toBeNull();
      const sources = exec.mock.instances.map((re) => (re as RegExp).source);
      // No search for one opener's closer; the text's closers are read once
      // per pattern (TeX ends, tag and comment ends), over the whole text.
      expect(
        sources.filter(
          (src) =>
            src === "\\\\end\\{a\\}" ||
            src === "--!?>" ||
            src.includes("script(?="),
        ),
      ).toHaveLength(0);
      expect(
        exec.mock.calls.filter(
          ([text], k) =>
            text === value &&
            (sources[k].startsWith("\\\\end\\{(") ||
              // `RegExp.source` escapes the slash.
              sources[k].startsWith("<\\/(")),
        ),
      ).toHaveLength(2);
    });

    it("takes an opener as real when the document holds its closer after the node", () => {
      const regions = rawRegions("<pre>", oracle({}));
      expect(regions.open?.until.test("</PRE>")).toBe(true);
    });

    it("reads the closers of the text once, never with a search per opener", () => {
      // A closer that stands BEFORE its opener passes the document's question
      // (a closer exists at or after the node), and a search per opener then
      // scanned to the end of the text for each — a thousand distinct names,
      // a thousand scans (3.5 s at 874 KB). Pinned by count: no search for a
      // name is run at all.
      const names = Array.from({ length: 400 }, (_, k) => `e${k}`);
      const value = `${names.map((e) => `\\end{${e}}`).join(" ")} ${names
        .map((e) => `\\begin{${e}}`)
        .join(" ")}`;
      const exec = vi.spyOn(RegExp.prototype, "exec");
      const regions = rawRegions(value, oracle({ afterNode: () => false }));
      expect(regions).toEqual({ closed: [], open: null });
      const perName = exec.mock.instances.filter((re) =>
        /^\\\\end\\\{e\d+\\\}$/.test((re as RegExp).source),
      );
      expect(perName).toHaveLength(0);
    });
  });

  it("takes an escaped opener as text: an odd run of backslashes before `<` or `\\begin{`", () => {
    // pandoc reads `\<script>` as the characters `<script>`, and `\\begin{x}`
    // as a backslash followed by the word `begin{x}`; an even run escapes
    // only itself, and the opener behind it is real.
    expect(openedBy("\\<script>")).toBeNull();
    expect(openedBy("\\<!-- x")).toBeNull();
    expect(openedBy("\\\\begin{verbatim}")).toBeNull();
    expect(openedBy("\\\\<script>")?.test("</script>")).toBe(true);
    expect(openedBy("\\\\\\begin{verbatim}")?.test("\\end{verbatim}")).toBe(
      true,
    );
  });

  it("reads an opener inside a raw TeX command's arguments as text", () => {
    // pandoc 3.11: a raw TeX command with every `{…}` and `[…]` group after
    // it, blanks and line breaks between them allowed, is one raw TeX
    // inline; an opener inside opens nothing. Braces nest, an escaped
    // backslash makes the command text, an argument nothing closes is
    // text, and a group holding `\begin{` is no argument — pandoc reads
    // the command as text then, and the environment opens.
    expect(openedBy("\\texttt{<script>}")).toBeNull();
    expect(openedBy("\\texttt{a{<script>}b}")).toBeNull();
    expect(openedBy("\\href{http://x}{<script>}")).toBeNull();
    expect(openedBy("\\multicolumn{1}{c}{<script>}")).toBeNull();
    expect(openedBy("\\href{u} {<script>}")).toBeNull();
    expect(openedBy("\\href{u}\n{<script>}")).toBeNull();
    expect(openedBy("\\texttt {<script>}")).toBeNull();
    expect(openedBy("\\foo[<script>]{x}")).toBeNull();
    expect(openedBy("\\includegraphics[width=1]{<script>}")).toBeNull();
    expect(openedBy("\\foo[a] [b] {<script>}")).toBeNull();
    expect(openedBy("\\foo[a]\n{<script>}")).toBeNull();
    // A bracket group skips the braced groups inside it, and an escaped
    // delimiter is text — pandoc's TeX reader reads both so.
    expect(openedBy("\\foo[{x]}]{<script>}")).toBeNull();
    expect(openedBy("\\foo[a\\]<script>]{x}")).toBeNull();
    expect(openedBy("\\texttt{a\\}<script>}")).toBeNull();
    // An escaped `\begin{` in the argument is text, and the argument holds.
    expect(openedBy("\\texttt{\\\\begin{verbatim}<script>}")).toBeNull();
    // A bracket group after a brace group is no argument: pandoc reads
    // `\foo{x}` and then markdown.
    expect(openedBy("\\foo{x}[<script>]")?.test("</script>")).toBe(true);
    expect(openedBy("\\foo{x} [<script>]")?.test("</script>")).toBe(true);
    expect(rawRegions("\\foo{x}[<script>]").closed).toEqual([
      { end: 7, start: 0 },
    ]);
    expect(
      openedBy("\\texttt{\\begin{verbatim}}")?.test("\\end{verbatim}"),
    ).toBe(true);
    expect(
      openedBy("\\texttt{<script>\\begin{verbatim}}")?.test("</script>"),
    ).toBe(true);
    expect(openedBy("\\texttt{x} <script>")?.test("</script>")).toBe(true);
    expect(openedBy("\\\\texttt{<script>}")?.test("</script>")).toBe(true);
    expect(openedBy("\\texttt{<script>")?.test("</script>")).toBe(true);
    // The arguments are a closed span, so `mayHoldImage` reads no image in
    // a comment inside them.
    expect(rawRegions("\\texttt{<!-- <img src=a.png> -->}").closed).toEqual([
      { end: 33, start: 0 },
    ]);
  });

  it("matches the braces of a text once, so commands nothing closes do not each scan to the end", () => {
    // Ten thousand `\word{` with no `}`: each used to scan from its brace
    // to the end of the text before the scan advanced one character. The
    // pairs are matched in one pass now; the opener behind them is read.
    const value = `${"\\word{".repeat(10_000)}\\begin{x} <script>`;
    expect(openedBy(value)?.test("\\end{x}")).toBe(true);
    // And a closed argument after many open ones is still one argument.
    expect(openedBy(`${"\\a{".repeat(50)}\\b{<script>} </script>`)).toBeNull();
  });

  it("reads thousands of closed or bracket-only commands without a search per command", () => {
    // Every command used to search the rest of the text for a `\begin{`,
    // and every `\word[` for its `]`: ten thousand of either, ten thousand
    // scans to the end. The groups are matched in one pass and the scan's
    // own next `\begin{` is reused, pinned by the searches run.
    const indexOf = vi.spyOn(String.prototype, "indexOf");
    try {
      expect(
        openedBy(`${"\\word{x} ".repeat(10_000)}<script>`)?.test("</script>"),
      ).toBe(true);
      expect(
        openedBy(`${"\\word[".repeat(10_000)}<script>`)?.test("</script>"),
      ).toBe(true);
      expect(indexOf.mock.calls.length).toBeLessThan(20);
    } finally {
      indexOf.mockRestore();
    }
  });
});

describe("closerIndex", () => {
  it("files every closer of the document under the key an opener asks for", () => {
    const source =
      "\\end{A} \\end{a} </PRE> </scriptx> </pre/> --> --!> <!-- </textarea\t>";
    const index = closerIndex(source);
    const at = (text: string): number => source.indexOf(text);
    expect([...index.keys()].sort()).toEqual([
      "comment",
      "tag:pre",
      "tag:textarea",
      "tex:A",
      "tex:a",
    ]);
    // TeX names are exact; tag names fold to lower case; `</scriptx>` is
    // no closer of `script`; a self-closing spelling and a tab count.
    expect(index.get("tex:A")).toEqual([at("\\end{A}")]);
    expect(index.get("tex:a")).toEqual([at("\\end{a}")]);
    expect(index.get("tag:pre")).toEqual([at("</PRE>"), at("</pre/>")]);
    expect(index.get("tag:textarea")).toEqual([at("</textarea")]);
    expect(index.get("comment")).toEqual([at("-->"), at("--!>")]);
    expect(index.has("tag:script")).toBe(false);
  });

  it("is empty for a document without closers", () => {
    expect(closerIndex("plain <script> \\begin{x} <!--").size).toBe(0);
  });
});

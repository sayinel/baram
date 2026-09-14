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

    it("opens nothing when the closer is neither in the text nor after the node, and asks the text once per key", () => {
      const exec = vi.spyOn(RegExp.prototype, "exec");
      const regions = rawRegions(
        "\\begin{a} \\begin{a} \\begin{a} <!-- <!-- <script> <script>",
        oracle({ afterNode: () => false }),
      );
      expect(regions.open).toBeNull();
      const searches = exec.mock.instances
        .map((re) => (re as RegExp).source)
        .filter(
          (src) =>
            src === "\\\\end\\{a\\}" ||
            src === "--!?>" ||
            src.includes("script(?="),
        );
      expect(searches).toHaveLength(3);
    });

    it("takes an opener as real when the document holds its closer after the node", () => {
      const regions = rawRegions("<pre>", oracle({}));
      expect(regions.open?.until.test("</PRE>")).toBe(true);
    });
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

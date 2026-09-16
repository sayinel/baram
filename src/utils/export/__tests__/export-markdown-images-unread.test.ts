// issue 631 — the html nodes the image policy does not read, and what it
// says about them: a node outside the supported grammar or inside a raw
// region an earlier node opened stays exactly as written, and is counted —
// once, and only when it may hold an image — apart from the images refused.
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseMdast } from "../../../pipeline/parse-mdast";
import { stageMarkdownImages } from "../export-markdown-images";
import { SAVED } from "./helpers/image-policy-fixtures";

describe("stageMarkdownImages on html nodes it does not read", () => {
  it("leaves a block it cannot read whole and counts it, apart from the images it refused", () => {
    // pandoc keeps parsing markdown inside an HTML block, so a tag inside
    // the fence or the code span is code to it; the third tag would be an
    // image, but the policy does not pick and choose inside a block it
    // cannot read (export-html-fragment.ts): the block stays as written.
    const md =
      '<details>\n<summary>s</summary>\n```html\n<img src="img/a.png">\n```\n`<img src=\'img/b.png\'>` and <img src=\'img/c.png\'>\n</details>\n\n<img src="/etc/hosts" alt="hosts">\n';
    const tree = parseMdast(md);
    expect(tree.children.map((n) => n.type)).toEqual(["html", "html"]);
    expect(stageMarkdownImages(md, SAVED)).toEqual({
      images: [],
      markdown:
        "<details>\n<summary>s</summary>\n```html\n<img src=\"img/a.png\">\n```\n`<img src='img/b.png'>` and <img src='img/c.png'>\n</details>\n\nhosts\n",
      noSource: 0,
      overCap: 0,
      refused: 1,
      scoped: true,
      unsupportedHtml: 1,
    });
  });

  it("counts an unread block only when it may hold an image, a markdown image included", () => {
    expect(
      stageMarkdownImages("<script>var s = 1;</script>\n", SAVED),
    ).toMatchObject({ refused: 0, unsupportedHtml: 0 });
    // A markdown image inside an HTML block is pandoc's to read, not the
    // parser's: it cannot be staged, so the block is reported instead.
    const md = '<div>\n<img src="img/a.png">\n![b](img/b.png)\n</div>\n';
    expect(stageMarkdownImages(md, SAVED)).toEqual({
      images: [],
      markdown: md,
      noSource: 0,
      overCap: 0,
      refused: 0,
      unsupportedHtml: 1,
      scoped: true,
    });
  });

  it("counts an unread block once, however many rounds the document takes", () => {
    const md = '![k](img/k.png)\n\n<div>\n$x$ <img src="img/a.png">\n</div>\n';
    expect(stageMarkdownImages(md, SAVED)).toEqual({
      images: [{ name: "image-0.png", source: "img/k.png" }],
      markdown:
        '![k](baram-asset:image-0.png)\n\n<div>\n$x$ <img src="img/a.png">\n</div>\n',
      unsupportedHtml: 1,
      noSource: 0,
      overCap: 0,
      refused: 0,
      scoped: true,
    });
  });

  it("does not report a wrapped image it embedded: the rewritten node is unreadable in the next round, and that is not news", () => {
    // Round 0 reads `<div><img></div>` and rewrites it; round 1 sees
    // `<div>![](…)</div>`, a bracket the grammar refuses, and must stay quiet.
    expect(
      stageMarkdownImages('<div><img src="img/a.png"></div>\n', SAVED),
    ).toEqual({
      images: [{ name: "image-0.png", source: "img/a.png" }],
      markdown: "<div>![](baram-asset:image-0.png)</div>\n",
      noSource: 0,
      overCap: 0,
      refused: 0,
      scoped: true,
      unsupportedHtml: 0,
    });
  });

  it("does not count an unread block whose only tags are code samples, comments or verbatim bodies", () => {
    for (const md of [
      '<div>\n~~~html\n<img src="example.png">\n~~~\n</div>\n',
      "<script>let x=\"</scripture><img src='img/e.png'>\";</script>\n",
    ]) {
      expect(stageMarkdownImages(md, SAVED), md).toEqual({
        images: [],
        markdown: md,
        noSource: 0,
        overCap: 0,
        refused: 0,
        unsupportedHtml: 0,
        scoped: true,
      });
    }
  });

  it("opens no region for an opener pandoc never closes, and reports the node that holds one", () => {
    // pandoc 3.11 reads `\begin{itemize}` without its `\end` as text, and a
    // `<script>` or `<!--` without its closer as the tag alone, and shows the
    // images after them: no region carries into the nodes that follow.
    expect(
      stageMarkdownImages(
        "text \\begin{itemize} more\n\n<img src='img/a.png'>\n",
        SAVED,
      ),
    ).toEqual({
      images: [{ name: "image-0.png", source: "img/a.png" }],
      markdown: "text \\begin{itemize} more\n\n![](baram-asset:image-0.png)\n",
      noSource: 0,
      overCap: 0,
      refused: 0,
      scoped: true,
      unsupportedHtml: 0,
    });
    expect(
      stageMarkdownImages("x <script> y\n\n<img src='img/b.png'>\n", SAVED),
    ).toEqual({
      images: [{ name: "image-0.png", source: "img/b.png" }],
      markdown: "x <script> y\n\n![](baram-asset:image-0.png)\n",
      noSource: 0,
      overCap: 0,
      refused: 0,
      scoped: true,
      unsupportedHtml: 0,
    });
    // The parser makes one block of an unclosed `<script>` or `<!--` and of
    // all that follows it; the policy cannot read that block, and used to
    // take the opener for a region that swallowed the images silently. They
    // may well be missing — pandoc drops the raw tags — so the block is
    // counted, like any other block the policy could not read.
    for (const md of [
      "<script>\n\n<img src='img/a.png'>\n\n<img src='img/b.png'>\n",
      "<!-- note\n\n<img src='img/c.png'>\n",
      "<div>\n<!-- x <img src='img/c.png'>\n</div>\n",
    ]) {
      expect(stageMarkdownImages(md, SAVED), md).toEqual({
        images: [],
        markdown: md,
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 1,
      });
    }
  });

  it("does not let a false opener hide the real one behind it in the same text", () => {
    // pandoc 3.11: `\begin{missing}` is text, `\begin{verbatim}` opens the
    // environment that holds the first tag, the second tag is an image.
    // The scan used to stop at the first unclosed opener; when the
    // lookahead rejected it, the real opener after it was never seen and
    // the tag inside the environment was staged — a file pandoc never reads.
    const md =
      "prefix \\begin{missing} then \\begin{verbatim}\n\n<img src='img/a.png'>\n\n\\end{verbatim}\n\n<img src='img/b.png'>\n";
    expect(stageMarkdownImages(md, SAVED)).toEqual({
      images: [{ name: "image-0.png", source: "img/b.png" }],
      markdown:
        "prefix \\begin{missing} then \\begin{verbatim}\n\n<img src='img/a.png'>\n\n\\end{verbatim}\n\n![](baram-asset:image-0.png)\n",
      noSource: 0,
      overCap: 0,
      refused: 0,
      scoped: true,
      unsupportedHtml: 0,
    });
    // The same with an unclosed comment before the environment, in one
    // paragraph: pandoc reads `<!--` as text too.
    expect(
      stageMarkdownImages(
        "x <!-- y \\begin{verbatim}\n\n<img src='img/a.png'>\n\n\\end{verbatim}\n\n<img src='img/b.png'>\n",
        SAVED,
      ),
    ).toMatchObject({
      images: [{ name: "image-0.png", source: "img/b.png" }],
      unsupportedHtml: 0,
    });
  });

  it("keeps a region real inside a container whose prefix ends in a tab, however long the node grows", () => {
    // micromark expands a tab that ends a container prefix into spaces, so
    // a node's text is LONGER than its source span — two columns per such
    // line. A lookahead that added a text offset to the node's source start
    // asked past the real `</script>` once the drift outgrew the distance to
    // it, rejected the opener, and staged the tag inside the script body.
    for (const n of [10, 36, 80]) {
      const body = Array.from({ length: n }, () => "\t<a>").join("\n");
      const md = `- <div>\n${body}\n\t<script>\n\n\t<img src="secret.png">\n\n\t</script>\n`;
      const tabs = stageMarkdownImages(md, SAVED);
      const spaces = stageMarkdownImages(md.replaceAll("\t", "  "), SAVED);
      expect(tabs.images, `tabs n=${n}`).toEqual([]);
      expect(tabs.markdown).toBe(md);
      expect(spaces.images, `spaces n=${n}`).toEqual([]);
    }
  });

  it("reports a braced inline node by the same rule as any other: a false opener hides nothing", () => {
    // A processing instruction holds a false `<script>` opener and an `<img`
    // in one inline node. Inside braces the node used to be judged without
    // the document's oracle, so the false opener masked the tag.
    expect(
      stageMarkdownImages(
        "\\texttt{<?<script><img src=a.png>?>} tail\n",
        SAVED,
      ),
    ).toMatchObject({ unsupportedHtml: 1 });
    expect(
      stageMarkdownImages("x <?<script><img src=a.png>?> tail\n", SAVED),
    ).toMatchObject({ unsupportedHtml: 1 });
  });

  it("closes a region at a closer that stands in a link destination, a title or a definition", () => {
    // pandoc 3.11 reads raw source: the `</script>` inside the link title
    // ends the raw block, and the tag after it is an image. The parser hands
    // those strings over as node attributes, not as text, so the walk must
    // read them for a closer too — or the region runs to the end of the
    // note and every image after it is lost without a word.
    for (const md of [
      'a <script> b\n\n[x](u "</script>")\n\n<img src="img/a.png">\n',
      'a <script> b\n\n[x](</script>)\n\n<img src="img/a.png">\n',
      'a <script> b\n\n[r]: /u "</script>"\n\n<img src="img/a.png">\n',
      'a <script> b\n\n![</script>](https://x/y.png)\n\n<img src="img/a.png">\n',
    ]) {
      expect(stageMarkdownImages(md, SAVED), md).toMatchObject({
        images: [{ name: "image-0.png", source: "img/a.png" }],
        unsupportedHtml: 0,
      });
    }
  });

  describe("raw regions follow the exact source, as pandoc reads it", () => {
    // pandoc 3.11 on every input below; the parser's decoded values are not
    // what pandoc sees.
    it("closes a region at a closer the parser saw inside braces, and reads the image after it", () => {
      // pandoc: `<script>{</script>` is one raw block, whatever the braces;
      // the tag after it is an image. Left open, the region would swallow
      // that image without a word.
      const md = 'x <script>{</script>} <img src="img/a.png">\n';
      expect(stageMarkdownImages(md, SAVED)).toMatchObject({
        images: [{ name: "image-0.png", source: "img/a.png" }],
        refused: 0,
        unsupportedHtml: 0,
      });
    });

    it("lets a code span or a formula that began inside a region close it and open the next", () => {
      // The opening delimiter is script body to pandoc; after the closer,
      // the second `<script>` opens a region that hides the first image.
      for (const delim of ["`", "$"]) {
        const md = `x <script>${delim}</script><script>${delim}\n\n<img src="img/a.png">\n\n</script>\n\n<img src="img/b.png">\n`;
        expect(stageMarkdownImages(md, SAVED), md).toMatchObject({
          images: [{ name: "image-0.png", source: "img/b.png" }],
          markdown: `x <script>${delim}</script><script>${delim}\n\n<img src="img/a.png">\n\n</script>\n\n![](baram-asset:image-0.png)\n`,
          unsupportedHtml: 0,
        });
      }
      // Entered outside a region, code is code to pandoc as well: the
      // `<script>` inside the backticks opens nothing.
      expect(
        stageMarkdownImages(
          'x `<script>` y\n\n<img src="img/a.png">\n\n</script>\n',
          SAVED,
        ),
      ).toMatchObject({
        images: [{ name: "image-0.png", source: "img/a.png" }],
      });
    });

    it("moves the state over a tag that began inside a region, braces or not", () => {
      // The title of a tag the parser saw inside braces closes the script
      // and opens a `<pre>` that hides the first image; the second is read.
      const md =
        'x <script>{<i title="</script><pre>">}\n\n<img src="img/a.png">\n\n</pre>\n\n<img src="img/b.png">\n';
      expect(stageMarkdownImages(md, SAVED)).toMatchObject({
        images: [{ name: "image-0.png", source: "img/b.png" }],
        markdown:
          'x <script>{<i title="</script><pre>">}\n\n<img src="img/a.png">\n\n</pre>\n\n![](baram-asset:image-0.png)\n',
        unsupportedHtml: 0,
      });
      // What follows the closer inside the same tag is not read either, but
      // an image standing there is reported — the user hears of it.
      const suffix = `x <script>{<i title="</script><img src='img/a.png'>">}\n`;
      expect(stageMarkdownImages(suffix, SAVED)).toMatchObject({
        images: [],
        markdown: suffix,
        unsupportedHtml: 1,
      });
    });

    it("opens no region from a destination, a title, a definition or an alt entered outside one", () => {
      // pandoc reads the `<script>` in each as link or image syntax, not as
      // a tag: the image after it is visible. Only a tail or an image that
      // BEGAN inside a region may open the next one after its closer.
      const visible = { name: "image-0.png", source: "img/a.png" };
      for (const [md, images] of [
        ['[x](<script>)\n\n<img src="img/a.png">\n\n</script>\n', [visible]],
        [
          '[x](u "<script>")\n\n<img src="img/a.png">\n\n</script>\n',
          [visible],
        ],
        ['[r]: <script>\n\n<img src="img/a.png">\n\n</script>\n', [visible]],
        [
          '![<script>](img/x.png)\n\n<img src="img/a.png">\n\n</script>\n',
          [
            { name: "image-0.png", source: "img/x.png" },
            { name: "image-1.png", source: "img/a.png" },
          ],
        ],
      ] as const) {
        expect(stageMarkdownImages(md, SAVED), md).toMatchObject({
          images,
          unsupportedHtml: 0,
        });
      }
    });

    it("leaves an opener inside a raw TeX argument alone when it rescans after a closer", () => {
      // The `$` is script body to pandoc; after the closer, `\texttt{<script>}`
      // is one raw TeX inline, so both images are visible.
      const md =
        'x <script>$</script>\\texttt{<script>}$\n\n<img src="img/a.png">\n\n</script>\n\n<img src="img/b.png">\n';
      expect(stageMarkdownImages(md, SAVED)).toMatchObject({
        images: [
          { name: "image-0.png", source: "img/a.png" },
          { name: "image-1.png", source: "img/b.png" },
        ],
        unsupportedHtml: 0,
      });
    });

    it("stages nothing for the images a reopened region hides, however many", () => {
      // Three hundred hidden tags take no staging slot and count nowhere:
      // the one visible image after the final closer is image-0.
      const md = `x <script>\`</script><script>\`\n\n${'<img src="img/a.png">\n\n'.repeat(300)}</script>\n\n<img src="img/b.png">\n`;
      expect(stageMarkdownImages(md, SAVED)).toMatchObject({
        images: [{ name: "image-0.png", source: "img/b.png" }],
        overCap: 0,
        refused: 0,
        unsupportedHtml: 0,
      });
    });

    it("does not export an image whose syntax began inside a raw region", () => {
      // The raw block ends at the `</script>` in the alt; `](img/inside.png)`
      // is literal text to pandoc, not an image.
      const md =
        'a <script> b\n\n![</script>](img/inside.png)\n\n<img src="img/after.png">\n';
      expect(stageMarkdownImages(md, SAVED)).toEqual({
        images: [{ name: "image-0.png", source: "img/after.png" }],
        markdown:
          "a <script> b\n\n![</script>](img/inside.png)\n\n![](baram-asset:image-0.png)\n",
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 0,
      });
      // The same for a reference-style image.
      const ref =
        "a <script> b\n\n![</script>][r]\n\n<img src='img/after.png'>\n\n[r]: img/x.png\n";
      expect(stageMarkdownImages(ref, SAVED)).toMatchObject({
        images: [{ name: "image-0.png", source: "img/after.png" }],
        markdown:
          "a <script> b\n\n![</script>][r]\n\n![](baram-asset:image-0.png)\n\n[r]: img/x.png\n",
        refused: 0,
      });
    });

    it("opens the region a title reopens right after closing one", () => {
      // pandoc: a second raw block begins at the `<script>` in the title.
      const md =
        'a <script> b\n\n[x](u "</script><script>")\n\n<img src="img/hidden.png">\n\n</script>\n\n<img src="img/visible.png">\n';
      expect(stageMarkdownImages(md, SAVED)).toMatchObject({
        images: [{ name: "image-0.png", source: "img/visible.png" }],
        markdown:
          'a <script> b\n\n[x](u "</script><script>")\n\n<img src="img/hidden.png">\n\n</script>\n\n![](baram-asset:image-0.png)\n',
      });
    });

    it("does not let a decoded entity or an escape invent a closer or an opener", () => {
      // `&lt;/script>` decodes to `</script>` in the text node; pandoc reads
      // the source and keeps the block open to the literal closer.
      const entityCloser =
        'a <script> b\n\n[&lt;/script>](u)\n\n<img src="img/hidden.png">\n\n</script>\n\n<img src="img/visible.png">\n';
      expect(stageMarkdownImages(entityCloser, SAVED)).toMatchObject({
        images: [{ name: "image-0.png", source: "img/visible.png" }],
      });
      // `\<script>` and `&lt;script>` are text to pandoc: nothing opens,
      // though the closer that would make the opener real stands below.
      for (const md of [
        'x \\<script> y\n\n<img src="img/a.png">\n\n</script>\n',
        'x &lt;script> y\n\n<img src="img/a.png">\n\n</script>\n',
        'x \\\\begin{verbatim} y\n\n<img src="img/a.png">\n\n\\end{verbatim}\n',
      ]) {
        expect(stageMarkdownImages(md, SAVED), md).toMatchObject({
          images: [{ name: "image-0.png", source: "img/a.png" }],
          unsupportedHtml: 0,
        });
      }
    });

    it("closes a region at a closer in a reference link's label", () => {
      const md =
        'a <script> b\n\n[x][</script>]\n\n<img src="img/visible.png">\n\n[</script>]: /u\n';
      expect(stageMarkdownImages(md, SAVED)).toMatchObject({
        images: [{ name: "image-0.png", source: "img/visible.png" }],
        unsupportedHtml: 0,
      });
    });
  });

  it("counts a block whose text it cannot align with the source as unread", () => {
    // The parser replaces a NUL by U+FFFD in the node's text but not in the
    // source: the offsets cannot be trusted, so the block is left whole.
    const md = `<div>\n${String.fromCharCode(0)} <img src="img/a.png">\n</div>\n`;
    expect(stageMarkdownImages(md, SAVED)).toEqual({
      images: [],
      markdown: md,
      noSource: 0,
      overCap: 0,
      refused: 0,
      unsupportedHtml: 1,
      scoped: true,
    });
  });

  it("does not read a tag the parser split off from the verbatim element or comment an earlier node opened", () => {
    // A paragraph: html `<script>`, text, html `<img>`, text, html
    // `</script>` — pandoc reads the whole thing as one raw block.
    const inline =
      'x <script>const s = \'<img src="img/a.png" alt="A">\';</script> y\n';
    expect(stageMarkdownImages(inline, SAVED)).toEqual({
      images: [],
      markdown: inline,
      noSource: 0,
      overCap: 0,
      refused: 0,
      unsupportedHtml: 0,
      scoped: true,
    });
    // The region closes where its closer stands, in any node's text.
    expect(
      stageMarkdownImages(
        'x <script>s</script> <img src="img/b.png">\n',
        SAVED,
      ),
    ).toEqual({
      images: [{ name: "image-0.png", source: "img/b.png" }],
      markdown: "x <script>s</script> ![](baram-asset:image-0.png)\n",
      noSource: 0,
      overCap: 0,
      refused: 0,
      scoped: true,
      unsupportedHtml: 0,
    });
    // A comment holding a blank line: html block, html block, paragraph.
    const blocks =
      '<div>\n<!--\n\n<img src="img/a.png">\n\n-->\n</div>\n\n<img src="img/c.png">\n';
    expect(stageMarkdownImages(blocks, SAVED)).toEqual({
      images: [{ name: "image-0.png", source: "img/c.png" }],
      markdown:
        '<div>\n<!--\n\n<img src="img/a.png">\n\n-->\n</div>\n\n![](baram-asset:image-0.png)\n',
      unsupportedHtml: 0,
      noSource: 0,
      overCap: 0,
      refused: 0,
      scoped: true,
    });
    // Many tags inside one script: none staged, so the backend's cap
    // cannot fail the export over script text.
    const many = `x <script>${'<img src="img/a.png">'.repeat(300)}</script> y\n`;
    expect(stageMarkdownImages(many, SAVED)).toEqual({
      images: [],
      markdown: many,
      unsupportedHtml: 0,
      noSource: 0,
      overCap: 0,
      refused: 0,
      scoped: true,
    });
  });

  it("does not read a tag inside a raw TeX environment, in a paragraph or across blank lines, and reads on after its end", () => {
    // pandoc's raw_tex: the environment is one raw block, blank lines and
    // html nodes included; the tag inside is TeX, not an image.
    const blocks =
      "\\begin{verbatim}\n\n<img src='img/a.png' loading='lazy'>\n\n\\end{verbatim}\n\n<img src='img/b.png' loading='lazy'>\n";
    expect(stageMarkdownImages(blocks, SAVED)).toEqual({
      images: [{ name: "image-0.png", source: "img/b.png" }],
      markdown:
        "\\begin{verbatim}\n\n<img src='img/a.png' loading='lazy'>\n\n\\end{verbatim}\n\n![](baram-asset:image-0.png)\n",
      noSource: 0,
      overCap: 0,
      refused: 0,
      unsupportedHtml: 0,
      scoped: true,
    });
    const inline =
      "\\begin{figure} <img src='img/a.png' loading='lazy'> \\end{figure} <img src='img/b.png' loading='lazy'>\n";
    expect(stageMarkdownImages(inline, SAVED)).toMatchObject({
      images: [{ name: "image-0.png", source: "img/b.png" }],
      unsupportedHtml: 0,
    });
    // Many tags inside one environment: none staged, so the backend's cap
    // cannot fail the export over TeX text.
    const many = `\\begin{verbatim}\n\n${"<img src='img/a.png' loading='lazy'>\n\n".repeat(300)}\\end{verbatim}\n`;
    expect(stageMarkdownImages(many, SAVED)).toEqual({
      images: [],
      markdown: many,
      unsupportedHtml: 0,
      noSource: 0,
      overCap: 0,
      refused: 0,
      scoped: true,
    });
  });

  it("does not take an opener inside an attribute value for a raw region: the images after such a node are still read", () => {
    const md =
      '<div title="<script>">[ <img src="img/a.png"></div>\n\n<img src="img/b.png" width="640">\n';
    expect(stageMarkdownImages(md, SAVED)).toEqual({
      images: [{ name: "image-0.png", source: "img/b.png" }],
      markdown:
        '<div title="<script>">[ <img src="img/a.png"></div>\n\n![](baram-asset:image-0.png){width=640px}\n',
      noSource: 0,
      overCap: 0,
      refused: 0,
      unsupportedHtml: 1,
      scoped: true,
    });
  });

  it("does not read an inline tag that stands inside braces an earlier sibling opened: a raw TeX argument or a span attribute", () => {
    // pandoc reads `\\texttt{…}` as one raw TeX inline and `[x]{title="…"}` as a
    // span whose attribute holds the tag; neither shows an image, and a
    // staged file could fail the export for nothing.
    for (const md of [
      'a \\texttt{<img src="img/a.png" alt="A">} b\n',
      "[x]{title=\"<img src='img/a.png'>\"}\n",
      '\\href{https://x}{*<img src="img/a.png">*}\n',
    ]) {
      expect(stageMarkdownImages(md, SAVED), md).toEqual({
        images: [],
        markdown: md,
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 1,
      });
    }
    // Balanced braces before the tag, or braces closed by then, hide nothing.
    expect(
      stageMarkdownImages(
        'Photo {1} <img src="img/a.png"> and \\texttt{x} <img src="img/b.png">\n',
        SAVED,
      ),
    ).toEqual({
      images: [
        { name: "image-0.png", source: "img/a.png" },
        { name: "image-1.png", source: "img/b.png" },
      ],
      markdown:
        "Photo {1} ![](baram-asset:image-0.png) and \\texttt{x} ![](baram-asset:image-1.png)\n",
      noSource: 0,
      overCap: 0,
      refused: 0,
      scoped: true,
      unsupportedHtml: 0,
    });
  });

  it("leaves a tag shape HTML and pandoc could read differently, or that pandoc reads as code or a fence, rather than guess", () => {
    const NBSP = String.fromCharCode(0xa0);
    const shapes = [
      // a quote inside an unquoted value
      '<div>\n<img src=a"b.png> x " > y\n</div>\n',
      // a leading `=`: HTML names an attribute `=`, pandoc reads no tag at all
      '<div>\n<img = src="img/a>b.png" alt="A">\n</div>\n',
      // `=` and a quote inside an unquoted value
      '<div>\n<img src=https://x.example/a="b> KEEP ">\n</div>\n',
      // no whitespace before the next attribute
      '<div>\n<img alt="a"src="img/b.png">\n</div>\n',
      // an empty unquoted value
      "<div>\n<img src=>\n</div>\n",
      // a no-break space inside an unquoted value
      `<div>\n<img src=img/b${NBSP}c.png alt=B>\n</div>\n`,
      // comments HTML and pandoc end at different places
      "<div>\n<!--> <img src='img/b.png'>\n</div>\n",
      "<div>\n<!-- x --!> <img src='img/c.png'>\n</div>\n",
      // a tilde run right after a tag opens a fence after a block tag
      '<div>\n<img src="img/a.png">~~~\n</div>\n',
      // an indented line is an indented code block to pandoc
      '<div align="center">\n    <img src="img/a.png">\n</div>\n',
      // a container or list marker before the tag
      '<div>\n> ~~~\n> <img src="img/a.png">\n> ~~~\n</div>\n',
      '<div>\n(@x)     <img src="img/a.png" alt="A">\n</div>\n',
      // a pipe table inside the block
      "<div>\n| a | b |\n| - | - |\n| <img src='img/a.png' alt='p&#124;q'> | z |\n</div>\n",
    ];
    for (const md of shapes) {
      expect(stageMarkdownImages(md, SAVED), md).toEqual({
        images: [],
        markdown: md,
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 1,
      });
    }
  });

  describe("the lookahead for a closer", () => {
    afterEach(() => vi.restoreAllMocks());

    it("searches the document once per closer pattern, however many openers never close", () => {
      // Each unclosed `\\begin{itemize}` asks whether `\\end{itemize}` comes
      // later in the DOCUMENT; without a memo every one of them scanned to
      // the end of the note — a thousand openers, a thousand full scans
      // (4.5 s at 20,000 paragraphs). Pinned by count, not by time: the
      // scans of the whole source, apart from each node's own scan of its
      // text.
      const exec = vi.spyOn(RegExp.prototype, "exec");
      // Half the openers repeat one name, half carry a name of their own:
      // a memo per pattern would still scan once per distinct name.
      const md = `${Array.from(
        { length: 200 },
        (_, i) => `para ${i} \\begin{${i % 2 ? "itemize" : `env${i}`}} more`,
      ).join("\n\n")}\n`;
      expect(stageMarkdownImages(md, SAVED).markdown).toBe(md);
      const wholeSourceScans = exec.mock.calls.filter(
        ([text], k) =>
          text === md &&
          (exec.mock.instances[k] as RegExp).source.includes("end"),
      );
      expect(wholeSourceScans).toHaveLength(1);
    });

    it("does not search a node's own text for a closer the document does not hold", () => {
      // Thousands of false openers in ONE node — a paragraph of `\\begin{a}`
      // with no `\\end{a}` anywhere, or an HTML block of `<!--` with no
      // `-->` — used to cost a search to the end of the node per opener:
      // quadratic in the node, 26 s for a 512 KB note. The index knows the
      // closer is nowhere, so the node is not searched at all.
      const exec = vi.spyOn(RegExp.prototype, "exec");
      const tex = `${Array.from({ length: 300 }, () => "\\begin{a} text").join(" ")}\n`;
      expect(stageMarkdownImages(tex, SAVED).markdown).toBe(tex);
      const inNodeTexScans = exec.mock.calls.filter(
        ([text], k) =>
          typeof text === "string" &&
          text.length > 100 &&
          (exec.mock.instances[k] as RegExp).source === "\\\\end\\{a\\}",
      );
      expect(inNodeTexScans).toHaveLength(0);
      exec.mockClear();
      const html = `${Array.from({ length: 300 }, () => "<!-- x").join("\n")}\n`;
      expect(stageMarkdownImages(html, SAVED)).toMatchObject({
        markdown: html,
        unsupportedHtml: 0,
      });
      const inNodeCommentScans = exec.mock.calls.filter(
        ([text], k) =>
          typeof text === "string" &&
          text.length > 100 &&
          (exec.mock.instances[k] as RegExp).source === "--!?>",
      );
      expect(inNodeCommentScans).toHaveLength(0);
    });

    it("searches a node once per key when the only closer stands before every opener", () => {
      // `<!--x-->` closes nothing that follows it, yet it puts a closer in
      // the index, so the document-level question cannot rule the openers
      // out. Two searches at most: the one that closes `<!--x-->`, and the
      // first failed one, which settles the key for the rest of the node —
      // not one search per opener.
      const exec = vi.spyOn(RegExp.prototype, "exec");
      const html = `<!--x-->${"<!--".repeat(300)}\n`;
      expect(stageMarkdownImages(html, SAVED)).toMatchObject({
        markdown: html,
        unsupportedHtml: 0,
      });
      const inNodeCommentScans = exec.mock.calls.filter(
        ([text], k) =>
          typeof text === "string" &&
          text.length > 100 &&
          (exec.mock.instances[k] as RegExp).source === "--!?>",
      );
      expect(inNodeCommentScans.length).toBeLessThanOrEqual(2);
    });
  });
});

// issue 631 — the html nodes the image policy does not read, and what it
// says about them: a node outside the supported grammar or inside a raw
// region an earlier node opened stays exactly as written, and is counted —
// once, and only when it may hold an image — apart from the images refused.
import { describe, expect, it } from "vitest";

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
      refused: 0,
      scoped: true,
      unsupportedHtml: 0,
    });
  });

  it("does not count an unread block whose only tags are code samples, comments or verbatim bodies", () => {
    for (const md of [
      '<div>\n~~~html\n<img src="example.png">\n~~~\n</div>\n',
      "<script>let x=\"</scripture><img src='img/e.png'>\";</script>\n",
      "<div>\n<!-- x <img src='img/c.png'>\n</div>\n",
    ]) {
      expect(stageMarkdownImages(md, SAVED), md).toEqual({
        images: [],
        markdown: md,
        refused: 0,
        unsupportedHtml: 0,
        scoped: true,
      });
    }
  });

  it("counts a block whose text it cannot align with the source as unread", () => {
    // The parser replaces a NUL by U+FFFD in the node's text but not in the
    // source: the offsets cannot be trusted, so the block is left whole.
    const md = `<div>\n${String.fromCharCode(0)} <img src="img/a.png">\n</div>\n`;
    expect(stageMarkdownImages(md, SAVED)).toEqual({
      images: [],
      markdown: md,
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
      refused: 0,
      unsupportedHtml: 1,
      scoped: true,
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
        refused: 0,
        scoped: true,
        unsupportedHtml: 1,
      });
    }
  });
});

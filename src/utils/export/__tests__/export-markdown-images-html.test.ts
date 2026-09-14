// issue 631 — the `<img …>` tags the image policy reads out of an html node
// and rewrites as markdown images: the editor's own tag and every spelling
// HTML accepts, their attributes as HTML reads them, the width only the
// editor's tag keeps, and the offsets through container prefixes.
import { describe, expect, it } from "vitest";

import { parseMdast } from "../../../pipeline/parse-mdast";
import {
  rewriteImageTagsAsMarkdown,
  stageMarkdownImages,
} from "../export-markdown-images";
import { SAVED } from "./helpers/image-policy-fixtures";

describe("stageMarkdownImages on <img> tags", () => {
  it("turns the editor's resized <img> tag into a staged image with its width, or into alt text", () => {
    const { images, markdown, refused } = stageMarkdownImages(
      'a <img src="img/a.png" alt="A" title="T" width="640"> b\n\n<img src="img/b.png" width="50%">\n\n<img src="/etc/hosts" alt="hosts">\n\n<img src="img/c.png" loading="lazy">\n',
      SAVED,
    );
    expect(markdown).toBe(
      'a ![A](baram-asset:image-0.png "T"){width=640px} b\n\n![](baram-asset:image-1.png){width=50%}\n\nhosts\n\n![](baram-asset:image-2.png)\n',
    );
    expect(images).toEqual([
      { name: "image-0.png", source: "img/a.png" },
      { name: "image-1.png", source: "img/b.png" },
      { name: "image-2.png", source: "img/c.png" },
    ]);
    // A tag the editor could not represent (issue 631) is still an image to
    // pandoc's policy: its source is judged and staged, only its size is not
    // trusted. The refused one is counted.
    expect(refused).toBe(1);
  });

  describe("a tag the editor's strict parser refuses (issue 631)", () => {
    it("stages the source of a tag with single quotes, an extra attribute or a width it cannot round-trip, without a size", () => {
      const { images, markdown, refused } = stageMarkdownImages(
        '<img src=\'img/a.png\' alt=\'A\'>\n\n<img src="img/b.png" height="20">\n\n<img src="img/c.png" width="50vw">\n\n<img src=d.png alt=D>\n',
        SAVED,
      );
      expect(markdown).toBe(
        "![A](baram-asset:image-0.png)\n\n![](baram-asset:image-1.png)\n\n![](baram-asset:image-2.png)\n\n![D](baram-asset:image-3.png)\n",
      );
      expect(images).toEqual([
        { name: "image-0.png", source: "img/a.png" },
        { name: "image-1.png", source: "img/b.png" },
        { name: "image-2.png", source: "img/c.png" },
        { name: "image-3.png", source: "d.png" },
      ]);
      expect(refused).toBe(0);
    });

    it("refuses such a tag by the same rule as any image, and counts a tag with no usable source apart", () => {
      // A tag with no src, or an empty one, is not a destination that was
      // refused: the notice gives it its own reason.
      const { images, markdown, noSource, refused } = stageMarkdownImages(
        '<img src="/etc/hosts" alt="hosts" height="1">\n\n<img alt="lost" height="1">\n\n<img src="  " alt="empty">\n',
        SAVED,
      );
      expect(markdown).toBe("hosts\n\nlost\n\nempty\n");
      expect(images).toEqual([]);
      expect(refused).toBe(1);
      expect(noSource).toBe(2);
    });

    it("reads the attribute values as HTML does: entities decoded, the first of a duplicate kept, names case-insensitive", () => {
      const { images, markdown } = stageMarkdownImages(
        "<img src='img/a&amp;b.png' alt='say &quot;hi&quot;'>\n\n<IMG SRC='img/c.png' src='img/d.png' ALT='C'>\n",
        SAVED,
      );
      expect(markdown).toBe(
        '![say "hi"](baram-asset:image-0.png)\n\n![C](baram-asset:image-1.png)\n',
      );
      expect(images).toEqual([
        { name: "image-0.png", source: "img/a&b.png" },
        { name: "image-1.png", source: "img/c.png" },
      ]);
    });

    it("decodes before it judges: an encoded absolute path or scheme is still refused", () => {
      const { images, markdown, refused } = stageMarkdownImages(
        "<img src='&#47;etc/hosts' alt='abs'>\n\n<img src='https&colon;//tracker.example/p.gif' alt='remote'>\n",
        SAVED,
      );
      expect(markdown).toBe("abs\n\nremote\n");
      expect(images).toEqual([]);
      expect(refused).toBe(2);
    });

    it("edits each tag of an HTML block that holds several, keeping what stands between them", () => {
      const md =
        "<img src='img/a.png' alt='A'>\n<img src='img/b.png'><img src='/etc/hosts' alt='hosts'> tail\n";
      // One html node — an HTML block runs to the blank line (CommonMark).
      const tree = parseMdast(md);
      expect(tree.children.map((n) => n.type)).toEqual(["html"]);
      const { images, markdown, refused } = stageMarkdownImages(md, SAVED);
      expect(markdown).toBe(
        "![A](baram-asset:image-0.png)\n![](baram-asset:image-1.png)hosts tail\n",
      );
      expect(images).toEqual([
        { name: "image-0.png", source: "img/a.png" },
        { name: "image-1.png", source: "img/b.png" },
      ]);
      expect(refused).toBe(1);
    });

    it("leaves a commented-out tag, a custom element and a closing tag alone", () => {
      const md =
        "<!-- <img src='img/a.png'> -->\n\n<img-custom src=\"img/b.png\">\n\n</img>\n";
      // All three are read (a comment, a wrapper, a closing tag) and hold no
      // image to judge: nothing to count either.
      expect(stageMarkdownImages(md, SAVED)).toEqual({
        images: [],
        markdown: md,
        noSource: 0,
        overCap: 0,
        refused: 0,
        unsupportedHtml: 0,
        scoped: true,
      });
    });

    it("does not mistake `<img` inside another tag's attribute or a script body for an image", () => {
      const md =
        "<div title=\"<img src='missing.png'>\">\n\n<script>var s = \"<img src='x.png'>\";</script>\n\n<textarea><img src='t.png'></textarea>\n";
      // The attribute is opaque in a node that is read; the two verbatim
      // elements are not read at all, and a tag in their bodies is not an
      // image pandoc could read, so nothing is counted either.
      expect(stageMarkdownImages(md, SAVED)).toEqual({
        images: [],
        markdown: md,
        noSource: 0,
        overCap: 0,
        refused: 0,
        unsupportedHtml: 0,
        scoped: true,
      });
    });

    it("edits a tag that spans lines inside a blockquote or a list by its logical text, not the prefixed source", () => {
      const quoted = '> <img\n> src="img/a.png"\n> height="1">\n';
      expect(stageMarkdownImages(quoted, SAVED)).toEqual({
        images: [{ name: "image-0.png", source: "img/a.png" }],
        markdown: "> ![](baram-asset:image-0.png)\n",
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 0,
      });
      const listed = '- <img\n  src="img/b.png" height="1"> tail\n';
      expect(stageMarkdownImages(listed, SAVED)).toEqual({
        images: [{ name: "image-0.png", source: "img/b.png" }],
        markdown: "- ![](baram-asset:image-0.png) tail\n",
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 0,
      });
    });

    it("maps a continuation line whose leading tab the parser expanded to spaces", () => {
      const { images, markdown, refused } = stageMarkdownImages(
        '<img\n\tsrc="img/a.png"\n\talt="A">\n',
        SAVED,
      );
      expect(markdown).toBe("![A](baram-asset:image-0.png)\n");
      expect(images).toEqual([{ name: "image-0.png", source: "img/a.png" }]);
      expect(refused).toBe(0);
    });

    it("consumes a tag whose name holds a colon, as Word-pasted `<o:p>` does, inside an HTML block", () => {
      // In a paragraph CommonMark itself does not read `<o:p` as a tag (no
      // colon in its tag-name grammar) and hands over only the inner `<img`;
      // that raw fragment is dropped by the filter either way, so only the
      // block form — one html node holding both — is the scanner's to get right.
      const md = '<div>\n<o:p title="<img src=/x.png>"></o:p>\n</div>\n';
      expect(stageMarkdownImages(md, SAVED)).toEqual({
        images: [],
        markdown: md,
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 0,
      });
    });

    it("still reads a tag whose alt looks like math or code: only a tag that STARTS inside code is code", () => {
      const md =
        '<img alt="$$caption$$" src="img/a.png">\n\n<img alt="a `b` c" src="img/b.png">\n';
      const { images, markdown, refused } = stageMarkdownImages(md, SAVED);
      // The serializer escapes `$` and backticks in the alt; pandoc reads the
      // escapes back as the characters.
      expect(markdown).toBe(
        "![\\$\\$caption\\$\\$](baram-asset:image-0.png)\n\n![a \\`b\\` c](baram-asset:image-1.png)\n",
      );
      expect(images).toEqual([
        { name: "image-0.png", source: "img/a.png" },
        { name: "image-1.png", source: "img/b.png" },
      ]);
      expect(refused).toBe(0);
    });

    it("aligns the first line of a node whose container prefix ends in a tab (the parser synthesises leading spaces)", () => {
      // remark expands a tab in the prefix into spaces at the head of
      // `node.value` while `position.start` already sits past the tab.
      expect(
        stageMarkdownImages(
          '>\t<img src="img/a.png">\n>\tcaption text\n',
          SAVED,
        ),
      ).toEqual({
        markdown: ">\t![](baram-asset:image-0.png)\n>\tcaption text\n",
        noSource: 0,
        overCap: 0,
        refused: 0,
        images: [{ name: "image-0.png", source: "img/a.png" }],
        scoped: true,
        unsupportedHtml: 0,
      });
      expect(
        stageMarkdownImages(
          '- item\n\n\t<img src="img/b.png">\n\n\tmore text\n',
          SAVED,
        ),
      ).toEqual({
        markdown: "- item\n\n\t![](baram-asset:image-0.png)\n\n\tmore text\n",
        noSource: 0,
        overCap: 0,
        refused: 0,
        images: [{ name: "image-0.png", source: "img/b.png" }],
        scoped: true,
        unsupportedHtml: 0,
      });
      expect(
        stageMarkdownImages('>>\t<img src="img/c.png">\n>>\tafter\n', SAVED),
      ).toEqual({
        markdown: ">>\t![](baram-asset:image-0.png)\n>>\tafter\n",
        noSource: 0,
        overCap: 0,
        refused: 0,
        images: [{ name: "image-0.png", source: "img/c.png" }],
        scoped: true,
        unsupportedHtml: 0,
      });
    });

    it("maps a node whose lines end in CR or CRLF as the parser read them", () => {
      expect(
        stageMarkdownImages(
          '> <img\r> src="img/a.png"\r> height="1">\r',
          SAVED,
        ),
      ).toEqual({
        markdown: "> ![](baram-asset:image-0.png)\r",
        noSource: 0,
        overCap: 0,
        refused: 0,
        images: [{ name: "image-0.png", source: "img/a.png" }],
        scoped: true,
        unsupportedHtml: 0,
      });
      expect(
        stageMarkdownImages(
          '> <img\r\n> src="img/b.png"\r\n> height="1">\r\n',
          SAVED,
        ),
      ).toEqual({
        markdown: "> ![](baram-asset:image-0.png)\r\n",
        noSource: 0,
        overCap: 0,
        refused: 0,
        images: [{ name: "image-0.png", source: "img/b.png" }],
        scoped: true,
        unsupportedHtml: 0,
      });
    });

    it("reads a tag's attributes without DOMParser", () => {
      // The reading parses the tag inside a <template> as `<baram-img>` (a
      // DOMParser document may fetch <img> sources — export-img-attributes.ts
      // says why). This pins only that DOMParser is not needed; it cannot
      // observe that nothing is fetched.
      const saved = globalThis.DOMParser;
      // @ts-expect-error -- simulate a runtime without DOMParser
      delete globalThis.DOMParser;
      try {
        expect(
          stageMarkdownImages(
            "<img src='https://tracker.example/p.gif' alt='pixel' height='1'>\n\n<img src='img/a&amp;b.png' alt='A &quot;q&quot;' height='1'>\n",
            SAVED,
          ),
        ).toMatchObject({
          images: [{ name: "image-0.png", source: "img/a&b.png" }],
          markdown: 'pixel\n\n![A "q"](baram-asset:image-0.png)\n',
          noSource: 0,
          overCap: 0,
          refused: 1,
        });
      } finally {
        globalThis.DOMParser = saved;
      }
    });

    it("treats attribute values as opaque: a fence or backticks inside one hide nothing", () => {
      const md =
        '<div title="\n~~~\n">\n<img src="img/a.png">\n</div>\n\n<div title="`"><img src="img/b.png"><span title="`"></span></div>\n';
      expect(stageMarkdownImages(md, SAVED)).toEqual({
        images: [
          { name: "image-0.png", source: "img/a.png" },
          { name: "image-1.png", source: "img/b.png" },
        ],
        markdown:
          '<div title="\n~~~\n">\n![](baram-asset:image-0.png)\n</div>\n\n<div title="`">![](baram-asset:image-1.png)<span title="`"></span></div>\n',
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 0,
      });
    });

    it("keeps the editor's width when HTML's reading of the src differs only by trimming or an entity", () => {
      expect(
        stageMarkdownImages(
          '<img src=" img/a.png " width="640">\n\n<img src="img/b&#46;png" width="50%">\n',
          SAVED,
        ),
      ).toEqual({
        images: [
          { name: "image-0.png", source: "img/a.png" },
          { name: "image-1.png", source: "img/b.png" },
        ],
        markdown:
          "![](baram-asset:image-0.png){width=640px}\n\n![](baram-asset:image-1.png){width=50%}\n",
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 0,
      });
    });

    it("decodes references as an attribute value does: a legacy reference without its semicolon stays literal before `=` or a letter", () => {
      // Decoding is one pass: `&amp;amp;` yields `&amp;`, never `&`.
      expect(
        stageMarkdownImages(
          '<div>\n<img src="img/a&amp=x.png" alt="A &amp; B" height="1">\n<img src="img/b&amp;amp;c.png" height="1">\n</div>\n',
          SAVED,
        ),
      ).toMatchObject({
        images: [
          { name: "image-0.png", source: "img/a&amp=x.png" },
          { name: "image-1.png", source: "img/b&amp;c.png" },
        ],
        noSource: 0,
        overCap: 0,
        refused: 0,
      });
    });

    it("decodes references by attribute rules: a legacy reference without its semicolon stays literal before a letter, decodes otherwise", () => {
      const { images } = stageMarkdownImages(
        '<div>\n<img src="img/&copycat.png" height="1">\n<img src="img/&notit.png" height="1">\n<img src="img/&copy.png" height="1">\n<img src="img/&copy;cat.png" height="1">\n</div>\n',
        SAVED,
      );
      expect(images.map((i) => i.source)).toEqual([
        "img/&copycat.png",
        "img/&notit.png",
        "img/©.png",
        "img/©cat.png",
      ]);
    });

    it("keeps an editor tag's width whose source holds a nested reference: each side decoded once", () => {
      expect(
        stageMarkdownImages(
          '<img src="img/a&amp;lt;b.png" width="640">\n\n<img src="img/c&amp;amp;d.png" width="50%">\n',
          SAVED,
        ),
      ).toEqual({
        images: [
          { name: "image-0.png", source: "img/a&lt;b.png" },
          { name: "image-1.png", source: "img/c&amp;d.png" },
        ],
        markdown:
          "![](baram-asset:image-0.png){width=640px}\n\n![](baram-asset:image-1.png){width=50%}\n",
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 0,
      });
    });

    it("keeps the editor's size only when the strict parser and HTML agree on every attribute it copies", () => {
      // The strict parser's name scan can be fooled by a quoted value that
      // spells another attribute; HTML cannot. Any disagreement drops the size
      // (and the title) — the image itself is still judged by HTML's reading.
      expect(
        stageMarkdownImages(
          '<img alt=\'src="img/fake.png"\' src="img/real.png" width="640">\n',
          SAVED,
        ),
      ).toEqual({
        images: [{ name: "image-0.png", source: "img/real.png" }],
        markdown: '![src="img/fake.png"](baram-asset:image-0.png)\n',
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 0,
      });
      expect(
        stageMarkdownImages(
          '<img alt=\'src=" img/a.png "\' src="img/a.png" width="640">\n',
          SAVED,
        ),
      ).toEqual({
        markdown: '![src=" img/a.png "](baram-asset:image-0.png)\n',
        images: [{ name: "image-0.png", source: "img/a.png" }],
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 0,
      });
      expect(
        stageMarkdownImages(
          '<img src="img/a.png" alt=\'width="640"\'>\n',
          SAVED,
        ),
      ).toEqual({
        markdown: '![width="640"](baram-asset:image-0.png)\n',
        images: [{ name: "image-0.png", source: "img/a.png" }],
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 0,
      });
      expect(
        stageMarkdownImages('<img src="img/a.png" alt=\'title="T"\'>\n', SAVED),
      ).toEqual({
        markdown: '![title="T"](baram-asset:image-0.png)\n',
        images: [{ name: "image-0.png", source: "img/a.png" }],
        noSource: 0,
        overCap: 0,
        refused: 0,
        scoped: true,
        unsupportedHtml: 0,
      });
    });

    it("normalises a line ending inside a quoted value the way HTML does, whether or not the value holds a reference", () => {
      const { markdown } = stageMarkdownImages(
        '<img src="img/a.png" alt="p\rr">\n\n<img src="img/b.png" alt="p&amp;q\rr">\n',
        SAVED,
      );
      expect(markdown).toBe(
        "![p\nr](baram-asset:image-0.png)\n\n![p\\&q\nr](baram-asset:image-1.png)\n",
      );
    });

    it("keeps a table cell one cell when a decoded alt holds a pipe", () => {
      const { markdown } = stageMarkdownImages(
        "| a | b |\n| - | - |\n| <img src='img/a.png' alt='p&#124;q'> | c |\n",
        SAVED,
      );
      expect(markdown).toBe(
        "| a | b |\n| - | - |\n| ![p\\|q](baram-asset:image-0.png) | c |\n",
      );
    });

    it("emits a kept asset by the parser's view of its source, not the raw attribute", () => {
      const { markdown } = stageMarkdownImages(
        '<img src="\tbaram-asset:mermaid-0.png" alt="d">\n',
        SAVED,
      );
      expect(markdown).toBe("![d](baram-asset:mermaid-0.png)\n");
    });
  });
});

describe("rewriteImageTagsAsMarkdown (the text writers)", () => {
  it("rewrites the editor's <img> tags with their source untouched, and nothing else", () => {
    const md =
      'a <img src="img/a.png" alt="A" width="640"> b\n\n<img src="../x.png" width="50%">\n\n<img src="img/c.png" loading="lazy">\n\n![k](img/k.png)\n';
    expect(rewriteImageTagsAsMarkdown(md)).toEqual({
      markdown:
        "a ![A](img/a.png){width=640px} b\n\n![](../x.png){width=50%}\n\n![](img/c.png)\n\n![k](img/k.png)\n",
      noSource: 0,
      overCap: 0,
      refused: 0,
      unsupportedHtml: 0,
    });
    expect(rewriteImageTagsAsMarkdown("plain\n")).toEqual({
      markdown: "plain\n",
      noSource: 0,
      overCap: 0,
      refused: 0,
      unsupportedHtml: 0,
    });
  });

  it("turns a tag the strict parser refuses into a markdown image with its decoded source, and a source-less one into its alt (issue 631)", () => {
    expect(
      rewriteImageTagsAsMarkdown(
        "<img src='img/a&amp;b.png' alt='A' height='1'>\n\n<img alt='lost' height='1'>\n\n<img src='x.png'><img src='y.png' alt='Y'> tail\n",
      ),
    ).toEqual({
      // The serializer escapes the `&` in the destination; pandoc reads `\&`
      // back as `&`, so the file it names is `img/a&b.png`. The source-less
      // tag became its alt text and is counted, so the user hears about it.
      markdown: "![A](img/a\\&b.png)\n\nlost\n\n![](x.png)![Y](y.png) tail\n",
      noSource: 1,
      overCap: 0,
      refused: 0,
      unsupportedHtml: 0,
    });
  });

  it("writes the source as HTML reads it, like the embedding route: blanks trimmed, tabs and line breaks removed", () => {
    // The embedding route judges and writes the parser's view of the source
    // (a tab inside an attribute value never reaches pandoc); the text
    // writers used to splice the raw attribute, so the same note named two
    // different files in `.docx` and `.tex`.
    expect(
      rewriteImageTagsAsMarkdown('<img src="\timg/a\tb.png " alt="A">\n'),
    ).toMatchObject({ markdown: "![A](img/ab.png)\n" });
    expect(
      stageMarkdownImages('<img src="\timg/a\tb.png " alt="A">\n', SAVED),
    ).toMatchObject({
      images: [{ name: "image-0.png", source: "img/ab.png" }],
    });
  });

  it("takes the same acceptance decision as the embedding route: an unread block stays whole and is counted", () => {
    const md =
      "<div>\n```\n<img src='img/a.png'>\n```\n<img src='img/b.png'>\n</div>\n";
    expect(rewriteImageTagsAsMarkdown(md)).toEqual({
      markdown: md,
      noSource: 0,
      overCap: 0,
      refused: 0,
      unsupportedHtml: 1,
    });
  });
});

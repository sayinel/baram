// issue 631 — what the pandoc export's image policy reads out of an html
// node, and what it refuses to read.
//
// The contract is a positive grammar: a node is SUPPORTED when it is nothing
// but well-formed tags, comments and caption text pandoc can only read as
// words; every other node is left alone whole. The fixtures here are the
// shapes pandoc 3.11 was measured on (`--from markdown`, default extensions):
// a tag inside code, math, a fence, an indented line or a link destination is
// not an image to pandoc, so the reader must not offer it as one.
import { describe, expect, it } from "vitest";

import {
  editorSize,
  mayHoldImage,
  readHtmlFragment,
  readImgTag,
  valueToSource,
} from "../export-html-fragment";

/** The `<img …>` start tags of `value`, as the text they cover. */
function imgTags(value: string): null | string[] {
  const spans = readHtmlFragment(value);
  return spans === null
    ? null
    : spans.map((span) => value.slice(span.start, span.end));
}

describe("readHtmlFragment", () => {
  it("reads the editor's own tag, and a tag that spans lines", () => {
    expect(imgTags('<img src="a.png" alt="A" width="640">')).toEqual([
      '<img src="a.png" alt="A" width="640">',
    ]);
    expect(imgTags('<img\n\tsrc="a.png"\n\talt="A">')).toEqual([
      '<img\n\tsrc="a.png"\n\talt="A">',
    ]);
    expect(imgTags("<IMG SRC='a.png'/>")).toEqual(["<IMG SRC='a.png'/>"]);
  });

  it("reads every tag of a wrapped gallery with captions, indented up to three spaces", () => {
    const value =
      '<div align="center">\n  <img src="a.png">\n  <img src="b.png"> Figure 1: two *photos* &copy; 2024\n   <p><img src="c.png"></p>\n</div>';
    expect(imgTags(value)).toEqual([
      '<img src="a.png">',
      '<img src="b.png">',
      '<img src="c.png">',
    ]);
    expect(
      imgTags(
        '<figure>\n  <img src="a.png">\n  <figcaption>Cap</figcaption>\n</figure>',
      ),
    ).toEqual(['<img src="a.png">']);
    expect(
      imgTags(
        '<details>\n<summary>s</summary>\n<a href="https://x"><img src="a.png"></a>\n</details>',
      ),
    ).toEqual(['<img src="a.png">']);
  });

  it("treats attribute values as opaque: a backtick, a fence or an `<img` inside one is nothing", () => {
    expect(
      imgTags(
        '<div title="`"><img src="b.png"><span title="\n~~~\n"></span></div>',
      ),
    ).toEqual(['<img src="b.png">']);
    expect(imgTags("<div title=\"<img src='missing.png'>\"></div>")).toEqual(
      [],
    );
    expect(
      imgTags('<div>\n<o:p title="<img src=/x.png>"></o:p>\n</div>'),
    ).toEqual([]);
    expect(
      imgTags(
        '<noscript><img src="a.png" xml:lang="v" data-x hidden></noscript>',
      ),
    ).toEqual(['<img src="a.png" xml:lang="v" data-x hidden>']);
    expect(imgTags('<img alt="$$c$$ `x`" src="a.png">')).toEqual([
      '<img alt="$$c$$ `x`" src="a.png">',
    ]);
  });

  it("passes over a comment, a custom element and a closing tag", () => {
    expect(imgTags("<!-- <img src='a.png'> -->")).toEqual([]);
    expect(imgTags('<div>\n<!-- c --><img src="a.png">\n</div>')).toEqual([
      '<img src="a.png">',
    ]);
    expect(imgTags('<img-custom src="b.png">')).toEqual([]);
    expect(imgTags("</img>")).toEqual([]);
  });

  it("refuses the whole node at anything pandoc could read as code, math, an escape or a fence", () => {
    expect(
      imgTags("<div>\n`<img src='b.png'>` and <img src='c.png'>\n</div>"),
    ).toBeNull();
    expect(imgTags('<div>\n$x <img src="b.png"> y$\n</div>')).toBeNull();
    expect(imgTags('<div>\n\\<img src="a.png">\n</div>')).toBeNull();
    expect(imgTags('<div>\n~~~\n<img src="a.png">\n~~~\n</div>')).toBeNull();
    // Right after a block tag a tilde run opens a fence (measured); the
    // reader does not know block tags from inline ones and refuses both.
    expect(imgTags('<div> ~~~\n<img src="a.png">\n~~~\n</div>')).toBeNull();
    expect(imgTags('<img src="a.png">~~~')).toBeNull();
  });

  it("refuses a line indented four columns or with a tab: pandoc reads it as an indented code block", () => {
    expect(imgTags('<div>\n    <img src="a.png">\n</div>')).toBeNull();
    expect(imgTags('<div>\n<p>x</p>\n\t<img src="c.png">\n</div>')).toBeNull();
    expect(imgTags("<div>\n<p>x</p>\n    </div>")).toBeNull();
    // Inside a tag, indentation is whitespace between attributes.
    expect(imgTags('<img\n    src="a.png"\n    alt="A">')).toEqual([
      '<img\n    src="a.png"\n    alt="A">',
    ]);
  });

  it("refuses a markdown image, a stray `<`, and any bracket or pipe: a link, a definition, a span attribute, a pipe table or an attribute suffix would take the tag or the rewritten image", () => {
    expect(imgTags('<div>\n<img src="a.png">\n![b](x.png)\n</div>')).toBeNull();
    expect(imgTags('<div>\na < b <img src="a.png">\n</div>')).toBeNull();
    expect(imgTags("<div>\n<3 <img src='a.png'>\n</div>")).toBeNull();
    expect(imgTags('<div>\n[x](<img src="a.png">)\n</div>')).toBeNull();
    expect(imgTags('<div>\n[x](foo<img src="a.png">)\n</div>')).toBeNull();
    expect(imgTags("<div>\n[x](d \"<img src='a.png'>\")\n</div>")).toBeNull();
    expect(imgTags('<div>\n[x]: <img src="a.png">\n</div>')).toBeNull();
    expect(
      imgTags('<div>\n[<img src="a.png" alt="A">](https://x)\n</div>'),
    ).toBeNull();
    expect(imgTags('<div>\nsee [1] <img src="a.png">\n</div>')).toBeNull();
    expect(imgTags('<div><img src="a.png">{width=1%}</div>')).toBeNull();
    expect(
      imgTags('<div>\n| a |\n| - |\n| <img src="a.png"> |\n</div>'),
    ).toBeNull();
  });

  it("refuses a line that begins with a container or list marker: a fence or indentation inside it is code to pandoc", () => {
    expect(
      imgTags('<div>\n> ~~~\n> <img src="a.png">\n> ~~~\n</div>'),
    ).toBeNull();
    expect(imgTags('<div>\n>     <img src="a.png">\n</div>')).toBeNull();
    expect(
      imgTags('<div>\n- ~~~\n  <img src="a.png">\n  ~~~\n</div>'),
    ).toBeNull();
    expect(imgTags('<div>\n1. ~~~\n   <img src="a.png">\n</div>')).toBeNull();
    expect(imgTags('<div>> <img src="a.png">\n</div>')).toBeNull();
    // A marker needs its space: a dash inside a word, a star opening
    // emphasis and a heading are caption text.
    expect(
      imgTags('<div>\nwell-known *<img src="a.png">*, # not a list\n</div>'),
    ).toEqual(['<img src="a.png">']);
  });

  it("refuses the four elements whose body pandoc keeps verbatim, whether or not they are closed", () => {
    expect(imgTags('<pre>\n<img src="a.png">\n</pre>')).toBeNull();
    expect(
      imgTags("<script>var s = \"<img src='x.png'>\";</script>"),
    ).toBeNull();
    expect(imgTags("<textarea><img src='t.png'></textarea>")).toBeNull();
    expect(imgTags("<style>x</style>\n<img src='a.png'>")).toBeNull();
    expect(imgTags("</script>\n<img src='a.png'>")).toBeNull();
  });

  it("refuses a comment HTML and pandoc could end at different places, and one that never ends", () => {
    expect(imgTags("<div>\n<!--> <img src='b.png'>\n</div>")).toBeNull();
    expect(imgTags("<div>\n<!---> <img src='b.png'>\n</div>")).toBeNull();
    expect(imgTags("<div>\n<!-- x --!> <img src='c.png'>\n</div>")).toBeNull();
    expect(imgTags("<div>\n<!-- x <img src='c.png'>\n</div>")).toBeNull();
  });

  it("refuses a tag outside the grammar rather than guess how pandoc reads it", () => {
    expect(imgTags('<img src="a.png"')).toBeNull();
    expect(
      imgTags('<div>\n<img = src="img/a>b.png" alt="A">\n</div>'),
    ).toBeNull();
    expect(imgTags('<div>\n<img src=a"b.png> x\n</div>')).toBeNull();
    expect(imgTags('<div>\n<img src= alt="x">\n</div>')).toBeNull();
    expect(imgTags('<div>\n<img alt="a"src="b.png">\n</div>')).toBeNull();
    expect(imgTags('<div>\n<img src="a.png"></div class="x">')).toBeNull();
    const NBSP = String.fromCharCode(0xa0);
    expect(
      imgTags(`<div>\n<img src=img/b${NBSP}c.png alt=B>\n</div>`),
    ).toBeNull();
    // Names pandoc reads as text: a dot anywhere, a leading `_` or `:`.
    expect(imgTags('<div><img src="a.png" a.b="x"></div>')).toBeNull();
    expect(imgTags('<div><img src="a.png" _x="v"></div>')).toBeNull();
    expect(
      imgTags('<div><a.b title="`"><img src="a.png"></a.b></div>'),
    ).toBeNull();
  });

  it("reads the unquoted and empty shapes both parsers agree on", () => {
    expect(imgTags("<div>\n<img src=d.png alt=D>\n<img/>\n</div>")).toEqual([
      "<img src=d.png alt=D>",
      "<img/>",
    ]);
  });
});

describe("mayHoldImage", () => {
  it("is an estimate: an `<img` tag start or a markdown image anywhere in the text", () => {
    expect(
      mayHoldImage("<script>var s = \"<img src='x.png'>\";</script>"),
    ).toBe(true);
    expect(mayHoldImage("<IMG/>")).toBe(true);
    expect(mayHoldImage("<div>\n![a](x.png)\n</div>")).toBe(true);
    expect(mayHoldImage('<img-custom src="b.png">')).toBe(false);
    expect(mayHoldImage("<div>\n```\ncode\n```\n</div>")).toBe(false);
  });
});

describe("readImgTag", () => {
  it("reads attributes as HTML does: decoded by attribute rules, first duplicate kept, names case-insensitive, src trimmed", () => {
    const loose = readImgTag(
      "<IMG SRC=' img/a&amp;b.png ' src='img/d.png' ALT='say &quot;hi&quot;' alt='x'>",
    );
    expect(loose.src).toBe("img/a&b.png");
    expect(loose.alt).toBe('say "hi"');
    expect(loose.attrs?.get("src")).toBe(" img/a&b.png ");
  });

  it("keeps a legacy reference literal before a letter or `=`, decodes it otherwise", () => {
    expect(readImgTag('<img src="img/&copycat.png">').src).toBe(
      "img/&copycat.png",
    );
    expect(readImgTag('<img src="img/a&amp=x.png">').src).toBe(
      "img/a&amp=x.png",
    );
    expect(readImgTag('<img src="img/&copy.png">').src).toBe("img/©.png");
  });

  it("reports no source for an empty or absent src", () => {
    expect(readImgTag("<img/>")).toMatchObject({ alt: null, src: null });
    expect(readImgTag('<img src="" alt="empty">')).toMatchObject({
      alt: "empty",
      src: null,
    });
  });
});

describe("editorSize", () => {
  it("keeps the editor's size only when the strict parser and HTML agree on every attribute it copies", () => {
    const own = '<img src="img/a.png" alt="A" title="T" width="640">';
    expect(editorSize(own, readImgTag(own))).toEqual({
      title: "T",
      widthPercent: 100,
      widthPixel: 640,
    });
    const fooled =
      '<img alt=\'src="img/fake.png"\' src="img/real.png" width="640">';
    expect(editorSize(fooled, readImgTag(fooled))).toEqual({});
    const loose = "<img src='img/a.png' width='640'>";
    expect(editorSize(loose, readImgTag(loose))).toEqual({});
  });
});

describe("valueToSource", () => {
  it("maps a node's text back through container prefixes and an expanded tab", () => {
    const source = '> <img\n> src="img/a.png"\n> height="1">\n';
    const value = '<img\nsrc="img/a.png"\nheight="1">';
    const map = valueToSource(value, source, 2)!;
    expect(source.slice(map(0), map(value.length))).toBe(
      '<img\n> src="img/a.png"\n> height="1">',
    );
    const tabbed = '>\t<img src="img/a.png">\n';
    const expanded = '  <img src="img/a.png">';
    const map2 = valueToSource(expanded, tabbed, 2)!;
    expect(tabbed.slice(map2(2), map2(expanded.length))).toBe(
      '<img src="img/a.png">',
    );
  });

  it("gives up when the lines cannot be aligned", () => {
    expect(valueToSource("<img\nx>", "<img\ny>\n", 0)).toBeNull();
  });
});

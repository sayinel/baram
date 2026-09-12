// issue 545 — the Pandoc export's image policy, on strings.
//
// What pandoc may read is decided here and enforced in Rust; these tests pin
// the string side: which destinations are kept, staged or refused, what a
// refused image is replaced with, and that the splice cannot form new syntax.
import { describe, expect, it } from "vitest";

import { parseMdast } from "../../../pipeline/parse-mdast";
import {
  classifyImageSource,
  relativeScope,
  rewriteImageTagsAsMarkdown,
  stageMarkdownImages,
} from "../export-markdown-images";
import { stripDisallowedMarkdownLinks } from "../export-markdown-links";

/** The diagram assets this export produced — the only `baram-asset:` names kept. */
const KNOWN = new Set(["mermaid-0.png"]);
const SAVED = {
  contextRoot: "/vault",
  documentPath: "/vault/notes/today.md",
  knownAssets: KNOWN,
};
const UNSAVED = {
  contextRoot: "/vault",
  documentPath: null,
  knownAssets: KNOWN,
};
/** A file opened on its own: no vault or folder context to be relative to. */
const LONE = {
  contextRoot: null,
  documentPath: "/Users/me/solo.md",
  knownAssets: KNOWN,
};
const IN_VAULT = relativeScope(SAVED.documentPath, SAVED.contextRoot);

describe("classifyImageSource", () => {
  it("keeps a staged mermaid asset and refuses any asset name this export did not produce", () => {
    expect(
      classifyImageSource("baram-asset:mermaid-0.png", IN_VAULT, KNOWN),
    ).toEqual({ kind: "keep" });
    // A document-written placeholder would reach pandoc as a bare file name.
    expect(
      classifyImageSource("baram-asset:mermaid-1.png", IN_VAULT, KNOWN),
    ).toEqual({
      kind: "refuse",
    });
    expect(
      classifyImageSource("\tbaram-asset:mermaid-0.png", IN_VAULT, KNOWN),
    ).toEqual({ kind: "keep" });
    expect(classifyImageSource("baram-asset:../x", IN_VAULT, KNOWN)).toEqual({
      kind: "refuse",
    });
    expect(classifyImageSource("baram-asset:", IN_VAULT, KNOWN)).toEqual({
      kind: "refuse",
    });
  });

  it("stages a relative path that stays inside the document's context, refuses one that leaves it", () => {
    expect(classifyImageSource("img/a.png", IN_VAULT, KNOWN)).toEqual({
      kind: "stage",
      source: "img/a.png",
    });
    // Up one level is still inside /vault.
    expect(classifyImageSource("../shared/a.png", IN_VAULT, KNOWN).kind).toBe(
      "stage",
    );
    expect(classifyImageSource("./a%20b.png", IN_VAULT, KNOWN).kind).toBe(
      "stage",
    );
    // Up two levels leaves /vault — judged on the string, so the export can
    // degrade to alt text instead of failing in the backend.
    for (const url of [
      "../../secret.png",
      "../../../etc/hosts",
      "%2e%2e/%2e%2e/secret.png",
      "img/../../../secret.png",
      "..\\..\\secret.png",
    ]) {
      expect(classifyImageSource(url, IN_VAULT, KNOWN), url).toEqual({
        kind: "refuse",
      });
    }
    // No scope at all — unsaved, or a file opened on its own.
    expect(classifyImageSource("img/a.png", null, KNOWN)).toEqual({
      kind: "refuse",
    });
  });

  it("resolves the scope from the document path and the context root, or not at all", () => {
    expect(relativeScope("/vault/notes/today.md", "/vault/")).toEqual({
      caseInsensitive: false,
      documentDir: "/vault/notes",
      root: "/vault",
    });
    expect(relativeScope("C:\\vault\\notes\\today.md", "C:\\vault")).toEqual({
      caseInsensitive: true,
      documentDir: "C:/vault/notes",
      root: "C:/vault",
    });
    expect(relativeScope(null, "/vault")).toBeNull();
    expect(relativeScope("/Users/me/solo.md", null)).toBeNull();
  });

  it("refuses everything pandoc would read from outside the document's tree", () => {
    for (const url of [
      "/etc/hosts",
      "/Users/me/.ssh/id_rsa",
      "\\\\server\\share\\x.png",
      "\\Windows\\x.png",
      "C:\\Users\\me\\x.png",
      "c:/x.png",
      "file:///etc/hosts",
      "FILE:///etc/hosts",
      " file:///etc/hosts",
      "data:image/png;base64,AAAA",
      "https://tracker.example/pixel.gif",
      "http://x/y.png",
      "//tracker.example/pixel.gif",
      "java\tscript:alert(1)",
      "",
      "#fragment",
      "?query",
    ]) {
      expect(classifyImageSource(url, IN_VAULT, KNOWN), url).toEqual({
        kind: "refuse",
      });
    }
  });
});

describe("relativeScope", () => {
  it("judges drive-letter case before normalisation strips the separator off a drive root (issue 631)", () => {
    // `C:\` becomes `C:` once normalised — no longer drive-absolute to look
    // at — so the rule is applied to the inputs as given.
    expect(relativeScope("C:\\a.md", "C:\\")).toEqual({
      caseInsensitive: true,
      documentDir: "C:",
      root: "C:",
    });
    expect(relativeScope("/vault/notes/a.md", "/vault/")).toEqual({
      caseInsensitive: false,
      documentDir: "/vault/notes",
      root: "/vault",
    });
  });
});

describe("stageMarkdownImages", () => {
  it("returns the same string when there is nothing to change", () => {
    const md = "text ![d](baram-asset:mermaid-0.png) more\n";
    const { images, markdown } = stageMarkdownImages(md, SAVED);
    expect(markdown).toBe(md);
    expect(images).toEqual([]);
  });

  it("rewrites a relative image to a staged asset and reports the request", () => {
    const { images, markdown } = stageMarkdownImages(
      'see ![A diagram](img/arch.PNG "Arch") here\n',
      SAVED,
    );
    expect(markdown).toBe(
      'see ![A diagram](baram-asset:image-0.png "Arch") here\n',
    );
    expect(images).toEqual([{ name: "image-0.png", source: "img/arch.PNG" }]);
  });

  it("numbers requests in document order and keeps the extension only when it is plain", () => {
    const { images } = stageMarkdownImages(
      "![](a/one.png)\n\n![](b/two.jpeg)\n\n![](c/noext)\n\n![](d/x.tar.gz)\n",
      SAVED,
    );
    expect(images.map((i) => i.name)).toEqual([
      "image-0.png",
      "image-1.jpeg",
      "image-2",
      "image-3.gz",
    ]);
  });

  it("replaces a refused image by its alt text, and an empty alt by nothing", () => {
    const { images, markdown } = stageMarkdownImages(
      "secret ![the hosts file](/etc/hosts) and ![](file:///x) end\n",
      SAVED,
    );
    expect(markdown).toBe("secret the hosts file and  end\n");
    expect(images).toEqual([]);
  });

  it("refuses a relative image in a document that was never saved, or opened on its own", () => {
    for (const opts of [UNSAVED, LONE]) {
      const { images, markdown } = stageMarkdownImages(
        "![local](img/a.png)\n",
        opts,
      );
      expect(markdown).toBe("local\n");
      expect(images).toEqual([]);
    }
  });

  it("degrades an image that climbs out of the context to its alt text", () => {
    const { images, markdown } = stageMarkdownImages(
      "![leak](../../secret.png) ![ok](../shared/a.png)\n",
      SAVED,
    );
    expect(markdown).toBe("leak ![ok](baram-asset:image-0.png)\n");
    expect(images).toEqual([
      { name: "image-0.png", source: "../shared/a.png" },
    ]);
  });

  it("refuses remote images (no export-time network request)", () => {
    const { markdown } = stageMarkdownImages(
      "![pixel](https://tracker.example/p.gif)\n",
      SAVED,
    );
    expect(markdown).toBe("pixel\n");
  });

  it("escapes an alt that would otherwise become a block or fuse with a neighbour", () => {
    expect(stageMarkdownImages("![# heading](/x)\n", SAVED).markdown).toBe(
      "\\# heading\n",
    );
    expect(stageMarkdownImages("- ![- item](/x)\n", SAVED).markdown).toBe(
      "- \\- item\n",
    );
    // `<` + alt + `>` would be an autolink, so the left neighbour is escaped;
    // the serializer also escapes the `:` so the alt is not a GFM autolink
    // literal on its own.
    expect(stageMarkdownImages("<![https://a](/x)>\n", SAVED).markdown).toBe(
      "\\<https\\://a>\n",
    );
  });

  it("keeps a table cell one cell: pipes in the alt are escaped either way", () => {
    const md =
      "| a | b |\n| - | - |\n| ![x \\| y](/etc/hosts) | ![p \\| q](img/p.png) |\n";
    const { images, markdown } = stageMarkdownImages(md, SAVED);
    expect(markdown).toBe(
      "| a | b |\n| - | - |\n| x \\| y | ![p \\| q](baram-asset:image-0.png) |\n",
    );
    expect(images).toEqual([{ name: "image-0.png", source: "img/p.png" }]);
  });

  it("reduces a reference-style image to its alt unless its definition is a kept asset", () => {
    const { images, markdown } = stageMarkdownImages(
      "![alt][r] and ![ok][m]\n\n[r]: img/a.png\n[m]: baram-asset:mermaid-0.png\n",
      SAVED,
    );
    expect(markdown).toBe(
      "alt and ![ok][m]\n\n[r]: img/a.png\n[m]: baram-asset:mermaid-0.png\n",
    );
    expect(images).toEqual([]);
  });

  it("leaves code spans, fences and links alone", () => {
    const md =
      "`![x](/etc/hosts)`\n\n```\n![y](/etc/hosts)\n```\n\n[not an image](/etc/hosts)\n";
    expect(stageMarkdownImages(md, SAVED).markdown).toBe(md);
  });

  it("judges the decoded destination: an angle-bracket destination is the same path", () => {
    const { images } = stageMarkdownImages("![a](<img/a b.png>)\n", SAVED);
    expect(images).toEqual([{ name: "image-0.png", source: "img/a b.png" }]);
  });
  it("keeps a linked image's link: a badge keeps its target, a staged image stays linked", () => {
    // The image's `[` neighbour is the link's own bracket; escaping it would
    // break the link — and hide the destination from the link policy that
    // runs after this pass.
    expect(
      stageMarkdownImages(
        "[![badge](https://ci.example/b.svg)](https://ci.example)\n",
        SAVED,
      ).markdown,
    ).toBe("[badge](https://ci.example)\n");
    const { images, markdown } = stageMarkdownImages(
      "[![a](img/a.png)](https://x.example) [![h](/etc/hosts)](javascript:alert(1))\n",
      SAVED,
    );
    expect(markdown).toBe(
      "[![a](baram-asset:image-0.png)](https://x.example) [h](javascript:alert(1))\n",
    );
    expect(images).toEqual([{ name: "image-0.png", source: "img/a.png" }]);
    // …and the link policy, run last, judges the destination it now sees.
    expect(stripDisallowedMarkdownLinks(markdown)).toBe(
      "[![a](baram-asset:image-0.png)](https://x.example) h\n",
    );
    // Outside a link the `[` guard still holds: no link may grow.
    expect(
      stageMarkdownImages("[x] ![h](/etc/hosts)(https://x)\n", SAVED).markdown,
    ).toBe("[x] h(https://x)\n");
  });

  it("stages the file before a query or fragment, as pandoc would look it up", () => {
    const { images, markdown } = stageMarkdownImages(
      "![a](img/a.png?raw=1) ![b](img/icons.svg#home)\n",
      SAVED,
    );
    expect(images).toEqual([
      { name: "image-0.png", source: "img/a.png" },
      { name: "image-1.svg", source: "img/icons.svg" },
    ]);
    expect(markdown).toBe(
      "![a](baram-asset:image-0.png) ![b](baram-asset:image-1.svg)\n",
    );
    // A destination that is only a query or fragment names no file.
    expect(classifyImageSource("?x", IN_VAULT, KNOWN)).toEqual({
      kind: "refuse",
    });
  });

  it("judges the parser's view of the destination, as the link policy does", () => {
    // A leading tab is dropped by the parser: this is an absolute path.
    expect(classifyImageSource("\t/etc/hosts", IN_VAULT, KNOWN)).toEqual({
      kind: "refuse",
    });
    expect(classifyImageSource(" \timg/a.png", IN_VAULT, KNOWN)).toEqual({
      kind: "stage",
      source: "img/a.png",
    });
  });

  it("names the staged file by its decoded extension, not by a fragment it decodes to", () => {
    // `%23` is the spelling of a file called `a#b.png`; the fragment was
    // already gone before decoding.
    expect(stageMarkdownImages("![a](img/a%23b.png)\n", SAVED).images).toEqual([
      { name: "image-0.png", source: "img/a%23b.png" },
    ]);
  });

  it("refuses a document-written placeholder wearing a name staged earlier in the same walk", () => {
    const { images, markdown } = stageMarkdownImages(
      "![a](img/a.png) ![b](baram-asset:image-0.png)\n",
      SAVED,
    );
    expect(markdown).toBe("![a](baram-asset:image-0.png) b\n");
    expect(images).toEqual([{ name: "image-0.png", source: "img/a.png" }]);
  });

  it("keeps a link's own bracket live without letting the alt text complete a footnote", () => {
    expect(
      stageMarkdownImages(
        "[![^1](../../secret.png)](https://example.com/)\n\n[^1]: note\n",
        SAVED,
      ).markdown,
    ).toBe("[\\^1](https://example.com/)\n\n[^1]: note\n");
    expect(
      stageMarkdownImages("[![^x](../../s.png)][r]\n\n[r]: https://x\n", SAVED)
        .markdown,
    ).toBe("[\\^x][r]\n\n[r]: https://x\n");
  });

  it("stages an absolute path that stays inside the context and refuses one that leaves it", () => {
    // Before this change an absolute path was the only form that ever
    // embedded; inside the vault it still does.
    expect(classifyImageSource("/vault/img/a.png", IN_VAULT, KNOWN)).toEqual({
      kind: "stage",
      source: "/vault/img/a.png",
    });
    expect(
      classifyImageSource("%2Fvault%2Fimg%2Fa.png", IN_VAULT, KNOWN),
    ).toEqual({
      kind: "stage",
      source: "%2Fvault%2Fimg%2Fa.png",
    });
    // What the escapes hid is an absolute path outside the vault — judged as
    // one here, so the backend does not have to fail the export over it.
    for (const url of [
      "%2Fetc%2Fhosts",
      "/vault2/x.png",
      "/vault/../etc/hosts",
      "%2F%2Fhost%2Fx.png",
    ]) {
      expect(classifyImageSource(url, IN_VAULT, KNOWN), url).toEqual({
        kind: "refuse",
      });
    }
    const { images, markdown } = stageMarkdownImages(
      "![a](/vault/img/a.png)\n",
      SAVED,
    );
    expect(markdown).toBe("![a](baram-asset:image-0.png)\n");
    expect(images).toEqual([
      { name: "image-0.png", source: "/vault/img/a.png" },
    ]);
  });

  it("compares Windows paths without regard to case", () => {
    const scope = relativeScope("c:\\vault\\notes\\today.md", "C:\\Vault");
    expect(classifyImageSource("img/a.png", scope, KNOWN)).toEqual({
      kind: "stage",
      source: "img/a.png",
    });
    expect(
      classifyImageSource("C:\\VAULT\\img\\a.png", scope, KNOWN).kind,
    ).toBe("stage");
    expect(classifyImageSource("D:\\vault\\img\\a.png", scope, KNOWN)).toEqual({
      kind: "refuse",
    });
  });

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

  describe("an <img> tag the editor's strict parser refuses (issue 631)", () => {
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

    it("refuses such a tag by the same rule as any image, and counts a tag with no usable source", () => {
      const { images, markdown, refused } = stageMarkdownImages(
        '<img src="/etc/hosts" alt="hosts" height="1">\n\n<img alt="lost" height="1">\n\n<img src="" alt="empty">\n',
        SAVED,
      );
      expect(markdown).toBe("hosts\n\nlost\n\nempty\n");
      expect(images).toEqual([]);
      expect(refused).toBe(3);
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
      expect(stageMarkdownImages(md, SAVED)).toMatchObject({
        images: [],
        markdown: md,
        refused: 0,
      });
    });

    it("does not mistake `<img` inside another tag's attribute or a script body for an image", () => {
      const md =
        "<div title=\"<img src='missing.png'>\">\n\n<script>var s = \"<img src='x.png'>\";</script>\n\n<textarea><img src='t.png'></textarea>\n";
      expect(stageMarkdownImages(md, SAVED)).toMatchObject({
        images: [],
        markdown: md,
        refused: 0,
      });
    });

    it("edits a tag that spans lines inside a blockquote or a list by its logical text, not the prefixed source", () => {
      const quoted = '> <img\n> src="img/a.png"\n> height="1">\n';
      expect(stageMarkdownImages(quoted, SAVED)).toMatchObject({
        images: [{ name: "image-0.png", source: "img/a.png" }],
        markdown: "> ![](baram-asset:image-0.png)\n",
        refused: 0,
      });
      const listed = '- <img\n  src="img/b.png" height="1"> tail\n';
      expect(stageMarkdownImages(listed, SAVED)).toMatchObject({
        images: [{ name: "image-0.png", source: "img/b.png" }],
        markdown: "- ![](baram-asset:image-0.png) tail\n",
        refused: 0,
      });
    });

    it("reads quotes the way the HTML tokenizer does: only after `=` does a quote open a value", () => {
      // A stray quote inside an unquoted value or after a tag name is part of
      // that value, so the tag still ends at the first `>` and nothing beside
      // it is swallowed; the later tags on the same node are still found.
      const md =
        "<div>\n<img src=a\"b.png> x \" > y <img src='img/c.png' alt='C'>\n<img alt=it's src=img/d.png>\n</div>\n";
      const { images, markdown, refused } = stageMarkdownImages(md, SAVED);
      expect(markdown).toBe(
        "<div>\n![](baram-asset:image-0.png) x \" > y ![C](baram-asset:image-1.png)\n![it's](baram-asset:image-2.png)\n</div>\n",
      );
      // `a"b.png` is a file name like any other: staged, quote and all.
      expect(images).toEqual([
        { name: "image-0.png", source: 'a"b.png' },
        { name: "image-1.png", source: "img/c.png" },
        { name: "image-2.png", source: "img/d.png" },
      ]);
      expect(refused).toBe(0);
    });

    it("does not stop at an abruptly closed comment", () => {
      const { images, markdown } = stageMarkdownImages(
        "<div>\n<!--> <img src='img/b.png'>\n</div>\n",
        SAVED,
      );
      expect(markdown).toBe(
        "<div>\n<!--> ![](baram-asset:image-0.png)\n</div>\n",
      );
      expect(images).toEqual([{ name: "image-0.png", source: "img/b.png" }]);
    });

    it("leaves a tag inside a code fence or a code span of an HTML block alone: pandoc reads that as code", () => {
      const md =
        "<details>\n<summary>s</summary>\n```html\n<img src=\"img/a.png\">\n```\n`<img src='img/b.png'>` and <img src='img/c.png'>\n</details>\n";
      const tree = parseMdast(md);
      expect(tree.children.map((n) => n.type)).toEqual(["html"]);
      const { images, markdown, refused } = stageMarkdownImages(md, SAVED);
      expect(markdown).toBe(
        "<details>\n<summary>s</summary>\n```html\n<img src=\"img/a.png\">\n```\n`<img src='img/b.png'>` and ![](baram-asset:image-0.png)\n</details>\n",
      );
      expect(images).toEqual([{ name: "image-0.png", source: "img/c.png" }]);
      expect(refused).toBe(0);
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
      expect(stageMarkdownImages(md, SAVED)).toMatchObject({
        images: [],
        markdown: md,
        refused: 0,
      });
    });

    it("ends an unquoted value at whitespace or `>` as HTML does, even when it holds `=` and a quote", () => {
      // HTML reads src as `https://x.example/a="b` and ` KEEP ">` as text;
      // a scanner that let the `"` open a value swallowed that text.
      const md = '<div>\n<img src=https://x.example/a="b> KEEP ">\n</div>\n';
      const { images, markdown, refused } = stageMarkdownImages(md, SAVED);
      expect(markdown).toBe('<div>\n KEEP ">\n</div>\n');
      expect(images).toEqual([]);
      expect(refused).toBe(1);
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

    it("keeps a table cell one cell when a decoded alt holds a pipe", () => {
      const { markdown } = stageMarkdownImages(
        "| a | b |\n| - | - |\n| <img src='img/a.png' alt='p&#124;q'> | c |\n",
        SAVED,
      );
      expect(markdown).toBe(
        "| a | b |\n| - | - |\n| ![p\\|q](baram-asset:image-0.png) | c |\n",
      );
    });
  });

  it("counts what became alt text and says whether there was a context at all", () => {
    const md = "![a](img/a.png) ![b](/etc/hosts) ![c](https://x/y.png)\n";
    expect(stageMarkdownImages(md, SAVED)).toMatchObject({
      refused: 2,
      scoped: true,
    });
    expect(stageMarkdownImages(md, UNSAVED)).toMatchObject({
      refused: 3,
      scoped: false,
    });
    expect(stageMarkdownImages(md, LONE)).toMatchObject({
      refused: 3,
      scoped: false,
    });
    expect(stageMarkdownImages("text\n", SAVED)).toMatchObject({
      refused: 0,
      scoped: true,
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
      refused: 0,
    });
    expect(rewriteImageTagsAsMarkdown("plain\n")).toEqual({
      markdown: "plain\n",
      refused: 0,
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
      refused: 1,
    });
  });
});

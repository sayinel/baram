// issue 545 — the Pandoc export's image policy, on strings.
//
// What pandoc may read is decided here and enforced in Rust; these tests pin
// the string side: which destinations are kept, staged or refused, what a
// refused image is replaced with, and that the splice cannot form new syntax.
import { describe, expect, it } from "vitest";

import {
  classifyImageSource,
  relativeScope,
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
    ).toEqual({
      kind: "keep",
    });
    // A document-written placeholder would reach pandoc as a bare file name.
    expect(
      classifyImageSource("baram-asset:mermaid-1.png", IN_VAULT, KNOWN),
    ).toEqual({
      kind: "refuse",
    });
    expect(
      classifyImageSource("\tbaram-asset:mermaid-0.png", IN_VAULT, KNOWN),
    ).toEqual({
      kind: "keep",
    });
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
      'a ![A](baram-asset:image-0.png "T"){width=640px} b\n\n![](baram-asset:image-1.png){width=50%}\n\nhosts\n\n<img src="img/c.png" loading="lazy">\n',
    );
    expect(images).toEqual([
      { name: "image-0.png", source: "img/a.png" },
      { name: "image-1.png", source: "img/b.png" },
    ]);
    // The tag the editor could not represent is left alone; the refused one counted.
    expect(refused).toBe(1);
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

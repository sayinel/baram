import { Schema } from "@tiptap/pm/model";
// §5.1 Image — roundtrip + widthPercent persistence tests
import { describe, expect, test } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    image: {
      group: "block",
      atom: true,
      // ‼️ widthPixel must be here, matching the shipped node (image.ts).
      // A fixture schema missing it silently drops the attr in create() and
      // leaves the whole pixel-width branch exercised by nothing — the same
      // blind spot §294 M3 found on the video side.
      attrs: {
        src: { default: null },
        alt: { default: null },
        title: { default: null },
        widthPercent: { default: 100 },
        widthPixel: { default: undefined },
      },
    },
    // §294 fix round 3 (I5): needed by the refusal cases below — a refused
    // `<img>` tag has to land somewhere verbatim, and htmlBlock is where.
    // Without this node in the fixture a refusal would look like deletion,
    // which is the opposite of what the policy does in the real schema.
    htmlBlock: {
      group: "block",
      atom: true,
      attrs: { content: { default: "" } },
    },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    code: {},
  },
});

function roundtrip(md: string): string {
  const doc = markdownToProsemirror(md, schema);
  return prosemirrorToMarkdown(doc).trimEnd();
}

describe("Image Extension", () => {
  test("standard image roundtrip (no width)", () => {
    const input = "![alt text](image.png)";
    expect(roundtrip(input)).toBe(input);
  });

  test("image with title roundtrip", () => {
    const input = '![alt](image.png "my title")';
    expect(roundtrip(input)).toBe(input);
  });

  test("image without alt roundtrip", () => {
    const input = "![](photo.jpg)";
    expect(roundtrip(input)).toBe(input);
  });

  test("image with custom width persists as HTML img tag", () => {
    const input = '<img src="photo.jpg" alt="caption" width="60%" />';
    expect(roundtrip(input)).toBe(input);
  });

  test("image with width=25% roundtrip", () => {
    const input = '<img src="image.png" alt="small" width="25%" />';
    expect(roundtrip(input)).toBe(input);
  });

  test("image with width=100% normalizes to standard markdown", () => {
    // width=100% is the default → serializes as standard markdown
    const input = '<img src="image.png" alt="full" width="100%" />';
    const output = roundtrip(input);
    expect(output).toBe("![full](image.png)");
  });

  test("img tag without width parses correctly (default 100%)", () => {
    const input = '<img src="photo.jpg" alt="test" />';
    const output = roundtrip(input);
    // width defaults to 100 → standard markdown
    expect(output).toBe("![test](photo.jpg)");
  });

  test("PM image with widthPercent serializes to HTML img", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.image.create({
        src: "test.png",
        alt: "sized",
        widthPercent: 50,
      }),
    ]);
    const md = prosemirrorToMarkdown(doc).trimEnd();
    expect(md).toBe('<img src="test.png" alt="sized" width="50%" />');
  });

  test("PM image with widthPercent=100 serializes to standard markdown", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.image.create({
        src: "test.png",
        alt: "full",
        widthPercent: 100,
      }),
    ]);
    const md = prosemirrorToMarkdown(doc).trimEnd();
    expect(md).toBe("![full](test.png)");
  });

  test("special chars in src/alt are escaped in HTML img", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.image.create({
        src: "path/to/image.png",
        alt: "a & b",
        widthPercent: 75,
      }),
    ]);
    const md = prosemirrorToMarkdown(doc).trimEnd();
    expect(md).toBe(
      '<img src="path/to/image.png" alt="a &amp; b" width="75%" />',
    );

    // Roundtrip: HTML → PM → MD
    const doc2 = markdownToProsemirror(md, schema);
    const imgNode = doc2.firstChild!;
    expect(imgNode.attrs.alt).toBe("a & b");
    expect(imgNode.attrs.widthPercent).toBe(75);
    expect(prosemirrorToMarkdown(doc2).trimEnd()).toBe(md);
  });
});

// §294 fix round 3 (I5/C1): `<img>` and `<video>` now share one parser
// (pipeline/transformers/media-html-tag.ts), and unifying them CHANGED IMAGE
// BEHAVIOR in two ways — both from "silently lose the attribute" to
// "refuse and keep the markup verbatim", which is the policy the rest of the
// pipeline already used:
//
//  1. An attribute name outside {alt, src, title, width} used to be ignored,
//     so `<img src="a.png" loading="lazy">` became an image node and saved
//     back as `![](a.png)` — `loading` gone from the user's file.
//  2. A pixel width used to be parsed into a `widthPixel` the image node did
//     not declare, so ProseMirror dropped the key in `create()` and the tag
//     saved back as `![](a.png)` — `width="640"` gone. And a bare number
//     <= 100 was reinterpreted as a PERCENTAGE, rewriting the user's
//     `width="80"` as `width="80%"`.
//
// (1) is refused and kept verbatim, below. (2) is now RENDERED instead: the
// image node gained widthPixel and image-view draws it, so the width survives
// AND the image still draws as an image (see the pixel-width describe further
// down). Refusing (2) — which is what the first version of this fix did —
// closed the data loss but degraded `<img width="640">` to a raw HTML block,
// a regression a user notices immediately in a feature far older and far more
// used than video.
describe("unrepresentable <img> markup is preserved, not silently stripped", () => {
  function firstChildType(md: string): string {
    return markdownToProsemirror(md, schema).firstChild!.type.name;
  }

  test("an unrecognized attribute name keeps the whole tag verbatim", () => {
    const input = '<img src="a.png" loading="lazy" />';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("a percentage above 100 is preserved verbatim, not clamped", () => {
    const input = '<img src="a.png" width="150%" />';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("a single-quoted attribute is preserved verbatim", () => {
    const input = "<img src='a.png' />";
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("control: a percentage width still becomes an image node", () => {
    // The refusals above must not have swallowed the supported shape.
    const input = '<img src="a.png" width="60%" />';
    expect(firstChildType(input)).toBe("image");
    expect(roundtrip(input)).toBe(input);
  });
});

// §294 I1, image parity. The pixel width is RENDERED, not refused — image.ts
// declares widthPixel and image-view.tsx draws it, exactly as video does. The
// first version of the C-1 fix refused it instead, which closed the data loss
// (the attr used to vanish on save) but cost `<img src="a.png" width="640">`
// its rendering: it became a raw HTML block. Rendering loses nothing.
describe("a pixel width on <img> renders and survives (§294 I1)", () => {
  function firstChild(md: string) {
    return markdownToProsemirror(md, schema).firstChild!;
  }

  test("a bare number is PIXELS, kept on the node and written back unchanged", () => {
    const input = '<img src="a.png" width="640" />';
    const node = firstChild(input);
    expect(node.type.name).toBe("image");
    expect(node.attrs.widthPixel).toBe(640);
    expect(node.attrs.widthPercent).toBe(100);
    expect(roundtrip(input)).toBe(input);
  });

  test("a bare number <= 100 is pixels too — NOT reinterpreted as a percentage", () => {
    // The old heuristic turned this into widthPercent 80 and rewrote the
    // user's file as `width="80%"`.
    const input = '<img src="a.png" width="80" />';
    const node = firstChild(input);
    expect(node.type.name).toBe("image");
    expect(node.attrs.widthPixel).toBe(80);
    expect(roundtrip(input)).toBe(input);
  });

  test("alt and title ride along with a pixel width", () => {
    const input = '<img src="a.png" alt="cap" title="t" width="640" />';
    expect(roundtrip(input)).toBe(input);
  });

  // The other half of I1: the resize commit clears widthPixel by passing
  // `widthPixel: undefined`. That only discards the stale pixel width if PM
  // really resets the attr, and only helps if the markdown then carries the
  // DRAG's percentage rather than the pixel width the builder prefers.
  test("clearing widthPixel lets a resize reach the file", () => {
    const sized = schema.nodes.image.create({ src: "a.png", widthPixel: 640 });
    expect(sized.attrs.widthPixel).toBe(640);

    const resized = sized.type.create({
      ...sized.attrs,
      widthPercent: 20,
      widthPixel: undefined,
    });
    expect(resized.attrs.widthPixel).toBeUndefined();

    const doc = schema.nodes.doc.create(null, [resized]);
    expect(prosemirrorToMarkdown(doc).trimEnd()).toBe(
      '<img src="a.png" width="20%" />',
    );
  });

  test("control: without the clear, the pixel width still wins on save", () => {
    const stale = schema.nodes.image.create({
      src: "a.png",
      widthPercent: 20,
      widthPixel: 640,
    });
    const doc = schema.nodes.doc.create(null, [stale]);
    expect(prosemirrorToMarkdown(doc).trimEnd()).toBe(
      '<img src="a.png" width="640" />',
    );
  });
});

// §294 I6 for `<img>` — final-gate Important #4. The I-6 fix originally matched
// `/^<video(?=[\s/>])/i` only, and that media-type narrowing was documented
// nowhere, while `pmToMdast` writes `<img src="…" width="60%" />` into the file
// on EVERY resized image. `<img …/>` alone on a line is a CommonMark type-7
// HTML block so it round-trips — but a type-7 block cannot interrupt a
// paragraph, so the moment a word shares that line (or the blank line above it
// is deleted) the tag becomes an inline `html` mdast child, convertInlineNode
// has no passthrough for it, and the image is destroyed on the next save.
// Same mechanism as video, on the older and more-used feature.
describe("an inline <img> sharing a line is preserved, not destroyed (§294 I6)", () => {
  function firstChildType(md: string): string {
    return markdownToProsemirror(md, schema).firstChild!.type.name;
  }

  test("text on both sides of the tag", () => {
    const input = 'a <img src="x.png" /> b';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("the app-generated resize markup on a paragraph continuation line", () => {
    // The exact shape a resized image writes, one keystroke away from being
    // swallowed: a type-7 block cannot interrupt the paragraph above it.
    const input = 'text\n<img src="a.png" width="60%" />';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("two resized images on one line", () => {
    const input =
      '<img src="a.png" width="60%" /><img src="b.png" width="60%" />';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("an img and a video in the same paragraph", () => {
    // The generalized predicate counts either tag, so a mixed paragraph is
    // preserved on the strength of whichever it finds first.
    const input = 'a <img src="x.png" /> and <video src="y.mp4"></video> b';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  // The two refusal boundaries carry over from the video side unchanged: the
  // paragraph is only rebuilt when it can be rebuilt byte-for-byte.
  test("a non-text/html inline sibling refuses reconstruction", () => {
    const input = '`code` <img src="x.png" />';
    expect(firstChildType(input)).toBe("paragraph");
    expect(roundtrip(input)).not.toContain("<img");
  });

  test("an ampersand in the surrounding text refuses reconstruction", () => {
    const input = 'a &amp; b <img src="x.png" />';
    expect(firstChildType(input)).not.toBe("htmlBlock");
  });

  test("control: the tag alone on a line is still an image node, not preserved raw", () => {
    // Type-7 block html → the <img> branch of md-to-pm, unchanged by I6.
    const input = '<img src="a.png" width="60%" />';
    expect(firstChildType(input)).toBe("image");
    expect(roundtrip(input)).toBe(input);
  });

  test("control: a paragraph with no media tag is untouched", () => {
    const input = "<span>a</span>";
    expect(firstChildType(input)).not.toBe("htmlBlock");
    expect(roundtrip(input)).toBe("a");
  });

  // ‼️ The predicate keys off `src=`, not off a closing tag, and mutation
  // testing is what forced that design. Requiring `</video>` looked reasonable
  // but nothing went red when the requirement was deleted — a closing tag
  // cannot tell an ELEMENT from PROSE THAT NAMES THE TAG, and `<img>` has no
  // closing tag to require in the first place. `src=` tells them apart: it is
  // the shape the app writes and the only shape with data to lose.
  test("an unclosed tag that still carries a src is preserved", () => {
    const input = 'a <video src="x.mp4"> b';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("prose naming a tag stays an editable paragraph, not a raw html block", () => {
    // Turning this into an htmlBlock would be the same class of regression as
    // making local images invisible: the user loses editability of ordinary
    // text. The `<video>` mention is still dropped, which is the pre-existing
    // inline-html limitation and not something media preservation should fix.
    const input = "use the <video> tag for clips";
    expect(firstChildType(input)).toBe("paragraph");
    expect(roundtrip(input)).not.toContain("<video");
  });

  test("prose naming the img tag likewise stays a paragraph", () => {
    const input = "use the <img> tag for pictures";
    expect(firstChildType(input)).toBe("paragraph");
  });

  test("a src-less tag with other attributes is still prose, not media", () => {
    const input = 'a <img class="x"> b';
    expect(firstChildType(input)).toBe("paragraph");
  });
});

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
      // ‼️ No widthPixel here, matching the shipped node (image.ts). That
      // absence is what makes `<img width="640">` unrepresentable, and why the
      // shared parser refuses it instead of dropping it — see the
      // refuse-and-preserve block at the bottom of this file.
      attrs: {
        src: { default: null },
        alt: { default: null },
        title: { default: null },
        widthPercent: { default: 100 },
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
//  2. A pixel width used to be parsed into a `widthPixel` the image node does
//     not declare, so ProseMirror dropped the key in `create()` and the tag
//     saved back as `![](a.png)` — `width="640"` gone. And a bare number
//     <= 100 was reinterpreted as a PERCENTAGE, rewriting the user's
//     `width="80"` as `width="80%"`.
//
// Both now land on htmlBlock, byte-exact. The fix for (2) is a refusal rather
// than a render because image.ts has no widthPixel attr — see IMG_TAG's
// supportsPixelWidth comment in image-transformer.ts for the flip condition.
describe("unrepresentable <img> markup is preserved, not silently stripped", () => {
  function firstChildType(md: string): string {
    return markdownToProsemirror(md, schema).firstChild!.type.name;
  }

  test("an unrecognized attribute name keeps the whole tag verbatim", () => {
    const input = '<img src="a.png" loading="lazy" />';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("a pixel width keeps the whole tag verbatim", () => {
    const input = '<img src="a.png" width="640" />';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("a bare number <= 100 is NOT reinterpreted as a percentage", () => {
    const input = '<img src="a.png" width="80" />';
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

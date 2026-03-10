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
      attrs: {
        src: { default: null },
        alt: { default: null },
        title: { default: null },
        widthPercent: { default: 100 },
      },
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

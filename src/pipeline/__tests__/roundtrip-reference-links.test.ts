// issue 546 — reference-style links (`[label][ref]` + `[ref]: url`) and images
// (`![alt][ref]`) vanished at load: the converters had no case for
// `linkReference` / `imageReference` / `definition`, so the nodes were dropped
// WITH their text, and a save wrote the document without them. The editor now
// resolves references to inline links/images at its boundary (md-to-pm.ts);
// the raw parser and its other consumers (the export link policy) are
// untouched.
import type { Root } from "mdast";

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror, mdastBlocksToPmNodes } from "../md-to-pm";
import { parseMdast } from "../parse-mdast";
import { prosemirrorToMarkdown } from "../pm-to-md";
import { resolveReferenceLinks } from "../reference-links";

const editor = new Editor({ content: "", extensions: createBaramExtensions() });
const schema = editor.schema;

function roundtrip(markdown: string): string {
  const doc = markdownToProsemirror(markdown, schema);
  doc.check();
  return prosemirrorToMarkdown(doc);
}

describe("reference-style links survive a load (issue 546)", () => {
  it("keeps the label AND the destination — the issue's repro", () => {
    // Before: "see  here\n" — label and link both gone.
    expect(roundtrip("see [ref][r] here\n\n[r]: https://ok.example/\n")).toBe(
      "see [ref](https://ok.example/) here\n",
    );
  });

  it("resolves to exactly what the inline form resolves to", () => {
    const cases: [reference: string, inline: string][] = [
      // full, with a title
      [
        'see [ref][r] here\n\n[r]: https://ok.example/ "Title"\n',
        'see [ref](https://ok.example/ "Title") here\n',
      ],
      // collapsed and shortcut, sharing one definition
      [
        "[Docs][] and [docs]\n\n[docs]: https://ok.example/d\n",
        "[Docs](https://ok.example/d) and [docs](https://ok.example/d)\n",
      ],
      // identifier normalisation: case folding and collapsed inner whitespace
      [
        "[a][Foo  Bar] [b][foo bar]\n\n[FOO BAR]: https://ok.example/f\n",
        "[a](https://ok.example/f) [b](https://ok.example/f)\n",
      ],
      // non-ASCII case folding (micromark folds `É` and `é`)
      ["[x][É]\n\n[é]: https://ok.example/e\n", "[x](https://ok.example/e)\n"],
      // definition BEFORE its reference
      ["[r]: https://ok.example/\n\n[l][r]\n", "[l](https://ok.example/)\n"],
      // a mark around the whole reference, and a mark inside its label (the
      // serializer writes the link outside the bold either way)
      [
        "**[b][r]** and [**c**][r]\n\n[r]: https://ok.example/\n",
        "[**b**](https://ok.example/) and [**c**](https://ok.example/)\n",
      ],
    ];
    for (const [reference, inline] of cases) {
      expect(roundtrip(reference), reference).toBe(inline);
      // and the inline form is a fixed point, so the two really agree
      expect(roundtrip(inline), inline).toBe(inline);
    }
  });

  it("a code span inside the label resolves to the same (schema-invalid) node the inline form gives", () => {
    // `code` excludes every other mark in this schema, so a link around a code
    // span is not representable — for `[\`code\`](url)` either; not this
    // pass's doing. The two forms must still agree.
    const reference = markdownToProsemirror(
      "[`code`][r]\n\n[r]: https://ok.example/\n",
      schema,
    );
    const inline = markdownToProsemirror(
      "[`code`](https://ok.example/)\n",
      schema,
    );
    expect(reference.toJSON()).toEqual(inline.toJSON());
  });

  it("an ordered list keeps its numbering when a middle item held only a definition", () => {
    const doc = markdownToProsemirror(
      "1. one\n2. [r]: https://ok.example/\n3. three [l][r]\n",
      schema,
    );
    doc.check();
    const list = doc.firstChild!;
    expect(list.type.name).toBe("orderedList");
    expect(list.childCount).toBe(3);
    expect(list.child(2).textContent).toBe("three l");
    expect(prosemirrorToMarkdown(doc)).toContain(
      "3. three [l](https://ok.example/)",
    );
  });

  it("takes the FIRST of duplicate definitions, as CommonMark does", () => {
    expect(
      roundtrip(
        "[l][r]\n\n[r]: https://first.example/\n[r]: https://second.example/\n",
      ),
    ).toBe("[l](https://first.example/)\n");
    // …also when the duplicates sit in different containers. The block quote
    // that held only the definition keeps one empty paragraph (next test).
    expect(
      roundtrip(
        "> [r]: https://first.example/\n\n[l][r]\n\n[r]: https://second.example/\n",
      ),
    ).toBe(">\n\n[l](https://first.example/)\n");
  });

  it("removes the definition without leaving a phantom empty paragraph", () => {
    // enrichWithEmptyParagraphs measures the gaps between top-level blocks;
    // the definition's own lines must not read as user-authored blank lines.
    expect(roundtrip("one [l][r]\n\n[r]: https://ok.example/\n\ntwo\n")).toBe(
      "one [l](https://ok.example/)\n\ntwo\n",
    );
    // a deliberate extra blank line around it is still honoured
    expect(
      roundtrip("one [l][r]\n\n\n\n[r]: https://ok.example/\n\ntwo\n"),
    ).toBe("one [l](https://ok.example/)\n\n\n\ntwo\n");
  });

  it("resolves references inside containers, and a definition inside one applies document-wide", () => {
    expect(
      roundtrip(
        "> quoted [l][r]\n\n- item [m][r]\n\n[r]: https://ok.example/\n",
      ),
    ).toBe(
      "> quoted [l](https://ok.example/)\n\n- item [m](https://ok.example/)\n",
    );
    expect(roundtrip("> [r]: https://ok.example/\n> quoted [l][r]\n")).toBe(
      "> quoted [l](https://ok.example/)\n",
    );
  });

  it("a container that held only a definition keeps one empty paragraph — valid, not deleted", () => {
    // blockquote (block+), list item (paragraph block*): the schema forbids an
    // empty container, and deleting it would renumber lists / orphan footnotes.
    for (const md of [
      "> [r]: https://ok.example/\n\n[l][r]\n",
      "- [r]: https://ok.example/\n- item [l][r]\n",
      "1. [r]: https://ok.example/\n2. item [l][r]\n",
      "note [l][r] [^1]\n\n[^1]: [r]: https://ok.example/\n",
    ]) {
      const doc = markdownToProsemirror(md, schema);
      expect(() => doc.check(), md).not.toThrow();
      expect(prosemirrorToMarkdown(doc), md).toContain(
        "[l](https://ok.example/)",
      );
    }
  });

  it("a definition nobody references, or a definition-only document, still gives a valid document", () => {
    expect(roundtrip("text\n\n[unused]: https://ok.example/\n")).toBe("text\n");
    const doc = markdownToProsemirror("[only]: https://ok.example/\n", schema);
    expect(() => doc.check()).not.toThrow();
    expect(prosemirrorToMarkdown(doc)).toBe("");
  });

  it("leaves an undefined reference as the literal text the parser already makes of it", () => {
    // (The serializer escapes literal brackets on the way out — `\[x]\[nope]`
    // — as it does for any bracketed text; that is not this pass's doing.)
    const doc = markdownToProsemirror("see [x][nope] here\n", schema);
    doc.check();
    expect(doc.textContent).toBe("see [x][nope] here");
  });

  it("does not touch footnotes, and resolves a reference link inside a footnote definition", () => {
    expect(roundtrip("text[^1]\n\n[^1]: the note\n")).toBe(
      "text[^1]\n\n[^1]: the note\n",
    );
    expect(
      roundtrip("text[^1]\n\n[^1]: see [l][r]\n\n[r]: https://ok.example/\n"),
    ).toBe("text[^1]\n\n[^1]: see [l](https://ok.example/)\n");
  });
});

describe("reference-style images (issue 546)", () => {
  it("a standalone reference image becomes a real block image with src, alt and title", () => {
    const doc = markdownToProsemirror(
      '![alt text][img]\n\n[img]: /pics/a.png "A picture"\n',
      schema,
    );
    doc.check();
    const image = doc.firstChild!;
    expect(image.type.name).toBe("image");
    expect(image.attrs).toMatchObject({
      alt: "alt text",
      src: "/pics/a.png",
      title: "A picture",
    });
    expect(prosemirrorToMarkdown(doc)).toBe(
      '![alt text](/pics/a.png "A picture")\n',
    );
  });

  it("an image reference mixed into text behaves exactly like the inline image it denotes", () => {
    // The image node is block-only (issue 509 owns the inline-image trade-off);
    // a reference image can do no better and must do no worse than `![alt](url)`.
    const reference = markdownToProsemirror(
      "before ![alt][img] after\n\n[img]: /pics/a.png\n",
      schema,
    );
    const inline = markdownToProsemirror(
      "before ![alt](/pics/a.png) after\n",
      schema,
    );
    expect(reference.toJSON()).toEqual(inline.toJSON());
  });

  it("a reference image inside a reference link label resolves to exactly what the inline form resolves to", () => {
    // The badge idiom. The image node is block-only (issue 509), so BOTH forms
    // drop the outer link and keep the image — they must drop the same thing.
    const reference = markdownToProsemirror(
      "[![CI][badge]][ci]\n\n[badge]: https://img.example/b.svg\n[ci]: https://ci.example/\n",
      schema,
    );
    const inline = markdownToProsemirror(
      "[![CI](https://img.example/b.svg)](https://ci.example/)\n",
      schema,
    );
    expect(reference.toJSON()).toEqual(inline.toJSON());
    // the badge's own URL really survives — the bug degraded it to alt text.
    // What happens to the OUTER link is issue 509's to decide, so it is not pinned here.
    const srcs: string[] = [];
    reference.descendants((node) => {
      if (node.type.name === "image")
        srcs.push((node.attrs as { src: string }).src);
    });
    expect(srcs).toEqual(["https://img.example/b.svg"]);
  });

  it("resolves references nested any depth inside a label, not just at its top level", () => {
    const reference = markdownToProsemirror(
      "[text *![alt][i]* more][r]\n\n[i]: /p.png\n[r]: https://ok.example/\n",
      schema,
    );
    const inline = markdownToProsemirror(
      "[text *![alt](/p.png)* more](https://ok.example/)\n",
      schema,
    );
    expect(reference.toJSON()).toEqual(inline.toJSON());
  });
});

describe("the resolution runs at the editor boundary only", () => {
  const md = "see [ref][r] here\n\n[r]: https://ok.example/\n";

  it("parseMdast still exposes definition and linkReference nodes for its other consumers", () => {
    // export-markdown-links.ts parses with parseMdast and reads BOTH node
    // types (its duplicate-definition policy differs from the editor's).
    const root = parseMdast(md);
    const types = new Set<string>();
    const walk = (n: { children?: unknown[]; type: string }) => {
      types.add(n.type);
      for (const c of n.children ?? [])
        walk(c as { children?: unknown[]; type: string });
    };
    walk(root);
    expect(types.has("linkReference")).toBe(true);
    expect(types.has("definition")).toBe(true);
    const img = parseMdast("![a][i]\n\n[i]: /p.png\n");
    expect(img.children[0]?.type).toBe("paragraph");
    expect(
      (img.children[0] as { children: { type: string }[] }).children[0]?.type,
    ).toBe("imageReference");
  });

  it("the progressive path (mdastBlocksToPmNodes) resolves references too", () => {
    // load-tab-content.ts and use-source-mode.ts hand the FULL root to this
    // entry point after parseMdastAsync; the definition must be visible to it.
    const nodes = mdastBlocksToPmNodes(parseMdast(md), schema);
    const doc = schema.nodes.doc.create(null, nodes);
    doc.check();
    expect(prosemirrorToMarkdown(doc)).toBe(
      "see [ref](https://ok.example/) here\n",
    );
  });

  it("converting the same root twice is idempotent (large documents are converted once per schema)", () => {
    // load-tab-content.ts may convert one root for the main schema and again
    // for a keep-alive editor's schema; the second pass must see the resolved
    // tree and change nothing.
    const root = parseMdast(md);
    const first = mdastBlocksToPmNodes(root, schema).map((n) => n.toJSON());
    const second = mdastBlocksToPmNodes(root, schema).map((n) => n.toJSON());
    expect(second).toEqual(first);
    expect(resolveReferenceLinks(root)).toBe(root);
    expect(mdastBlocksToPmNodes(root, schema).map((n) => n.toJSON())).toEqual(
      first,
    );
  });

  it("a hand-built reference without any definition keeps its text (defensive; the parser never emits one)", () => {
    const root: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "see " },
            {
              type: "linkReference",
              identifier: "nope",
              referenceType: "full",
              children: [{ type: "text", value: "label" }],
            },
            { type: "text", value: " and " },
            {
              type: "imageReference",
              identifier: "nope",
              referenceType: "full",
              alt: "picture",
            },
          ],
        },
      ],
    };
    resolveReferenceLinks(root);
    const doc = schema.nodes.doc.create(
      null,
      mdastBlocksToPmNodes(root, schema),
    );
    doc.check();
    expect(doc.textContent).toBe("see label and picture");
  });

  it("a hand-built reference without a definition still resolves the defined references inside its label", () => {
    // Defensive only, like the test above: micromark degrades the whole label
    // to literal text when the OUTER identifier is undefined, so it never
    // builds this shape. The pass must still not strand what it is handed.
    const root: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "linkReference",
              identifier: "nope",
              referenceType: "full",
              children: [
                { type: "text", value: "x " },
                {
                  type: "imageReference",
                  identifier: "i",
                  referenceType: "full",
                  alt: "pic",
                },
              ],
            },
          ],
        },
        {
          type: "definition",
          identifier: "i",
          label: "i",
          url: "/p.png",
          title: null,
        },
      ],
    };
    resolveReferenceLinks(root);
    const label = root.children[0] as {
      children: { type: string; url?: string }[];
    };
    expect(label.children.map((n) => n.type)).toEqual(["text", "image"]);
    expect(label.children[1].url).toBe("/p.png");
  });
});

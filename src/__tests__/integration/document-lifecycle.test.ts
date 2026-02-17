// Integration: Document Lifecycle — MD open → PM convert → edit simulation → MD save
import { describe, it, expect } from "vitest";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import {
  FIXTURE_SIMPLE,
  FIXTURE_RICH,
  FIXTURE_LONG,
  createTestSchema,
} from "./fixtures";

const schema = createTestSchema();

function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

describe("Integration: Document Lifecycle", () => {
  it("full pipeline roundtrip preserves rich content", () => {
    const doc = markdownToProsemirror(FIXTURE_RICH, schema);
    const output = prosemirrorToMarkdown(doc);

    // Frontmatter preserved
    expect(output).toContain("---\ntitle: Test Document");
    expect(output).toContain("tags:");
    expect(output).toContain("  - test");
    expect(output).toContain("  - integration");

    // Math preserved
    expect(output).toContain("$E = mc^2$");
    expect(output).toContain("$$\n\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$");

    // Code block preserved
    expect(output).toContain("```typescript");
    expect(output).toContain("const x: number = 42;");

    // Table preserved
    expect(output).toContain("Name");
    expect(output).toContain("Value");
    expect(output).toContain("alpha");
    expect(output).toContain("beta");

    // Stable roundtrip: second pass identical to first
    expect(roundtrip(output)).toBe(output);
  });

  it("edit simulation — inserting a paragraph node into PM doc", () => {
    const doc = markdownToProsemirror(FIXTURE_SIMPLE, schema);

    // Insert a new paragraph after the first child (heading)
    const newParagraph = schema.nodes.paragraph.create(
      null,
      schema.text("Inserted paragraph."),
    );

    const children: import("@tiptap/pm/model").Node[] = [];
    doc.forEach((child) => children.push(child));

    // Insert after first child
    const newChildren = [children[0], newParagraph, ...children.slice(1)];
    const newDoc = schema.nodes.doc.create(null, newChildren);

    const output = prosemirrorToMarkdown(newDoc);
    expect(output).toContain("Inserted paragraph.");
    expect(output).toContain("# Hello World");
    expect(output).toContain("**bold**");
  });

  it("empty document handling", () => {
    const doc = markdownToProsemirror("", schema);
    const output = prosemirrorToMarkdown(doc);

    // Empty markdown produces a valid PM doc (may have 0 children)
    expect(doc.type.name).toBe("doc");
    expect(typeof output).toBe("string");

    // Roundtrip is stable
    if (output.trim().length > 0) {
      const doc2 = markdownToProsemirror(output, schema);
      const output2 = prosemirrorToMarkdown(doc2);
      expect(output2).toBe(output);
    }
  });

  it("large document integrity — block count preserved on roundtrip", () => {
    const doc = markdownToProsemirror(FIXTURE_LONG, schema);
    const output = prosemirrorToMarkdown(doc);

    // Should contain all 20 sections
    for (let i = 1; i <= 20; i++) {
      expect(output).toContain(`## Section ${i}`);
      expect(output).toContain(`Paragraph ${i}`);
    }

    // Should contain table and code block
    expect(output).toContain("Col A");
    expect(output).toContain("```javascript");

    // Stable roundtrip
    expect(roundtrip(output)).toBe(output);
  });

  it("frontmatter fields preserved through roundtrip", () => {
    const input = `---
title: My Document
author: Test User
date: 2026-02-17
tags:
  - tag1
  - tag2
---

# Title

Content here
`;
    const output = roundtrip(input);

    expect(output).toContain("title: My Document");
    expect(output).toContain("author: Test User");
    expect(output).toContain("date: 2026-02-17");
    expect(output).toContain("  - tag1");
    expect(output).toContain("  - tag2");
    expect(output).toContain("# Title");
    expect(output).toContain("Content here");
  });
});

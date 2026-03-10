// Integration: Source Mode Toggle — WYSIWYG ↔ Source mode content preservation
import { beforeEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { useEditorStore } from "../../stores/editor-store";
import { createTestSchema, FIXTURE_RICH } from "./fixtures";

const schema = createTestSchema();

describe("Integration: Source Mode Toggle", () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeTabId: null,
      tabs: [],
      isSourceMode: false,
    });
  });

  it("WYSIWYG → Source → WYSIWYG preserves content", () => {
    // Simulate: WYSIWYG has PM doc from original MD
    const doc1 = markdownToProsemirror(FIXTURE_RICH, schema);

    // Toggle to Source: serialize PM → MD
    const sourceText = prosemirrorToMarkdown(doc1);

    // Toggle back to WYSIWYG: parse MD → PM → serialize again
    const doc2 = markdownToProsemirror(sourceText, schema);
    const finalText = prosemirrorToMarkdown(doc2);

    // Content should be stable after round-trip through source mode
    expect(finalText).toBe(sourceText);
  });

  it("source edit then WYSIWYG restore reflects changes", () => {
    const original = "# Original Title\n\nOriginal content.\n";
    const doc = markdownToProsemirror(original, schema);
    const sourceText = prosemirrorToMarkdown(doc);

    // User edits source text (simulated)
    const editedSource = sourceText.replace("Original Title", "Modified Title");

    // Parse back to PM
    const editedDoc = markdownToProsemirror(editedSource, schema);
    const result = prosemirrorToMarkdown(editedDoc);

    expect(result).toContain("# Modified Title");
    expect(result).toContain("Original content.");
  });

  it("math block preserved through toggle cycle", () => {
    const mathMD = "$$\n\\int_0^\\infty e^{-x} dx = 1\n$$\n";
    const doc = markdownToProsemirror(mathMD, schema);
    const source = prosemirrorToMarkdown(doc);
    const doc2 = markdownToProsemirror(source, schema);
    const result = prosemirrorToMarkdown(doc2);

    expect(result).toBe(source);
    expect(result).toContain("$$\n\\int_0^\\infty e^{-x} dx = 1\n$$");
  });

  it("frontmatter preserved through toggle cycle", () => {
    const fmMD = `---
title: Test
date: 2026-02-17
---

# Content

Text here
`;
    const doc = markdownToProsemirror(fmMD, schema);
    const source = prosemirrorToMarkdown(doc);
    const doc2 = markdownToProsemirror(source, schema);
    const result = prosemirrorToMarkdown(doc2);

    expect(result).toBe(source);
    expect(result).toContain("title: Test");
    expect(result).toContain("date: 2026-02-17");
  });

  it("store state synchronizes with source mode toggle", () => {
    const { toggleSourceMode } = useEditorStore.getState();

    expect(useEditorStore.getState().isSourceMode).toBe(false);

    toggleSourceMode();
    expect(useEditorStore.getState().isSourceMode).toBe(true);

    useEditorStore.getState().toggleSourceMode();
    expect(useEditorStore.getState().isSourceMode).toBe(false);
  });
});

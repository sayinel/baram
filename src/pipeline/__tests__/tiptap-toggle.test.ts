/**
 * Reproduce the exact Source ↔ WYSIWYG toggle cycle using the REAL Tiptap editor.
 * This uses the actual Baram extensions schema — not a manual schema.
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

function createTestEditor(): Editor {
  return new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
}

describe("Real Tiptap editor toggle cycle", () => {
  it("setContent round-trip preserves simple paragraphs", () => {
    const editor = createTestEditor();
    const input = "Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5\n";

    // Simulate: load markdown into editor
    const doc = markdownToProsemirror(input, editor.schema);
    editor.commands.setContent(doc.toJSON());

    // Read back from editor
    const md = prosemirrorToMarkdown(editor.state.doc);
    expect(md).toBe(input);

    editor.destroy();
  });

  it("full toggle cycle: WYSIWYG → Source → WYSIWYG preserves content", () => {
    const editor = createTestEditor();
    const input = "Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5\n";

    // Initial load
    const doc0 = markdownToProsemirror(input, editor.schema);
    editor.commands.setContent(doc0.toJSON());

    // Cycle 1: WYSIWYG → Source
    const md1 = prosemirrorToMarkdown(editor.state.doc);

    // Cycle 1: Source → WYSIWYG
    const doc1 = markdownToProsemirror(md1, editor.schema);
    editor.commands.setContent(doc1.toJSON());

    // Read back
    const md1After = prosemirrorToMarkdown(editor.state.doc);

    console.log("Input:      ", JSON.stringify(input));
    console.log("After cycle:", JSON.stringify(md1After));
    console.log("Input lines:", input.split("\n").length, "After lines:", md1After.split("\n").length);
    console.log("Input childCount:", doc0.childCount, "After childCount:", editor.state.doc.childCount);

    expect(md1After).toBe(input);

    editor.destroy();
  });

  it("5 toggle cycles should not lose content", () => {
    const editor = createTestEditor();
    const input = "Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5\n";

    // Initial load
    const doc0 = markdownToProsemirror(input, editor.schema);
    editor.commands.setContent(doc0.toJSON());

    for (let cycle = 0; cycle < 5; cycle++) {
      // WYSIWYG → Source
      const md = prosemirrorToMarkdown(editor.state.doc);
      // Source → WYSIWYG
      const newDoc = markdownToProsemirror(md, editor.schema);
      editor.commands.setContent(newDoc.toJSON());

      const mdAfter = prosemirrorToMarkdown(editor.state.doc);
      console.log(`Cycle ${cycle + 1}: childCount=${editor.state.doc.childCount}, lines=${mdAfter.split("\\n").length}, length=${mdAfter.length}`);

      if (mdAfter !== input) {
        console.log("  CONTENT CHANGED!");
        console.log("  Expected:", JSON.stringify(input));
        console.log("  Got:     ", JSON.stringify(mdAfter));
      }
    }

    const finalMd = prosemirrorToMarkdown(editor.state.doc);
    expect(finalMd).toBe(input);
    expect(editor.state.doc.childCount).toBe(doc0.childCount);

    editor.destroy();
  });

  it("heading + paragraphs toggle cycles", () => {
    const editor = createTestEditor();
    const input = "# Title\n\nParagraph 1\n\nParagraph 2\n\nParagraph 3\n";

    const doc0 = markdownToProsemirror(input, editor.schema);
    editor.commands.setContent(doc0.toJSON());

    for (let cycle = 0; cycle < 5; cycle++) {
      const md = prosemirrorToMarkdown(editor.state.doc);
      const newDoc = markdownToProsemirror(md, editor.schema);
      editor.commands.setContent(newDoc.toJSON());
    }

    const finalMd = prosemirrorToMarkdown(editor.state.doc);
    expect(finalMd).toBe(input);

    editor.destroy();
  });

  it("mixed content toggle cycles", () => {
    const editor = createTestEditor();
    const input = [
      "# Title",
      "",
      "A paragraph with **bold** and *italic*.",
      "",
      "> A blockquote",
      "",
      "- Item 1",
      "- Item 2",
      "",
      "```javascript",
      "const x = 1;",
      "```",
      "",
    ].join("\n");

    const doc0 = markdownToProsemirror(input, editor.schema);
    editor.commands.setContent(doc0.toJSON());

    for (let cycle = 0; cycle < 5; cycle++) {
      const md = prosemirrorToMarkdown(editor.state.doc);
      const newDoc = markdownToProsemirror(md, editor.schema);
      editor.commands.setContent(newDoc.toJSON());

      if (md !== input) {
        console.log(`Cycle ${cycle + 1} DIVERGED:`);
        console.log("  Expected:", JSON.stringify(input));
        console.log("  Got:     ", JSON.stringify(md));
        break;
      }
    }

    const finalMd = prosemirrorToMarkdown(editor.state.doc);
    expect(finalMd).toBe(input);

    editor.destroy();
  });
});

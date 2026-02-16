// §5.1 + §3.3 Syntax Reveal — expansion / collapse integration tests
// Tests that the SyntaxReveal plugin inserts/removes markdown delimiters
// when the cursor enters/exits a mark or link range.
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";

function createEditor(): Editor {
  return new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
}

/** Load markdown into editor via the pipeline */
function loadMarkdown(editor: Editor, md: string): void {
  const doc = markdownToProsemirror(md, editor.schema);
  editor.commands.setContent(doc.toJSON());
}

/**
 * Move cursor to a position that clears the cursorAtDocChange guard,
 * then move to the target position. This two-step sequence ensures
 * the syntax-reveal plugin's expansion checks actually run.
 */
function moveCursorTo(editor: Editor, guardPos: number, targetPos: number): void {
  editor.commands.setTextSelection(guardPos);
  editor.commands.setTextSelection(targetPos);
}

describe("Syntax Reveal (§5.1)", () => {
  describe("Mark expansion", () => {
    it("bold: cursor entering inserts ** delimiters", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello **world** end\n");
      // "Hello " (pos 1-7), "world" bold (pos 7-12), " end" (pos 12-16)
      moveCursorTo(editor, 2, 9);

      expect(editor.state.doc.textContent).toContain("**world**");
      editor.destroy();
    });

    it("italic: cursor entering inserts * delimiters", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello *world* end\n");
      moveCursorTo(editor, 2, 9);

      expect(editor.state.doc.textContent).toContain("*world*");
      // Ensure single * not double **
      expect(editor.state.doc.textContent).not.toContain("**");
      editor.destroy();
    });

    it("code: cursor entering inserts ` delimiters", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello `world` end\n");
      moveCursorTo(editor, 2, 9);

      expect(editor.state.doc.textContent).toContain("`world`");
      editor.destroy();
    });

    it("strike: cursor entering inserts ~~ delimiters", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello ~~world~~ end\n");
      moveCursorTo(editor, 2, 9);

      expect(editor.state.doc.textContent).toContain("~~world~~");
      editor.destroy();
    });
  });

  describe("Link expansion", () => {
    it("cursor entering link inserts [text](url) syntax", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello [world](https://example.com) end\n");
      moveCursorTo(editor, 2, 9);

      expect(editor.state.doc.textContent).toContain("[world](https://example.com)");
      editor.destroy();
    });
  });

  describe("Collapse", () => {
    it("cursor exiting expanded bold restores mark", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello **world** end\n");

      // Step 1: expand
      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain("**world**");

      // Step 2: move cursor out (triggers collapse via appendTransaction)
      editor.commands.setTextSelection(2);
      expect(editor.state.doc.textContent).not.toContain("**");
      expect(editor.state.doc.textContent).toContain("world");

      // Verify bold mark is restored
      const para = editor.state.doc.firstChild!;
      let hasBold = false;
      para.descendants((child) => {
        if (child.marks.some((m) => m.type.name === "bold")) {
          hasBold = true;
        }
      });
      expect(hasBold).toBe(true);

      editor.destroy();
    });

    it("cursor exiting expanded link restores link mark", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello [world](https://example.com) end\n");

      // Expand
      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain("[world](https://example.com)");

      // Collapse
      editor.commands.setTextSelection(2);
      expect(editor.state.doc.textContent).not.toContain("[world]");

      // Verify link mark restored
      const para = editor.state.doc.firstChild!;
      let hasLink = false;
      para.descendants((child) => {
        if (child.marks.some((m) => m.type.name === "link")) {
          hasLink = true;
        }
      });
      expect(hasLink).toBe(true);

      editor.destroy();
    });
  });

  describe("No expansion", () => {
    it("cursor on non-marked text produces no delimiters", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello **world** end\n");
      // Move to "Hello" area (no marks)
      moveCursorTo(editor, 3, 4);

      expect(editor.state.doc.textContent).toBe("Hello world end");
      editor.destroy();
    });

    it("empty document produces no errors", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello world\n");
      moveCursorTo(editor, 2, 5);

      expect(editor.state.doc.textContent).toBe("Hello world");
      editor.destroy();
    });
  });
});

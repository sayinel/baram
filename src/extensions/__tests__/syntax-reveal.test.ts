import { Editor } from "@tiptap/core";
// §5.1 + §3.3 Syntax Reveal — expansion / collapse integration tests
// Tests that the SyntaxReveal plugin inserts/removes markdown delimiters
// when the cursor enters/exits a mark or link range.
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { forceCollapseSyntaxReveal } from "../plugins/syntax-reveal";

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
function moveCursorTo(
  editor: Editor,
  guardPos: number,
  targetPos: number,
): void {
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

      expect(editor.state.doc.textContent).toContain(
        "[world](https://example.com)",
      );
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
      expect(editor.state.doc.textContent).toContain(
        "[world](https://example.com)",
      );

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

  // §5.1 source-mode toggle calls forceCollapseSyntaxReveal before serializing.
  // It must collapse the literal delimiters back to a mark (no data loss) AND
  // preserve the caret's logical position inside the content — without an
  // explicit cursorTarget, ProseMirror's default mapping pushes the caret to
  // the END of the collapsed mark, which the user observed as cursor drift to
  // after the bold (and then literal **구문** corruption on the next round-trip).
  describe("forceCollapse preserves caret (source-mode toggle)", () => {
    it("bold: caret inside content stays inside after force-collapse", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello **world** end\n");
      // "Hello " = 1-7, "world" bold = 7-12, " end" = 12-16.
      // Move caret inside "world" (pos 9 = wo|rld) → plugin expands to **world**.
      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain("**world**");

      forceCollapseSyntaxReveal(editor.view);

      // No data loss: literal delimiters gone, bold mark restored.
      expect(editor.state.doc.textContent).toBe("Hello world end");
      const bold = editor.state.doc
        .nodeAt(7)
        ?.marks.some((m) => m.type.name === "bold");
      expect(bold).toBe(true);
      // Caret preserved inside "world" (pos 9), NOT pushed to after the bold (12).
      expect(editor.state.selection.from).toBe(9);
      editor.destroy();
    });

    it("bold: caret at trailing boundary collapses to after the mark", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello **world** end\n");
      moveCursorTo(editor, 2, 9); // expand → "Hello **world** end"
      // Place caret just after the closing ** (trailing boundary → stays expanded).
      // textContent "Hello **world** end": "**world**" at index 6, len 9 →
      // doc position after it = 6 + 9 + 1(content offset) = 16.
      editor.commands.setTextSelection(16);

      forceCollapseSyntaxReveal(editor.view);

      expect(editor.state.doc.textContent).toBe("Hello world end");
      // Bold "world" ends at 12 — caret should land right after it (12), not inside.
      expect(editor.state.selection.from).toBe(12);
      editor.destroy();
    });
  });
});

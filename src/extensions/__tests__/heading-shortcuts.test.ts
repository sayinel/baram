// §5.1 Heading shortcuts — increaseHeadingLevel / decreaseHeadingLevel / toggleHeading
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { createBaramExtensions } from "../../extensions";

function createEditor(content: string): Editor {
  return new Editor({
    extensions: createBaramExtensions(),
    content,
  });
}

describe("Heading Shortcuts (§5.1)", () => {
  describe("increaseHeadingLevel (Mod+=)", () => {
    it("paragraph → H6", () => {
      const editor = createEditor("<p>Hello</p>");
      editor.commands.setTextSelection(1);
      const ok = editor.commands.increaseHeadingLevel();
      expect(ok).toBe(true);
      const node = editor.state.doc.firstChild!;
      expect(node.type.name).toBe("heading");
      expect(node.attrs.level).toBe(6);
      editor.destroy();
    });

    it("H6 → H5", () => {
      const editor = createEditor("<h6>Hello</h6>");
      editor.commands.setTextSelection(1);
      const ok = editor.commands.increaseHeadingLevel();
      expect(ok).toBe(true);
      const node = editor.state.doc.firstChild!;
      expect(node.type.name).toBe("heading");
      expect(node.attrs.level).toBe(5);
      editor.destroy();
    });

    it("H3 → H2", () => {
      const editor = createEditor("<h3>Hello</h3>");
      editor.commands.setTextSelection(1);
      const ok = editor.commands.increaseHeadingLevel();
      expect(ok).toBe(true);
      const node = editor.state.doc.firstChild!;
      expect(node.type.name).toBe("heading");
      expect(node.attrs.level).toBe(2);
      editor.destroy();
    });

    it("H1 → no change (already highest)", () => {
      const editor = createEditor("<h1>Hello</h1>");
      editor.commands.setTextSelection(1);
      const ok = editor.commands.increaseHeadingLevel();
      expect(ok).toBe(false);
      const node = editor.state.doc.firstChild!;
      expect(node.type.name).toBe("heading");
      expect(node.attrs.level).toBe(1);
      editor.destroy();
    });
  });

  describe("decreaseHeadingLevel (Mod+-)", () => {
    it("H1 → H2", () => {
      const editor = createEditor("<h1>Hello</h1>");
      editor.commands.setTextSelection(1);
      const ok = editor.commands.decreaseHeadingLevel();
      expect(ok).toBe(true);
      const node = editor.state.doc.firstChild!;
      expect(node.type.name).toBe("heading");
      expect(node.attrs.level).toBe(2);
      editor.destroy();
    });

    it("H5 → H6", () => {
      const editor = createEditor("<h5>Hello</h5>");
      editor.commands.setTextSelection(1);
      const ok = editor.commands.decreaseHeadingLevel();
      expect(ok).toBe(true);
      const node = editor.state.doc.firstChild!;
      expect(node.type.name).toBe("heading");
      expect(node.attrs.level).toBe(6);
      editor.destroy();
    });

    it("H6 → paragraph", () => {
      const editor = createEditor("<h6>Hello</h6>");
      editor.commands.setTextSelection(1);
      const ok = editor.commands.decreaseHeadingLevel();
      expect(ok).toBe(true);
      const node = editor.state.doc.firstChild!;
      expect(node.type.name).toBe("paragraph");
      editor.destroy();
    });

    it("paragraph → no change (already lowest)", () => {
      const editor = createEditor("<p>Hello</p>");
      editor.commands.setTextSelection(1);
      const ok = editor.commands.decreaseHeadingLevel();
      expect(ok).toBe(false);
      const node = editor.state.doc.firstChild!;
      expect(node.type.name).toBe("paragraph");
      editor.destroy();
    });
  });

  describe("toggleHeading (Mod-1 ~ Mod-6)", () => {
    it.each([1, 2, 3, 4, 5, 6])("sets heading level %i from paragraph", (level) => {
      const editor = createEditor("<p>Hello</p>");
      editor.commands.setTextSelection(1);
      editor.commands.toggleHeading({ level });
      const node = editor.state.doc.firstChild!;
      expect(node.type.name).toBe("heading");
      expect(node.attrs.level).toBe(level);
      editor.destroy();
    });

    it("toggles same level back to paragraph", () => {
      const editor = createEditor("<h2>Hello</h2>");
      editor.commands.setTextSelection(1);
      editor.commands.toggleHeading({ level: 2 });
      const node = editor.state.doc.firstChild!;
      expect(node.type.name).toBe("paragraph");
      editor.destroy();
    });
  });
});

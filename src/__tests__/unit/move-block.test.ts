import { describe, expect, it } from "vitest";

import { moveBlock } from "../../utils/editor/move-block";
import { makeTestEditor } from "../helpers/make-test-editor";

function texts(editor: ReturnType<typeof makeTestEditor>): string[] {
  const out: string[] = [];
  editor.state.doc.forEach((n) => out.push(n.textContent));
  return out;
}

describe("moveBlock", () => {
  it("moves a block down past the next block", () => {
    const editor = makeTestEditor("<p>A</p><p>B</p><p>C</p>");
    // pos 0 = block A. Target = position after C (end of doc).
    const cEnd = editor.state.doc.content.size;
    expect(moveBlock(editor, 0, cEnd)).toBe(true);
    expect(texts(editor)).toEqual(["B", "C", "A"]);
    editor.destroy();
  });

  it("moves a block up", () => {
    const editor = makeTestEditor("<p>A</p><p>B</p><p>C</p>");
    // move C (last block) to the very start (pos 0)
    const cStart =
      editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize;
    expect(moveBlock(editor, cStart, 0)).toBe(true);
    expect(texts(editor)).toEqual(["C", "A", "B"]);
    editor.destroy();
  });

  it("is a no-op when dropping within the source's own range", () => {
    const editor = makeTestEditor("<p>A</p><p>B</p>");
    expect(moveBlock(editor, 0, 1)).toBe(false);
    editor.destroy();
  });
});

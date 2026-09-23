// §5.1 Horizontal rule — where the caret lands after one is inserted.
//
// Measured defect: with content after the rule, the caret went to the end of
// the DOCUMENT. After the insert the selection sits between blocks, whose
// parent is the doc, so `$to.end()` — used as the place to look for a cursor —
// was the end of the whole document.
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../index";

let editor: Editor | null = null;
let host: HTMLElement | null = null;

function create(html: string, caret: number): Editor {
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    content: html,
    element: host,
    extensions: createBaramExtensions(),
  });
  editor.commands.setTextSelection(caret);
  return editor;
}

/** The textblock the caret is in, and the caret's offset inside it. */
function caretAt(): { offset: number; text: string } {
  const { $from } = editor!.state.selection;
  return { offset: $from.parentOffset, text: $from.parent.textContent };
}

/**
 * Types `---` the way `task-input-rules.test.ts` does: insert with input
 * rules applied, then let the macrotask in which Tiptap runs them pass.
 */
async function typeRule(): Promise<void> {
  const pos = editor!.state.selection.from;
  editor!.commands.insertContentAt(pos, "---", { applyInputRules: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  editor?.destroy();
  editor = null;
  host?.remove();
  host = null;
});

describe("setHorizontalRule — caret after the rule (§5.1)", () => {
  it("puts the caret at the start of the next paragraph, not the end of the document", () => {
    create("<p></p><p>below</p><p>end</p>", 1);
    editor!.commands.setHorizontalRule();
    expect(caretAt()).toEqual({ offset: 0, text: "below" });
  });

  it("does the same when the rule is typed as `---`", async () => {
    create("<p>above</p><p></p><p>below</p><p>end</p>", 8);
    await typeRule();
    expect(editor!.state.doc.child(1).type.name).toBe("horizontalRule");
    expect(caretAt()).toEqual({ offset: 0, text: "below" });
  });

  it("stays inside the container the rule was inserted in", () => {
    create("<blockquote><p></p><p>quoted</p></blockquote><p>after</p>", 2);
    editor!.commands.setHorizontalRule();
    expect(caretAt()).toEqual({ offset: 0, text: "quoted" });
  });

  it("selects an atom that follows the rule, as the nearest place after it", () => {
    create('<p></p><img src="a.png"><p>end</p>', 1);
    editor!.commands.setHorizontalRule();
    const { selection } = editor!.state;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.type.name).toBe("image");
  });

  it("adds an empty paragraph to type in when nothing follows the rule", () => {
    create("<p>above</p><p></p>", 8);
    editor!.commands.setHorizontalRule();
    const names: string[] = [];
    editor!.state.doc.forEach((node) => names.push(node.type.name));
    expect(names).toEqual(["paragraph", "horizontalRule", "paragraph"]);
    expect(caretAt()).toEqual({ offset: 0, text: "" });
  });
});

// §298 Phase 1 — insert entry on an atom (PR 307 review, design v3 D1).
//
// The core flips the mode BEFORE the adapter can veto, and `editable` is
// derived from the mode, so `i` on a NodeSelection used to leave a live
// NodeSelection inside an editable view — the state where ProseMirror
// replaces the selected node with whatever is typed next. A math block was
// destroyed this way in the repository's own README.
//
// These are PM-level pins on purpose: jsdom never delivers `selected` prop
// updates to React NodeViews, so anything asserting island focus here would
// pass on a technicality. Island focus is verified on device.

import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../../stores/settings/store";
import { createBaramExtensions } from "../../../index";
import { vimPluginKey } from "../vim-keys";

const editors: Editor[] = [];

function key(editor: Editor, k: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: k }),
  );
}

function makeEditor(content: object): Editor {
  useSettingsStore.setState({ vimMode: true });
  const editor = new Editor({
    content: "<p></p>",
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editor.commands.setContent(content);
  editors.push(editor);
  return editor;
}

/** Top-level offset of the first node of this type. */
function offsetOf(editor: Editor, typeName: string): number {
  let at = -1;
  editor.state.doc.forEach((node, offset) => {
    if (at < 0 && node.type.name === typeName) at = offset;
  });
  expect(at).toBeGreaterThanOrEqual(0);
  return at;
}

/** Every top-level node type, for "the document did not change" assertions. */
function shape(editor: Editor): string[] {
  const kinds: string[] = [];
  editor.state.doc.forEach((n) => kinds.push(n.type.name));
  return kinds;
}

function vim(editor: Editor) {
  return vimPluginKey.getState(editor.state);
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
  useSettingsStore.setState({ vimMode: false });
});

describe("insert entry on a BLOCK atom without an editing island", () => {
  // hr has no island to hand keys to, so there is nothing to enter. Refusing
  // is the honest answer: `o`/`O` are how vim adds a line here.
  function makeHrDoc(): Editor {
    return makeEditor({
      content: [
        { content: [{ text: "above", type: "text" }], type: "paragraph" },
        { type: "horizontalRule" },
        { content: [{ text: "below", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
  }

  it("`i` leaves the view NON-EDITABLE — the destructive state is never reached", () => {
    const editor = makeHrDoc();
    editor.commands.setNodeSelection(offsetOf(editor, "horizontalRule"));
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);

    key(editor, "i");

    // The pair that destroys documents: a live NodeSelection + editable.
    const stillNodeSelection = editor.state.selection instanceof NodeSelection;
    expect(stillNodeSelection && editor.view.editable).toBe(false);
  });

  it("stays in normal mode on `i` `a` `I` `A`, and the document is untouched", () => {
    for (const k of ["i", "a", "I", "A"]) {
      const editor = makeHrDoc();
      const before = shape(editor);
      editor.commands.setNodeSelection(offsetOf(editor, "horizontalRule"));

      key(editor, k);

      expect(vim(editor)?.mode).toBe("normal");
      expect(editor.view.editable).toBe(false);
      expect(shape(editor)).toEqual(before);
    }
  });

  it("a refused entry does not swallow the NEXT command", () => {
    // If the preflight left a count or half-typed operator behind, the
    // following motion would be misread. Prove it by driving one.
    const editor = makeHrDoc();
    const hr = offsetOf(editor, "horizontalRule");
    editor.commands.setNodeSelection(hr);

    key(editor, "i"); // refused
    key(editor, "k"); // must still be an ordinary motion

    expect(vim(editor)?.mode).toBe("normal");
    expect(editor.state.doc.resolve(editor.state.selection.from).index(0)).toBe(
      0, // moved up to "above"
    );
  });
});

describe("insert entry on an INLINE atom", () => {
  // An inline atom sits inside a textblock, so the positions either side of
  // it ARE valid text positions: `i` before, `a` after. Refusing here would
  // be over-correction — vim would look broken next to a mention.
  function makeMentionDoc(): { editor: Editor; mentionPos: number } {
    const editor = makeEditor({
      content: [
        {
          content: [
            { text: "hi ", type: "text" },
            { attrs: { id: "someone", label: "someone" }, type: "mention" },
            { text: " bye", type: "text" },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    });
    let mentionPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (mentionPos < 0 && node.type.name === "mention") mentionPos = pos;
    });
    expect(mentionPos).toBeGreaterThan(0);
    return { editor, mentionPos };
  }

  it("`i` puts a real caret BEFORE the atom and enters insert", () => {
    const { editor, mentionPos } = makeMentionDoc();
    editor.commands.setNodeSelection(mentionPos);

    key(editor, "i");

    expect(vim(editor)?.mode).toBe("insert");
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(mentionPos);
  });

  it("`a` puts the caret AFTER the atom", () => {
    const { editor, mentionPos } = makeMentionDoc();
    const size = editor.state.doc.nodeAt(mentionPos)?.nodeSize ?? 0;
    editor.commands.setNodeSelection(mentionPos);

    key(editor, "a");

    expect(vim(editor)?.mode).toBe("insert");
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.state.selection.from).toBe(mentionPos + size);
  });

  it("the atom SURVIVES a following keystroke — no NodeSelection replacement", () => {
    const { editor, mentionPos } = makeMentionDoc();
    editor.commands.setNodeSelection(mentionPos);
    key(editor, "i");

    // Typing is what destroyed the math block: a live NodeSelection under an
    // editable view gets replaced. With a caret it inserts instead.
    const { from } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.insertText("X", from));

    let mentions = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "mention") mentions++;
    });
    expect(mentions).toBe(1);
    expect(editor.state.doc.textContent).toContain("X");
  });
});

describe("ordinary text is unaffected (positive control)", () => {
  // A pin that only asserts refusals would pass on an implementation that
  // refuses EVERYTHING. This is the other half.
  it("`i` still enters insert in a plain paragraph", () => {
    const editor = makeEditor({
      content: [
        { content: [{ text: "alpha", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
    editor.commands.setTextSelection(3);

    key(editor, "i");

    expect(vim(editor)?.mode).toBe("insert");
    expect(editor.view.editable).toBe(true);
    expect(editor.state.selection.from).toBe(3);
  });

  it("`A` still jumps to the line end in a plain paragraph", () => {
    const editor = makeEditor({
      content: [
        { content: [{ text: "alpha", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
    editor.commands.setTextSelection(2);

    key(editor, "A");

    expect(vim(editor)?.mode).toBe("insert");
    expect(editor.state.selection.from).toBe(6); // after "alpha"
  });
});

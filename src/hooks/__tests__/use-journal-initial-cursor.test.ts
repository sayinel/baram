import type { Transaction } from "@tiptap/pm/state";

// §56 Journal initial-caret placement — placeJournalBodyCursor
import { Editor } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { JOURNAL_CURSOR_INIT_META } from "../../utils/editor/programmatic-update";
import { placeJournalBodyCursor } from "../use-journal-initial-cursor";

let editor: Editor;

afterEach(() => {
  editor?.destroy();
});

/** Install a doc built from top-level nodes and reset selection to the start. */
function installDoc(
  ed: Editor,
  build: (schema: Editor["schema"]) => ReturnType<Editor["schema"]["node"]>[],
): void {
  const { schema } = ed;
  const doc = schema.nodes.doc.create(null, build(schema));
  ed.view.updateState(
    EditorState.create({
      doc,
      plugins: ed.state.plugins,
      selection: TextSelection.atStart(doc),
      schema,
    }),
  );
}

function makeEditor(): Editor {
  return new Editor({ content: "", extensions: createBaramExtensions() });
}

describe("placeJournalBodyCursor (§56)", () => {
  it("frontmatter + title only → inserts an empty body paragraph and puts caret in it", () => {
    editor = makeEditor();
    installDoc(editor, (s) => [
      s.nodes.frontmatter.create({ yaml: "date: 2026-07-17" }),
      s.nodes.heading.create({ level: 1 }, s.text("July 17th, 2026")),
    ]);

    placeJournalBodyCursor(editor);

    const doc = editor.state.doc;
    expect(doc.childCount).toBe(3);
    expect(doc.child(0).type.name).toBe("frontmatter");
    expect(doc.child(1).type.name).toBe("heading");
    expect(doc.child(2).type.name).toBe("paragraph");
    expect(doc.child(2).content.size).toBe(0); // empty — nothing to serialize
    // Caret sits inside the new body paragraph, not on the title.
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("title only (no frontmatter) → inserts body paragraph below the title", () => {
    editor = makeEditor();
    installDoc(editor, (s) => [
      s.nodes.heading.create({ level: 1 }, s.text("2026-07-17")),
    ]);

    placeJournalBodyCursor(editor);

    const doc = editor.state.doc;
    expect(doc.childCount).toBe(2);
    expect(doc.child(1).type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("title already followed by a paragraph → reuses it, no extra paragraph", () => {
    editor = makeEditor();
    installDoc(editor, (s) => [
      s.nodes.heading.create({ level: 1 }, s.text("2026-07-17")),
      s.nodes.paragraph.create(),
    ]);

    placeJournalBodyCursor(editor);

    const doc = editor.state.doc;
    expect(doc.childCount).toBe(2); // unchanged
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("title followed by a structured block (custom template) → no-op", () => {
    editor = makeEditor();
    installDoc(editor, (s) => [
      s.nodes.heading.create({ level: 1 }, s.text("2026-07-17")),
      s.nodes.heading.create({ level: 2 }, s.text("Today")),
    ]);
    const before = editor.state.doc.toJSON();

    placeJournalBodyCursor(editor);

    // Don't insert a paragraph between the title and a custom template section.
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("no title heading → no-op (doc and selection untouched)", () => {
    editor = makeEditor();
    installDoc(editor, (s) => [
      s.nodes.paragraph.create(null, s.text("just a note")),
    ]);
    const before = editor.state.doc.toJSON();

    placeJournalBodyCursor(editor);

    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("tags the transaction with JOURNAL_CURSOR_INIT_META so save folds it into the baseline", () => {
    editor = makeEditor();
    installDoc(editor, (s) => [
      s.nodes.heading.create({ level: 1 }, s.text("2026-07-17")),
    ]);

    let captured: null | Transaction = null;
    const original = editor.view.dispatch.bind(editor.view);
    editor.view.dispatch = (tr: Transaction) => {
      captured = tr;
      original(tr);
    };

    placeJournalBodyCursor(editor);

    expect(captured).not.toBeNull();
    expect(captured!.getMeta(JOURNAL_CURSOR_INIT_META)).toBe(true);
  });
});

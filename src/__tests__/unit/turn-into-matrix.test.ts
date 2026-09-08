// §4.8 "Turn into" must convert ANY block type to ANY other — including from
// containers (lists, blockquote, toggle, callout), which previously left the
// container in place or nested the target inside it.
import { afterEach, describe, expect, it } from "vitest";

import en from "../../i18n/en.json";
import { buildTurnIntoItems } from "../../utils/toolbar/block-turn-into";
import { makeTestEditor } from "../helpers/make-test-editor";

// ‼️ Keyed by i18n KEY, not by the English label. `TurnIntoItem.label` used to be the item's
// display string and this file used it as the item's identity; once the labels became keys
// (`turnInto.*`) every `find` here missed, `?.run()` no-opped, and all 98 cases failed with
// "expected toggle, received taskList" — a conversion that never ran, not a broken conversion.
// The test names still read in English, resolved from the catalogue rather than spelled out.
const TYPE_OF: Record<string, string> = {
  "turnInto.callout": "callout",
  "turnInto.heading1": "heading",
  "turnInto.orderedList": "orderedList",
  "turnInto.quote": "blockquote",
  "turnInto.taskList": "taskList",
  "turnInto.text": "paragraph",
  "turnInto.toggle": "toggle",
  "turnInto.unorderedList": "bulletList",
};
const LABELS = Object.keys(TYPE_OF);
const named = (key: string) => (en as Record<string, string>)[key];

const editors: ReturnType<typeof makeTestEditor>[] = [];
function makeEditor(html: string) {
  const e = makeTestEditor(html);
  editors.push(e);
  return e;
}
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

function turnInto(editor: ReturnType<typeof makeTestEditor>, key: string) {
  const item = buildTurnIntoItems(editor, 0).find((i) => i.label === key);
  // Throwing, not `?.run()`: an item this file cannot find used to look exactly like a
  // conversion that ran and did the wrong thing, which is what hid the rename above.
  if (!item) throw new Error(`no "Turn into" item labelled ${key}`);
  item.run();
}

describe("Turn into: full source → target matrix", () => {
  for (const source of LABELS) {
    for (const target of LABELS) {
      if (source === target) continue;
      it(`${named(source)} → ${named(target)}`, () => {
        const editor = makeEditor("<p>X</p>");
        // A paragraph is what the fixture already is, and `turnInto.text` on it is a no-op.
        if (source !== "turnInto.text") turnInto(editor, source);
        expect(editor.state.doc.firstChild!.type.name).toBe(TYPE_OF[source]);

        turnInto(editor, target);

        // The whole block converts to the target type (no container left behind,
        // no nesting), and the text is preserved (no duplication / loss).
        expect(editor.state.doc.firstChild!.type.name).toBe(TYPE_OF[target]);
        expect(editor.state.doc.textContent).toBe("X");
      });
    }
  }
});

// A MULTI-item list must convert as a WHOLE — every item lifts, so no list of
// the source type is left behind (the bug was [target, leftover-list]).
describe("Turn into: multi-item list converts the whole list", () => {
  const LIST_SOURCES = [
    { item: "listItem", label: "turnInto.unorderedList", type: "bulletList" },
    { item: "listItem", label: "turnInto.orderedList", type: "orderedList" },
    { item: "taskItem", label: "turnInto.taskList", type: "taskList" },
  ];

  function buildList(itemType: string, listType: string) {
    const editor = makeEditor("<p>seed</p>");
    const mkItem = (text: string) => ({
      type: itemType,
      content: [{ content: [{ text, type: "text" }], type: "paragraph" }],
    });
    editor.commands.setContent({
      content: [{ content: [mkItem("B1"), mkItem("B2")], type: listType }],
      type: "doc",
    });
    return editor;
  }

  for (const src of LIST_SOURCES) {
    for (const target of LABELS) {
      if (src.label === target) continue;
      it(`2-item ${named(src.label)} → ${named(target)}`, () => {
        const editor = buildList(src.item, src.type);
        expect(editor.state.doc.firstChild!.type.name).toBe(src.type);

        turnInto(editor, target);

        expect(editor.state.doc.firstChild!.type.name).toBe(TYPE_OF[target]);
        expect(editor.state.doc.textContent).toBe("B1B2");
        // No partial conversion: the source list type is fully gone.
        let leftover = false;
        editor.state.doc.descendants((n) => {
          if (n.type.name === src.type) leftover = true;
        });
        expect(leftover).toBe(false);
      });
    }
  }

  // Converting a list must NOT touch the block that follows it: a `to` at the
  // list's closing boundary used to map onto the next block after lifting, so
  // the target converted that block instead (e.g. list → Ordered turned the
  // next paragraph into the list).
  function buildListThenParagraph(itemType: string, listType: string) {
    const editor = makeEditor("<p>seed</p>");
    const mkItem = (text: string) => ({
      type: itemType,
      content: [{ content: [{ text, type: "text" }], type: "paragraph" }],
    });
    editor.commands.setContent({
      content: [
        { content: [mkItem("A"), mkItem("B"), mkItem("C")], type: listType },
        { content: [{ text: "line1", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
    return editor;
  }

  for (const src of LIST_SOURCES) {
    for (const target of LABELS) {
      if (src.label === target) continue;
      it(`${named(src.label)} → ${named(target)} leaves the paragraph after it untouched`, () => {
        const editor = buildListThenParagraph(src.item, src.type);
        turnInto(editor, target); // handle is on the list at pos 0

        const last = editor.state.doc.lastChild!;
        expect(last.type.name).toBe("paragraph");
        expect(last.textContent).toBe("line1");
        // The list content converted to the target.
        expect(editor.state.doc.firstChild!.type.name).toBe(TYPE_OF[target]);
      });
    }
  }
});

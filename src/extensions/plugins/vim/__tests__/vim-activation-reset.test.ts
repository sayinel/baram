// §298 Phase 1 — document activation resets transient vim state (design v3 D2).
//
// A keep-alive editor is shown again without any state installation and
// without a vim transaction, so whatever was half-typed when the user left
// survived: `d`, switch tab, come back, press `w` — and a word disappears
// that the user never asked to delete. Insert/visual, a count prefix and an
// open ex line have the same shape.
//
// The reset has to be one transaction and it has to cover the PM selection
// too: visual mode's actual range lives in the selection, not in core, so
// clearing only the meta leaves "normal mode with a range still selected".

import type { VimPluginState } from "../vim-plugin";

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../../stores/settings/store";
import { createBaramExtensions } from "../../../index";
import { activateEditorForDocument } from "../vim-activation";
import { vimPluginKey } from "../vim-keys";

const editors: Editor[] = [];

function key(editor: Editor, k: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: k }),
  );
}

function makeEditor(text = "one two three"): Editor {
  useSettingsStore.setState({ vimMode: true });
  const editor = new Editor({
    content: `<p>${text}</p>`,
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  editor.commands.setTextSelection(1);
  return editor;
}

function vim(editor: Editor): undefined | VimPluginState {
  // The public snapshot hides `core`; these pins assert on it.
  return vimPluginKey.getState(editor.state) as unknown as
    undefined | VimPluginState;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
  useSettingsStore.setState({ vimMode: false });
});

describe("a half-typed operator does not survive activation", () => {
  it("`d` then activation then `w` does NOT delete a word", () => {
    const editor = makeEditor();
    key(editor, "d");
    expect(vim(editor)?.core.pending).toBe("d"); // the state being left behind
    const before = editor.state.doc.textContent;

    activateEditorForDocument(editor.view);
    key(editor, "w");

    expect(editor.state.doc.textContent).toBe(before);
    expect(vim(editor)?.core.pending).toBeNull();
  });

  it("a count prefix does not survive either", () => {
    const editor = makeEditor();
    key(editor, "3");
    expect(vim(editor)?.core.count).toBe(3);

    activateEditorForDocument(editor.view);

    expect(vim(editor)?.core.count).toBeNull();
  });

  it("an open ex line does not survive", () => {
    const editor = makeEditor();
    key(editor, ":");
    key(editor, "w");
    expect(vim(editor)?.exLine).toBe("w");

    activateEditorForDocument(editor.view);

    expect(vim(editor)?.exLine).toBeNull();
  });
});

describe("mode and selection are reset together", () => {
  it("insert mode returns to normal, and the view goes non-editable", () => {
    const editor = makeEditor();
    key(editor, "i");
    expect(vim(editor)?.mode).toBe("insert");
    expect(editor.view.editable).toBe(true);

    activateEditorForDocument(editor.view);

    expect(vim(editor)?.mode).toBe("normal");
    expect(editor.view.editable).toBe(false);
  });

  it("visual mode leaves NO range selected — the selection collapses", () => {
    // Clearing only the vim meta would leave normal mode over a live range,
    // and the next edit would act on a selection the user cannot see.
    const editor = makeEditor();
    key(editor, "v");
    key(editor, "l");
    key(editor, "l");
    expect(vim(editor)?.mode).toBe("visual");
    expect(editor.state.selection.empty).toBe(false);

    activateEditorForDocument(editor.view);

    expect(vim(editor)?.mode).toBe("normal");
    expect(vim(editor)?.core.visual).toBeNull();
    expect(editor.state.selection.empty).toBe(true);
  });

  it("the collapsed caret lands on the VIM head, not PM's selection head", () => {
    // The two differ by one: visual mode renders inclusively, so PM's head
    // sits past the unit the vim cursor is on. Collapsing to PM's head would
    // shift the caret one unit right on every tab switch.
    const editor = makeEditor();
    editor.commands.setTextSelection(5);
    key(editor, "v");
    key(editor, "l");
    const vimHead = vim(editor)?.core.visual?.headCursor;
    expect(vimHead).toBe(6);
    expect(editor.state.selection.head).toBe(7); // inclusive render

    activateEditorForDocument(editor.view);

    expect(editor.state.selection.from).toBe(vimHead);
  });
});

describe("activation costs exactly one transaction", () => {
  it("dispatches once, not once per field it clears", () => {
    const editor = makeEditor();
    key(editor, "3");
    key(editor, "d");

    let dispatches = 0;
    const original = editor.view.dispatch.bind(editor.view);
    editor.view.dispatch = (tr) => {
      dispatches++;
      original(tr);
    };
    activateEditorForDocument(editor.view);

    expect(dispatches).toBe(1);
  });

  it("is a no-op transaction-wise when there is nothing to reset", () => {
    // Every tab switch calls this; an unconditional dispatch would wake every
    // store listener for nothing (see the status-feed equality gate).
    const editor = makeEditor();
    let dispatches = 0;
    const original = editor.view.dispatch.bind(editor.view);
    editor.view.dispatch = (tr) => {
      dispatches++;
      original(tr);
    };

    activateEditorForDocument(editor.view);

    expect(dispatches).toBe(0);
  });
});

describe("vim stays enabled (positive control)", () => {
  it("resetting does not turn vim off", () => {
    // A reset implemented as "reinstall the plugin state" would disable vim
    // and every pin above would still pass.
    const editor = makeEditor();
    key(editor, "d");

    activateEditorForDocument(editor.view);

    expect(vim(editor)?.enabled).toBe(true);
    expect(editor.view.dom.classList.contains("vim-modal")).toBe(true);
  });

  it("motions still work after a reset", () => {
    const editor = makeEditor();
    key(editor, "d");
    activateEditorForDocument(editor.view);

    const before = editor.state.selection.from;
    key(editor, "l");

    expect(editor.state.selection.from).toBeGreaterThan(before);
  });
});

describe("vim OFF is untouched", () => {
  it("does nothing when the surface is not vim-owned", () => {
    useSettingsStore.setState({ vimMode: false });
    const editor = new Editor({
      content: "<p>plain</p>",
      element: document.body.appendChild(document.createElement("div")),
      extensions: createBaramExtensions(),
    });
    editors.push(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 1, 4),
      ),
    );
    const selectionBefore = editor.state.selection;

    activateEditorForDocument(editor.view);

    expect(editor.state.selection).toBe(selectionBefore); // range intact
    expect(editor.view.editable).toBe(true);
  });
});

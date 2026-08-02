// §298 Vim Phase 1 — S2 plugin behavior (design §2/§3/§5/§5b).
//
// Real editor, real DOM events on view.dom: the P3 entry point is
// handleDOMEvents.keydown, which prosemirror-view runs BEFORE its editable
// gate, so these keystrokes exercise exactly the production path.

import { Editor } from "@tiptap/core";
import { undoDepth } from "@tiptap/pm/history";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../index";
import { readVimRegister, resetVimRegister } from "../adapters/register";
import { vimPluginKey, withVimExternalEdit } from "../vim-keys";
import { type VimPluginState } from "../vim-plugin";

const editors: Editor[] = [];

function makeEditor(content = "<p>alpha</p><p>beta</p>"): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  resetVimRegister();
  for (const e of editors.splice(0)) e.destroy();
});

function enable(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, {
      enabled: true,
      type: "setEnabled",
    }),
  );
}

function key(editor: Editor, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
  });
  editor.view.dom.dispatchEvent(event);
  return event;
}

function vim(editor: Editor): VimPluginState {
  return vimPluginKey.getState(editor.state) as unknown as VimPluginState;
}

describe("lifecycle (§7 minimal)", () => {
  it("starts disabled and editable; enabling lands in normal, non-editable", () => {
    const editor = makeEditor();
    expect(vim(editor).enabled).toBe(false);
    expect(editor.view.editable).toBe(true);

    enable(editor);
    expect(vim(editor).mode).toBe("normal");
    expect(editor.view.editable).toBe(false);
  });

  it("supplies the root tabindex itself while modal (§3b)", () => {
    const editor = makeEditor();
    enable(editor);
    expect(editor.view.dom.getAttribute("tabindex")).toBe("0");
  });
});

describe("P3 entry points", () => {
  it("normal-mode keys are consumed through handleDOMEvents.keydown", () => {
    const editor = makeEditor();
    enable(editor);
    const event = key(editor, "j");
    expect(event.defaultPrevented).toBe(true);
    expect(editor.state.doc.textContent).toBe("alphabeta");
  });

  it("Mod chords pass through untouched (§5)", () => {
    // jsdom is non-mac: Mod = ctrlKey (design §5 modifier pin).
    const editor = makeEditor();
    enable(editor);
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "c",
    });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("insert-mode Esc returns to normal via handleKeyDown", () => {
    const editor = makeEditor();
    enable(editor);
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        mode: "insert",
        type: "setMode",
      }),
    );
    expect(editor.view.editable).toBe(true);

    key(editor, "Escape");
    expect(vim(editor).mode).toBe("normal");
    expect(editor.view.editable).toBe(false);
  });

  it("x deletes a character through the S4 adapter", () => {
    const editor = makeEditor("<p>abc</p>");
    editor.commands.setTextSelection(1);
    enable(editor);
    key(editor, "x");
    expect(editor.state.doc.textContent).toBe("bc");
  });

  it("dd deletes the current line — two keystrokes, one operation", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(2); // inside "alpha"
    enable(editor);
    key(editor, "d");
    expect(editor.state.doc.textContent).toBe("alphabeta"); // pending only
    key(editor, "d");
    expect(editor.state.doc.textContent).toBe("beta");
  });
});

describe("clipboard/drop consumption (§5)", () => {
  it.each(["cut", "paste"] as const)(
    "%s is actively consumed while modal",
    (type) => {
      const editor = makeEditor();
      enable(editor);
      const event = new Event(type, { bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    },
  );

  it("nothing is consumed while in insert mode", () => {
    const editor = makeEditor();
    enable(editor);
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        mode: "insert",
        type: "setMode",
      }),
    );
    const event = new Event("paste", { bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("apply precedence (§5b)", () => {
  it("an external edit clears count/pending and collapses visual", () => {
    const editor = makeEditor();
    enable(editor);
    key(editor, "2");
    key(editor, "d");
    expect(vim(editor).core.pending).toBe("d");

    editor.view.dispatch(
      withVimExternalEdit(editor.state.tr.insertText("!", 1, 1)),
    );
    const state = vim(editor);
    expect(state.core.count).toBeNull();
    expect(state.core.pending).toBeNull();
    expect(state.mode).toBe("normal");
  });

  it("entering suspension clears a pending operator (§5b focusLocal)", () => {
    const editor = makeEditor();
    enable(editor);
    key(editor, "d");
    expect(vim(editor).core.pending).toBe("d");

    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        suspended: true,
        type: "setSuspended",
      }),
    );
    expect(vim(editor).core.pending).toBeNull();
    expect(vim(editor).suspended).toBe(true);
  });

  it("while suspended, keys pass through unconsumed (§4)", () => {
    const editor = makeEditor();
    enable(editor);
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        suspended: true,
        type: "setSuspended",
      }),
    );
    const event = key(editor, "j");
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("impl review S2-R1 pins", () => {
  it("v then d deletes the unit under the cursor — the range survives step", () => {
    const editor = makeEditor("<p>abc</p>");
    editor.commands.setTextSelection(1);
    enable(editor);
    key(editor, "v");
    key(editor, "d");
    expect(editor.state.doc.textContent).toBe("bc");
    expect(vim(editor).mode).toBe("normal");
  });

  it("v then y fills the char register", () => {
    const editor = makeEditor("<p>abc</p>");
    editor.commands.setTextSelection(1);
    enable(editor);
    key(editor, "v");
    key(editor, "y");
    expect(readVimRegister()).toMatchObject({ kind: "char" });
  });

  it("Alt+Escape in insert passes through — Esc rides the shared core", () => {
    const editor = makeEditor();
    enable(editor);
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        mode: "insert",
        type: "setMode",
      }),
    );
    const event = new KeyboardEvent("keydown", {
      altKey: true,
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    editor.view.dom.dispatchEvent(event);
    expect(vim(editor).mode).toBe("insert");
  });

  it("a consumed vim key never reaches document listeners", () => {
    const editor = makeEditor();
    document.body.appendChild(editor.view.dom);
    enable(editor);
    let leaked = 0;
    const listener = () => {
      leaked++;
    };
    document.addEventListener("keydown", listener);
    key(editor, "j");
    document.removeEventListener("keydown", listener);
    editor.view.dom.remove();
    expect(leaked).toBe(0);
  });

  it("2u undoes two history events, not one", () => {
    const editor = makeEditor("<p>one</p><p>two</p>");
    editor.view.dispatch(editor.state.tr.insertText("A", 1));
    editor.view.dispatch(
      editor.state.tr.insertText("B", editor.state.doc.content.size - 2),
    );
    expect(undoDepth(editor.state)).toBe(2); // fixture guard
    enable(editor);
    key(editor, "2");
    key(editor, "u");
    expect(editor.state.doc.textContent).toBe("onetwo");
    expect(undoDepth(editor.state)).toBe(0);
  });
});

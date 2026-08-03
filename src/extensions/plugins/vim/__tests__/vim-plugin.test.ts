// §298 Vim Phase 1 — S2 plugin behavior (design §2/§3/§5/§5b).
//
// Real editor, real DOM events on view.dom: the P3 entry point is
// handleDOMEvents.keydown, which prosemirror-view runs BEFORE its editable
// gate, so these keystrokes exercise exactly the production path.

import { Editor } from "@tiptap/core";
import { undoDepth } from "@tiptap/pm/history";
import { DecorationSet } from "@tiptap/pm/view";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../index";
import { syntaxRevealKey } from "../../syntax-reveal-state";
import { executeCoreCommand } from "../adapters/execute-command";
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

describe("impl review S2-R2 pins", () => {
  it("a dispatch that drops history transactions terminates the count loop", () => {
    // PM's undo() returns "history exists", NOT "the dispatch landed" — a
    // filterTransaction-style drop keeps returning true forever. The
    // progress guard must break after the first no-progress iteration.
    const editor = makeEditor("<p>one</p>");
    editor.view.dispatch(editor.state.tr.insertText("A", 1));
    enable(editor);

    let dispatched = 0;
    const stuckView = {
      get state() {
        return editor.view.state;
      },
      dispatch: () => {
        dispatched++;
      },
    } as unknown as Parameters<typeof executeCoreCommand>[0];

    executeCoreCommand(stuckView, { count: 5, type: "undo" }, null);
    expect(dispatched).toBe(1); // tried once, saw no progress, stopped
  });

  it("digit accumulation is capped — no unbounded synchronous loops", () => {
    const editor = makeEditor();
    enable(editor);
    for (let i = 0; i < 12; i++) key(editor, "9");
    expect(vim(editor).core.count).toBeLessThanOrEqual(9999);
  });
});

describe("S3 — motions and visual selection through the plugin", () => {
  it("l moves the cursor; 2j walks lines", () => {
    const editor = makeEditor("<p>one</p><p>two</p><p>tri</p>");
    editor.commands.setTextSelection(1);
    enable(editor);
    key(editor, "l");
    expect(editor.state.selection.head).toBe(2);
    key(editor, "2");
    key(editor, "j");
    // column 1 of "tri" (third paragraph starts at 11)
    expect(
      editor.state.doc.resolve(editor.state.selection.head).parent.textContent,
    ).toBe("tri");
  });

  it("v then l extends an INCLUSIVE selection; Esc collapses to the head", () => {
    const editor = makeEditor("<p>abcdef</p>");
    editor.commands.setTextSelection(2); // on "b"
    enable(editor);
    key(editor, "v");
    expect(editor.state.selection.from).toBe(2);
    expect(editor.state.selection.to).toBe(3); // one unit, never empty (§6)
    key(editor, "l");
    key(editor, "l");
    expect(editor.state.selection.from).toBe(2);
    expect(editor.state.selection.to).toBe(5); // b..d inclusive
    key(editor, "Escape");
    expect(vim(editor).mode).toBe("normal");
    expect(editor.state.selection.head).toBe(4); // vim head, not PM head
    expect(editor.state.selection.empty).toBe(true);
  });

  it("v l d deletes the inclusive range", () => {
    const editor = makeEditor("<p>abcdef</p>");
    editor.commands.setTextSelection(2);
    enable(editor);
    key(editor, "v");
    key(editor, "l");
    key(editor, "d");
    expect(editor.state.doc.textContent).toBe("adef");
  });

  it("vim's own selection moves never collapse visual (priority order)", () => {
    const editor = makeEditor("<p>abcdef</p>");
    editor.commands.setTextSelection(2);
    enable(editor);
    key(editor, "v");
    key(editor, "l");
    expect(vim(editor).mode).toBe("visual");
    expect(vim(editor).core.visual).not.toBeNull();
  });
});

describe("impl review S3-R2 — atom visual rendering", () => {
  it("v on a block atom renders a NodeSelection, and d deletes the atom", () => {
    const editor = makeEditor();
    editor.commands.setContent({
      content: [
        { content: [{ text: "up", type: "text" }], type: "paragraph" },
        { attrs: { latex: "x" }, type: "mathBlock" },
        { content: [{ text: "dn", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
    editor.commands.setTextSelection(1);
    enable(editor);
    key(editor, "j"); // NodeSelection on the math block
    key(editor, "v");
    const sel = editor.state.selection;
    expect(sel.constructor.name).toBe("NodeSelection");
    expect(sel.from).toBe(
      sel.to - 1 - editor.state.doc.nodeAt(sel.from)!.content.size,
    );
    key(editor, "d");
    let hasMath = false;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "mathBlock") hasMath = true;
      return true;
    });
    expect(hasMath).toBe(false);
  });
});

describe("S5 — block cursor decorations (§10)", () => {
  function decosAt(editor: Editor) {
    const plugin = vimPluginKey.get(editor.state)!;
    const decos = plugin.props.decorations?.call(plugin, editor.state);
    // The prop is typed as the wider DecorationSource; the plugin always
    // builds a concrete DecorationSet.
    return decos instanceof DecorationSet ? decos.find() : [];
  }

  it("normal mode paints exactly the unit under the cursor", () => {
    const editor = makeEditor("<p>abc</p>");
    editor.commands.setTextSelection(2); // on "b"
    enable(editor);
    const decos = decosAt(editor);
    expect(decos).toHaveLength(1);
    expect(decos[0].from).toBe(2);
    expect(decos[0].to).toBe(3);
  });

  it("insert mode and suspension paint nothing", () => {
    const editor = makeEditor("<p>abc</p>");
    enable(editor);
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        mode: "insert",
        type: "setMode",
      }),
    );
    expect(decosAt(editor)).toHaveLength(0);

    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        mode: "normal",
        type: "setMode",
      }),
    );
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        suspended: true,
        type: "setSuspended",
      }),
    );
    expect(decosAt(editor)).toHaveLength(0);
  });

  it("an empty line gets the zero-width widget caret", () => {
    const editor = makeEditor("<p></p>");
    editor.commands.setTextSelection(1);
    enable(editor);
    const decos = decosAt(editor);
    expect(decos).toHaveLength(1);
    expect(decos[0].from).toBe(1);
    expect(decos[0].to).toBe(1); // widget — zero width
  });
});

describe("insert-Esc arbitration (§4, S6)", () => {
  it("an active transient owns the first Esc; vim takes the second", () => {
    const editor = makeEditor("<p>[text](url)</p>");
    enable(editor);
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        mode: "insert",
        type: "setMode",
      }),
    );

    // Simulate an expanded syntax reveal through its real meta.
    editor.view.dispatch(
      editor.state.tr.setMeta(syntaxRevealKey, {
        expanded: { from: 1, kind: "link", openCheck: "[", to: 5 },
      }),
    );

    key(editor, "Escape");
    expect(vim(editor).mode).toBe("insert"); // yielded to the transient

    editor.view.dispatch(
      editor.state.tr.setMeta(syntaxRevealKey, { expanded: null }),
    );
    key(editor, "Escape");
    expect(vim(editor).mode).toBe("normal"); // now vim's
  });
});

describe("Korean input source (device report)", () => {
  function koreanKey(editor: Editor, key: string, code: string): void {
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code,
        key,
      }),
    );
  }

  it("dd works as ㅇㅇ — physical keys drive normal mode", () => {
    const editor = makeEditor("<p>alpha</p><p>beta</p>");
    editor.commands.setTextSelection(2);
    enable(editor);
    koreanKey(editor, "\u3147", "KeyD"); // ㅇ = physical D
    koreanKey(editor, "\u3147", "KeyD");
    expect(editor.state.doc.textContent).toBe("beta");
  });

  it("ㅓ (physical J) moves down", () => {
    const editor = makeEditor("<p>one</p><p>two</p>");
    editor.commands.setTextSelection(1);
    enable(editor);
    koreanKey(editor, "\u3153", "KeyJ");
    expect(
      editor.state.doc.resolve(editor.state.selection.head).parent.textContent,
    ).toBe("two");
  });
});

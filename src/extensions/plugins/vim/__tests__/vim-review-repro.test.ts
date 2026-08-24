// §298 vim — reproductions for the PR 307 review findings.
//
// One describe per reported item. These are written to FAIL where the report
// is a defect, so the fix has something to turn green.

import { Editor } from "@tiptap/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearActions,
  registerAction,
} from "../../../../keybindings/keybinding-actions";
import { useUIStore } from "../../../../stores/ui/ui";
import { createBaramExtensions } from "../../../index";
import { resolveMotion } from "../adapters/motions";
import { vimPluginKey } from "../vim-keys";
import { setWysiwygVimStatusOwner } from "../vim-status";

const editors: Editor[] = [];

/** Which top-level block index the cursor sits in. */
function blockIndexOf(editor: Editor): number {
  return editor.state.doc.resolve(editor.state.selection.from).index(0);
}

function enableVim(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, {
      enabled: true,
      type: "setEnabled",
    }),
  );
}

function key(editor: Editor, k: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: k }),
  );
}

function makeEditor(content: string): Editor {
  const editor = new Editor({
    content,
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  setWysiwygVimStatusOwner(null);
  clearActions();
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
});

describe("review 3 — table cells other than the first are keyboard-unreachable", () => {
  it("`l` walks off the end of a cell into the NEXT cell", () => {
    const editor = makeEditor(
      "<table><tbody>" +
        "<tr><td><p>ab</p></td><td><p>cd</p></td></tr>" +
        "</tbody></table>",
    );
    // Land inside the first cell, on its last character.
    const doc = editor.state.doc;
    let firstCellEnd = -1;
    doc.descendants((node, pos) => {
      if (
        firstCellEnd === -1 &&
        node.isTextblock &&
        node.textContent === "ab"
      ) {
        firstCellEnd = pos + 1 + node.content.size;
      }
    });
    expect(firstCellEnd).toBeGreaterThan(0);

    const target = resolveMotion(editor.state, firstCellEnd, "charRight", 1);
    // The next cursor stop should be inside the second cell ("cd"), not a
    // clamp at the first cell's end.
    const $t = editor.state.doc.resolve(target);
    expect($t.parent.textContent).toBe("cd");
  });

  it("`j` from the first row reaches the SAME column, not always column 0", () => {
    const editor = makeEditor(
      "<table><tbody>" +
        "<tr><td><p>a1</p></td><td><p>b1</p></td></tr>" +
        "<tr><td><p>a2</p></td><td><p>b2</p></td></tr>" +
        "</tbody></table>",
    );
    const doc = editor.state.doc;
    let b1 = -1;
    doc.descendants((node, pos) => {
      if (b1 === -1 && node.isTextblock && node.textContent === "b1") {
        b1 = pos + 1;
      }
    });
    expect(b1).toBeGreaterThan(0);

    const target = resolveMotion(editor.state, b1, "lineDown", 1);
    const $t = editor.state.doc.resolve(target);
    // vim moves down a row and stays in the same column's cell.
    expect($t.parent.textContent).toBe("b2");
  });
});

describe("review 4 — a math block blocks upward movement", () => {
  /** above / mathBlock / below, built as JSON so the atom really exists —
   *  the HTML form silently drops it (parseHTML wants data-type="mathBlock"). */
  function makeMathDoc(): { below: number; editor: Editor } {
    const editor = makeEditor("<p></p>");
    editor.commands.setContent({
      content: [
        { content: [{ text: "above", type: "text" }], type: "paragraph" },
        { attrs: { formula: "x^2" }, type: "mathBlock" },
        { content: [{ text: "below", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
    const kinds: string[] = [];
    editor.state.doc.forEach((n) => kinds.push(n.type.name));
    expect(kinds).toEqual(["paragraph", "mathBlock", "paragraph"]);

    let below = -1;
    editor.state.doc.descendants((node, pos) => {
      if (below === -1 && node.isTextblock && node.textContent === "below") {
        below = pos + 1;
      }
    });
    expect(below).toBeGreaterThan(0);
    return { below, editor };
  }

  it("`k` from the paragraph BELOW a math block leaves that paragraph", () => {
    const { below, editor } = makeMathDoc();
    const target = resolveMotion(editor.state, below, "lineUp", 1);
    expect(target).not.toBe(below); // it moved at all
    const $t = editor.state.doc.resolve(target);
    expect($t.parent.textContent).not.toBe("below"); // and left the paragraph
  });

  it("pressing `k` twice from below the math block reaches the paragraph above", () => {
    const { below, editor } = makeMathDoc();
    editor.commands.setTextSelection(below);
    enableVim(editor);

    key(editor, "k"); // onto the math block
    key(editor, "k"); // onto "above"
    expect(blockIndexOf(editor)).toBe(0);
  });

  it("`j` down onto the math block and `k` back up are symmetric", () => {
    const { editor } = makeMathDoc();
    editor.commands.setTextSelection(1); // inside "above"
    enableVim(editor);

    key(editor, "j"); // onto the math block
    const onMath = blockIndexOf(editor);
    expect(onMath).toBe(1);

    key(editor, "j"); // onto "below"
    expect(blockIndexOf(editor)).toBe(2);

    key(editor, "k"); // back onto the math block
    expect(blockIndexOf(editor)).toBe(1);

    key(editor, "k"); // back onto "above"
    expect(blockIndexOf(editor)).toBe(0);
  });
});

describe("review 2 — returning from source mode leaves vim keys dead", () => {
  // Cmd+/ back to WYSIWYG restores the selection but not DOM focus: PM's
  // own focus() is editable-gated (`if (this.editable)`) and vim normal runs
  // the view non-editable, so every key after the toggle goes nowhere until
  // the user clicks. Both return paths — progressive (large docs) and
  // synchronous (small) — had the bare call. Pinned at the source level
  // because the defect is "which focus function is called", and a jsdom hook
  // harness would prove far less than it costs (cf. core/purity.test.ts).
  const source = readFileSync(
    join(__dirname, "../../../../hooks/use-source-mode.ts"),
    "utf8",
  );

  it("uses no editable-gated focus call", () => {
    const bare = source
      .split("\n")
      .map((line, i) => [i + 1, line.replace(/\/\/.*$/, "")] as const)
      .filter(([, code]) => /\bview\.focus\(\)/.test(code));
    expect(bare).toEqual([]);
  });

  it("routes focus through the shared editable-gate fallback", () => {
    expect(source).toContain("focusEditorView");
  });
});

describe("review 5 — :w and :q in WYSIWYG", () => {
  // Source mode and code blocks get these from the CodeMirror adapter
  // (Vim.defineEx in components/editor/vim-mode.ts). The WYSIWYG engine had
  // no ex line at all, so `:` was silently ignored on the surface the PR
  // advertises as sharing them.
  function typeKeys(editor: Editor, keys: string): void {
    for (const k of keys) key(editor, k);
  }

  it("`:w` runs the app's save action", () => {
    const editor = makeEditor("<p>alpha</p>");
    editor.commands.setTextSelection(1);
    enableVim(editor);

    let saved = 0;
    registerAction("file.save", () => saved++);
    typeKeys(editor, ":w");
    key(editor, "Enter");
    expect(saved).toBe(1);
  });

  it("`:q` runs the app's close-tab action", () => {
    const editor = makeEditor("<p>alpha</p>");
    editor.commands.setTextSelection(1);
    enableVim(editor);

    let closed = 0;
    registerAction("file.closeTab", () => closed++);
    typeKeys(editor, ":q");
    key(editor, "Enter");
    expect(closed).toBe(1);
  });

  it("the pending command line is visible while typing", () => {
    const editor = makeEditor("<p>alpha</p>");
    setWysiwygVimStatusOwner(editor);
    editor.commands.setTextSelection(1);
    enableVim(editor);

    key(editor, ":");
    expect(useUIStore.getState().vimStatus?.command).toBe(":");
    key(editor, "w");
    expect(useUIStore.getState().vimStatus?.command).toBe(":w");

    // Escape abandons it without running anything.
    let saved = 0;
    registerAction("file.save", () => saved++);
    key(editor, "Escape");
    expect(useUIStore.getState().vimStatus?.command).toBeUndefined();
    expect(saved).toBe(0);
  });

  it("does not type the ex text into the document", () => {
    const editor = makeEditor("<p>alpha</p>");
    editor.commands.setTextSelection(1);
    enableVim(editor);
    registerAction("file.save", () => {});

    typeKeys(editor, ":w");
    key(editor, "Enter");
    expect(editor.state.doc.textContent).toBe("alpha");
  });

  it("an unknown ex command reports instead of failing silently", () => {
    const editor = makeEditor("<p>alpha</p>");
    editor.commands.setTextSelection(1);
    enableVim(editor);

    typeKeys(editor, ":nope");
    key(editor, "Enter");
    // Back to normal, nothing typed, no crash.
    expect(editor.state.doc.textContent).toBe("alpha");
    expect(useUIStore.getState().vimStatus?.command).toBeUndefined();
  });
});

describe("review 1 — Ctrl chords other than <C-r> belong to the app", () => {
  // Reported as "Ctrl-F/Ctrl-B do not work in WYSIWYG". They are not
  // implemented: the WYSIWYG engine forwards every Ctrl chord except <C-r>
  // to the app (state-machine.ts, "Every other chord belongs to the app"),
  // while source mode gets them from the CodeMirror adapter. Deferred to
  // issue 372 tier 3 with the other scroll motions; pinned here so the
  // hand-off stays deliberate — Ctrl-F also carries an emacs binding on
  // macOS, so claiming it is a decision, not an oversight.
  function press(editor: Editor, k: string): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: k,
    });
    editor.view.dom.dispatchEvent(event);
    return event;
  }

  it("passes Ctrl-F and Ctrl-B through untouched", () => {
    const editor = makeEditor(
      Array.from({ length: 40 }, (_, i) => `<p>line ${i}</p>`).join(""),
    );
    editor.commands.setTextSelection(1);
    enableVim(editor);

    for (const chord of ["f", "b", "d", "u"]) {
      const before = editor.state.selection.from;
      const event = press(editor, chord);
      expect(event.defaultPrevented).toBe(false);
      expect(editor.state.selection.from).toBe(before);
    }
  });

  it("still claims <C-r> for redo", () => {
    const editor = makeEditor("<p>alpha</p>");
    editor.commands.setTextSelection(1);
    enableVim(editor);
    expect(press(editor, "r").defaultPrevented).toBe(true);
  });
});

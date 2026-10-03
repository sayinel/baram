// §298 issue 776 — frontmatter source lines in the cursor behaviours this
// issue added.
//
// Frontmatter is `text*` with literal `\n` newlines, and the vim line model
// (segmentSpanAt, collectLines) counts the whole block as ONE line — j/k, h/l,
// 0/$ keep that. The first non-blank search (gg, G, :N, ^, I, z.) and insert
// Esc's step-back would otherwise run across YAML lines, so for them a `\n`
// inside frontmatter is a line boundary (cursor-line-columns.ts
// sourceLineSpan). A position right before a `\n` belongs to the line before
// it, a position right after to the line after.

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../index";
import { resolveMotion } from "../adapters/motions";
import { vimPluginKey } from "../vim-keys";

const editors: Editor[] = [];

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

function keys(editor: Editor, ...sequence: string[]): void {
  for (const key of sequence) {
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        shiftKey: key.length === 1 && key !== key.toLowerCase(),
      }),
    );
  }
}

/** Document = frontmatter with `yaml` (as its text) + paragraphs. */
function makeEditor(yaml: string, ...paragraphs: string[]): Editor {
  const editor = new Editor({
    content: "<p>x</p>",
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  editor.commands.setContent({
    content: [
      {
        content: yaml === "" ? [] : [{ text: yaml, type: "text" }],
        type: "frontmatter",
      },
      ...paragraphs.map((text) => ({
        content: [{ text, type: "text" }],
        type: "paragraph",
      })),
    ],
    type: "doc",
  });
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, {
      enabled: true,
      type: "setEnabled",
    }),
  );
  return editor;
}

function mode(editor: Editor): string {
  return (vimPluginKey.getState(editor.state) as unknown as { mode: string })
    .mode;
}

/** Offset of the selection head inside the frontmatter's text. */
function offset(editor: Editor): number {
  return editor.state.selection.head - 1;
}

function place(editor: Editor, yamlOffset: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1 + yamlOffset),
    ),
  );
}

function posOfBody(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text === text) found = pos;
  });
  expect(found).toBeGreaterThan(0);
  return found;
}

describe("first non-blank stays on its YAML line", () => {
  it("gg onto frontmatter whose first YAML line is blank lands on its start", () => {
    // Fails if: lineFirstNonBlank searches the whole frontmatter
    // (segmentSpanAt) — it skips the blank line and lands on "t" (offset 3).
    const editor = makeEditor("\n  title: x", "body");
    const target = resolveMotion(
      editor.state,
      posOfBody(editor, "body"),
      "docStart",
      1,
    );
    expect(target - 1).toBe(0);
  });

  it("gg onto an indented first YAML line lands on its first non-blank", () => {
    // Fails if: sourceLineSpan returns an empty span (to = from) — the search
    // finds nothing and falls back to offset 0.
    const editor = makeEditor("  title: x\nb", "body");
    keys(editor, "G", "g", "g");
    expect(offset(editor)).toBe(2);
  });

  it("G and :$ on a frontmatter-only document land on YAML line 1", () => {
    // Fails if: the same whole-block search — "\n  b" lands on "b".
    const editor = makeEditor("\n  b");
    keys(editor, "G");
    expect(offset(editor)).toBe(0);
    keys(editor, ":", "$", "Enter");
    expect(offset(editor)).toBe(0);
  });

  it("^ on YAML line 2 lands on line 2's first non-blank", () => {
    // Fails if: ^ searches from the frontmatter's start — it lands on line
    // 1's "a" (a pre-existing bug this fixes with the same rule).
    const editor = makeEditor("a: 1\n  bb: 2", "body");
    place(editor, 8); // the second "b"
    keys(editor, "^");
    expect(offset(editor)).toBe(7);
  });

  it("I on YAML line 2 inserts before line 2's first non-blank", () => {
    // Fails if: the same whole-block search.
    const editor = makeEditor("a: 1\n  bb: 2", "body");
    place(editor, 10);
    keys(editor, "I");
    expect(mode(editor)).toBe("insert");
    editor.view.dispatch(editor.state.tr.insertText("!"));
    expect(editor.state.doc.child(0).textContent).toBe("a: 1\n  !bb: 2");
  });

  it("d^ on YAML line 2 never reaches into line 1", () => {
    // Fails if: the same whole-block search — d^ deletes back to line 1's
    // first non-blank, swallowing the newline.
    const editor = makeEditor("a: 1\n  bb: 2", "body");
    place(editor, 8); // the second "b"
    keys(editor, "d", "^");
    expect(editor.state.doc.child(0).textContent).toBe("a: 1\n  b: 2");
  });

  it("dgg still deletes the frontmatter as one structural line (unchanged)", () => {
    // Control: the vertical/linewise model keeps frontmatter whole.
    const editor = makeEditor("a: 1\nb: 2", "body");
    place(editor, 7);
    keys(editor, "d", "g", "g");
    expect(editor.state.doc.child(0).type.name).toBe("paragraph");
  });

  it("$ still runs to the frontmatter's last character (the whole block, unchanged)", () => {
    // Control: 0/$ keep the one-line model; only the first non-blank and
    // insert Esc treat a `\n` as a line boundary.
    const editor = makeEditor("a: 1\nb: 2", "body");
    place(editor, 1);
    keys(editor, "$");
    expect(offset(editor)).toBe(8);
  });
});

describe("insert Esc never steps back across a YAML newline", () => {
  it("Esc at the start of YAML line 2 stays", () => {
    // Fails if: unitBeforeOnLine is bounded by the whole frontmatter — the
    // caret steps back onto line 1's "\n".
    const editor = makeEditor("a: 1\nbb: 2", "body");
    place(editor, 5);
    keys(editor, "i", "Escape");
    expect(offset(editor)).toBe(5);
  });

  it("Esc in the middle of a YAML line steps back one (control)", () => {
    const editor = makeEditor("a: 1\nbb: 2", "body");
    place(editor, 7);
    keys(editor, "i", "Escape");
    expect(offset(editor)).toBe(6);
  });

  it("a CRLF line start is a line start too", () => {
    // Fails if: the same whole-frontmatter bound — the step lands on the
    // "\r\n" cluster (offset 4, one grapheme).
    const editor = makeEditor("a: 1\r\nbb: 2", "body");
    place(editor, 6);
    keys(editor, "i", "Escape");
    expect(offset(editor)).toBe(6);
  });

  it("a forward range ending at YAML line 2's start lands on line 1's last unit", () => {
    // Fails if: forwardRangeEscTarget's on-line step uses the whole
    // frontmatter — the landing is line 1's "\n" (offset 4).
    const editor = makeEditor("a: 1\nbb: 2", "body");
    place(editor, 0);
    keys(editor, "i");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 1, 1 + 5),
      ),
    );
    keys(editor, "Escape");
    expect(editor.state.selection.empty).toBe(true);
    expect(offset(editor)).toBe(3); // "1"
  });

  it("…and after an empty YAML line, on that empty line", () => {
    // Fails if: lastUnitOfLineEndingAt uses the whole frontmatter — it steps
    // back onto line 1's "\n" instead of staying on the empty line.
    const editor = makeEditor("a: 1\n\nbb: 2", "body");
    place(editor, 0);
    keys(editor, "i");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 1, 1 + 6),
      ),
    );
    keys(editor, "Escape");
    expect(offset(editor)).toBe(5); // the empty line's start
  });
});

describe("a trailing YAML newline is an empty last line", () => {
  it("Esc after typing a trailing newline stays on the empty last line", () => {
    // The line end clamp runs after Esc and still sees the block as one line.
    // Fails if: terminalClampTarget does not treat the end after a trailing
    // "\n" like the end after a hard break — it backs onto that "\n" (4).
    const editor = makeEditor("a: 1", "body");
    place(editor, 1);
    keys(editor, "A");
    editor.view.dispatch(editor.state.tr.insertText("\n"));
    keys(editor, "Escape");
    expect(mode(editor)).toBe("normal");
    expect(offset(editor)).toBe(5);
  });

  it("outside frontmatter a trailing newline character is no line boundary", () => {
    // sourceLineSpan splits on "\n" only inside frontmatter, so the clamp
    // must not exempt a paragraph whose text ends with one. Fails if:
    // endsAfterYamlNewline drops its frontmatter check — the caret stays
    // past the last unit.
    const editor = makeEditor("a: 1", "ab\n");
    const end = posOfBody(editor, "ab\n") + 3;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
    );
    expect(editor.state.selection.head).toBe(end - 1);
  });

  it("the clamp still backs off the end of a block without a trailing newline (control)", () => {
    const editor = makeEditor("a: 1\nbb", "body");
    place(editor, 1);
    keys(editor, "A", "Escape");
    expect(offset(editor)).toBe(6);
  });
});

describe("a CRLF line ending is one unit", () => {
  it("a forward range ending at a CRLF line start lands on the last character, not the line ending", () => {
    // "\r\n" is ONE grapheme. Fails if: sourceLineSpan ends the line between
    // "\r" and "\n" — the landing is the CRLF cluster at offset 1.
    const editor = makeEditor("a\r\nb", "body");
    place(editor, 0);
    keys(editor, "i");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 1, 1 + 3),
      ),
    );
    keys(editor, "Escape");
    expect(editor.state.selection.empty).toBe(true);
    expect(offset(editor)).toBe(0);
  });
});

describe("paragraphs and code blocks are unchanged", () => {
  it("k into multi-line frontmatter keeps its column walk (lineSpanAt not narrowed)", () => {
    // Control for the vertical model: the frontmatter is still one line.
    const editor = makeEditor("ab\ncdef", "xyz");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, posOfBody(editor, "xyz") + 2),
      ),
    );
    keys(editor, "k");
    expect(offset(editor)).toBe(2);
  });
});

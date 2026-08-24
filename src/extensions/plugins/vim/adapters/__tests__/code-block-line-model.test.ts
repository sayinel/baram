// §298 (PR 307 device finding) — a code block is ONE cursor line to PM vim.
//
// WHAT BROKE: `j` from the paragraph above a code block landed on a different
// code line depending on which column the cursor started from. Measured:
//
//   col=0  -> code line 1
//   col=6  -> code line 2
//   col=12 -> code line 3
//
// Because `codeBlock` declares `content: "text*"` it is a TEXTBLOCK, so
// collectLines treats it as a single segment and splitSegments only breaks on
// `hardBreak` nodes — a code block's newlines are literal characters inside
// one text node. The column-preserving walk then reuses the column as a raw
// offset into the block's source, which is why a caret further right dives
// further down.
//
// The contract: entering a code block always lands at its FIRST line. The
// CodeMirror island owns movement inside the block from then on (Phase 0b), so
// PM vim has no business picking a line in there — and it certainly must not
// pick one by accident of the previous paragraph's width.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../../../../pipeline/md-to-pm";
import { createBaramExtensions } from "../../../../index";
import { resolveMotion } from "../motions";

const editors: Editor[] = [];

/** 1-based source line of `pos` inside the code block at `at`. */
function codeLineOf(pos: number, at: number, text: string): number {
  const offset = pos - (at + 1);
  return text.slice(0, Math.max(0, offset)).split("\n").length;
}

/** Top-level offset of the first node of a type, plus its text. */
function findNode(
  editor: Editor,
  typeName: string,
): { at: number; text: string } {
  let at = -1;
  let text = "";
  editor.state.doc.forEach((node, offset) => {
    if (at < 0 && node.type.name === typeName) {
      at = offset;
      text = node.textContent;
    }
  });
  expect(at).toBeGreaterThanOrEqual(0);
  return { at, text };
}

function makeEditor(md: string): Editor {
  const editor = new Editor({
    content: "<p></p>",
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
});

describe("j into a code block ignores the starting column", () => {
  const md = "abcdefghijklmnop\n\n```python\nx = 1\ny = 2\nz = 3\n```\n";

  it("lands on the FIRST code line from every column", () => {
    const editor = makeEditor(md);
    const code = findNode(editor, "codeBlock");
    let para = -1;
    editor.state.doc.forEach((node, offset) => {
      if (para < 0 && node.isTextblock && node.textContent.startsWith("abc")) {
        para = offset + 1;
      }
    });

    const landings = [0, 2, 6, 8, 12, 15].map((col) => {
      const target = resolveMotion(editor.state, para + col, "lineDown", 1);
      return codeLineOf(target, code.at, code.text);
    });

    expect(landings).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("the landing position is the block's content start", () => {
    const editor = makeEditor(md);
    const code = findNode(editor, "codeBlock");
    let para = -1;
    editor.state.doc.forEach((node, offset) => {
      if (para < 0 && node.isTextblock && node.textContent.startsWith("abc")) {
        para = offset + 1;
      }
    });

    // From the far right of the paragraph — the worst case on device.
    const target = resolveMotion(editor.state, para + 15, "lineDown", 1);
    expect(target).toBe(code.at + 1);
  });
});

describe("k out of a code block still leaves it", () => {
  it("from a code block, k reaches the paragraph above", () => {
    const editor = makeEditor("above\n\n```py\na = 1\nb = 2\n```\n");
    const code = findNode(editor, "codeBlock");

    const target = resolveMotion(editor.state, code.at + 1, "lineUp", 1);

    const $target = editor.state.doc.resolve(target);
    expect($target.parent.textContent).toBe("above");
  });
});

describe("frontmatter is NOT a CodeMirror island", () => {
  // `frontmatter` is also `code: true`, so a `spec.code` predicate caught it
  // too and `k` into it jumped to the first YAML character from any column.
  // It renders through NodeViewContent, meaning ProseMirror keeps managing the
  // caret inside it, so the column walk is correct there.
  it("k into frontmatter preserves the column", () => {
    const editor = makeEditor(
      "---\ntitle: hello world\n---\n\nbody paragraph here\n",
    );
    const frontmatter = findNode(editor, "frontmatter");
    let body = -1;
    editor.state.doc.forEach((node, offset) => {
      if (body < 0 && node.isTextblock && node.type.name === "paragraph") {
        body = offset + 1;
      }
    });
    expect(body).toBeGreaterThan(0);

    const fromStart = resolveMotion(editor.state, body, "lineUp", 1);
    const fromColumn4 = resolveMotion(editor.state, body + 4, "lineUp", 1);

    // Landing on the content start from column 0 is ordinary; landing there
    // from column 4 as well is the regression.
    expect(fromStart).toBe(frontmatter.at + 1);
    expect(fromColumn4).toBeGreaterThan(fromStart);
  });
});

describe("ordinary paragraphs keep their column (positive control)", () => {
  // A fix that clamped every vertical move to the line start would satisfy
  // the pins above while destroying normal j/k behaviour.
  it("j between paragraphs preserves the column", () => {
    const editor = makeEditor("abcdefghij\n\nklmnopqrst\n");
    let first = -1;
    let second = -1;
    editor.state.doc.forEach((node, offset) => {
      if (!node.isTextblock) return;
      if (first < 0) first = offset + 1;
      else if (second < 0) second = offset + 1;
    });

    const target = resolveMotion(editor.state, first + 4, "lineDown", 1);

    expect(target).toBe(second + 4);
  });
});

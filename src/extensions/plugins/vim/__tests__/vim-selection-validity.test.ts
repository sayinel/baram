// §298 — every selection vim installs must be a VALID selection.
//
// ProseMirror's `checkTextSelection` warns when a TextSelection endpoint
// resolves outside inline content, but the warning is gated by a module-level
// `warnedAboutTextSelection` flag (prosemirror-state dist:217): it fires ONCE
// per page load and then goes quiet forever. A console-noise pin would
// therefore certify the second offender as clean, so this sweep asserts the
// STRUCTURAL invariant instead — for a TextSelection, both endpoints must sit
// in inline content.
//
// The fixture carries a top-level atom (`<hr>`) because that is what makes a
// doc-level position reachable at all: a text-only `<p>…</p>` document cannot
// discriminate a guarded landing from an unguarded one, which is why the
// existing activation pins (all of them on `<p>one two three</p>`) missed it.

import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../index";
import { resetVimRegister } from "../adapters/register";
import { activateEditorForDocument } from "../vim-activation";
import { vimPluginKey } from "../vim-keys";

const editors: Editor[] = [];

afterEach(() => {
  resetVimRegister();
  for (const e of editors.splice(0)) e.destroy();
});

/** PM's own condition (`checkTextSelection`), applied to both endpoints. */
function invalidEndpoints(editor: Editor): null | string {
  const sel = editor.state.selection;
  if (!(sel instanceof TextSelection)) return null;
  const bad: string[] = [];
  if (!sel.$anchor.parent.inlineContent)
    bad.push(
      `anchor@${String(sel.anchor)} in <${sel.$anchor.parent.type.name}>`,
    );
  if (!sel.$head.parent.inlineContent)
    bad.push(`head@${String(sel.head)} in <${sel.$head.parent.type.name}>`);
  return bad.length > 0 ? bad.join(", ") : null;
}

function key(editor: Editor, k: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: k }),
  );
}

function makeEditor(content: string): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, {
      enabled: true,
      type: "setEnabled",
    }),
  );
  return editor;
}

const DOC = "<p>alpha</p><hr><p>beta</p>";

/** The doc-level position in front of the top-level atom. Computed by walking
 *  the document, NOT as `content.size - 1`: that arithmetic only coincides
 *  with the atom when the atom is the LAST node, and a fixture that quietly
 *  points into a trailing paragraph makes the whole sweep vacuous. */
function atomPos(editor: Editor): number {
  let found: null | number = null;
  editor.state.doc.forEach((node, offset) => {
    if (found === null && node.isAtom && !node.isText) found = offset;
  });
  if (found === null) throw new Error("fixture has no top-level atom");
  return found;
}

/** Every cursor start position, so a sequence gets driven from the atom line
 *  too — not just from comfortable mid-paragraph text. */
function startPositions(editor: Editor): number[] {
  const out: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) out.push(pos + 1);
    return true;
  });
  out.push(atomPos(editor));
  return out;
}

const SEQUENCES: string[][] = [
  // motions
  ["j"],
  ["k"],
  ["G"],
  ["g", "g"],
  ["$"],
  ["0"],
  ["^"],
  ["w"],
  ["b"],
  ["3", "j"],
  ["2", "w"],
  ["2", "b"],
  // find motions
  ["f", "a"],
  ["F", "a"],
  ["t", "a"],
  ["T", "a"],
  ["f", "a", ";"],
  ["f", "a", ","],
  // charwise operators (execute-command runOperatorMotion / operatorFind)
  ["d", "w"],
  ["d", "b"],
  ["d", "$"],
  ["d", "0"],
  ["c", "w"],
  ["c", "b"],
  ["c", "$"],
  ["y", "w"],
  ["y", "b"],
  ["y", "$"],
  ["d", "f", "a"],
  ["d", "t", "a"],
  ["c", "f", "a"],
  ["c", "T", "a"],
  ["y", "f", "a"],
  ["d", "2", "w"],
  ["2", "d", "w"],
  // linewise operators (operations.ts)
  ["d", "d"],
  ["d", "j"],
  ["d", "k"],
  ["d", "G"],
  ["d", "g", "g"],
  ["c", "c"],
  ["y", "y"],
  ["2", "d", "d"],
  ["3", "d", "d"],
  // edit + register
  ["x"],
  ["2", "x"],
  ["p"],
  ["P"],
  ["y", "y", "p"],
  ["y", "y", "P"],
  ["y", "y", "j", "p"],
  ["y", "w", "p"],
  ["d", "d", "p"],
  ["d", "w", "p"],
  // visual
  ["v", "j", "d"],
  ["v", "j", "y"],
  ["V", "j", "d"],
  ["V", "j", "y"],
  ["v", "G", "d"],
  ["V", "G", "d"],
  ["v", "w", "d"],
  ["v", "$", "d"],
  ["v", "j", "Escape"],
  ["V", "j", "Escape"],
  ["v", "Escape"],
  ["V", "Escape"],
  ["v", "j", "x"],
  ["V", "j", "x"],
  // insert entries (atom-insert.ts)
  ["o", "Escape"],
  ["O", "Escape"],
  ["i", "Escape"],
  ["a", "Escape"],
  ["A", "Escape"],
  ["I", "Escape"],
  // screen
  ["z", "z"],
  ["z", "."],
  // `/` search — the StatusBar input is absent in this harness, so the state
  // machine's keydown accumulation path carries the line (vim-search-line.ts
  // header). That is the only way to reach the submit landing from a sweep.
  ["/", "a", "Enter"],
  ["?", "a", "Enter"],
  ["/", "Escape"],
  ["/", "a", "Enter", "n"],
  ["/", "a", "Enter", "N"],
  ["/", "b", "Enter"],
  ["?", "b", "Enter"],
];

describe("vim never installs a selection with a non-inline endpoint", () => {
  it("survives every command sequence from every start position", () => {
    const failures: string[] = [];

    for (const seq of SEQUENCES) {
      const probe = makeEditor(DOC);
      for (const start of startPositions(probe)) {
        const editor = makeEditor(DOC);
        // Park the cursor exactly where the sweep wants it.
        const $s = editor.state.doc.resolve(start);
        editor.view.dispatch(
          editor.state.tr.setSelection(
            $s.parent.inlineContent
              ? TextSelection.create(editor.state.doc, start)
              : NodeSelection.create(editor.state.doc, start),
          ),
        );
        for (const k of seq) key(editor, k);
        const bad = invalidEndpoints(editor);
        if (bad !== null)
          failures.push(`[${seq.join("")}] from ${String(start)}: ${bad}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("activation reset keeps the selection valid (visual head on an atom)", () => {
    const editor = makeEditor(DOC);
    const hr = atomPos(editor);
    expect(editor.state.doc.resolve(hr).parent.type.name).toBe("doc");
    const cur = vimPluginKey.getState(editor.state) as unknown as {
      core: Record<string, unknown>;
    };
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        core: {
          ...cur.core,
          mode: "visual",
          visual: { anchorCursor: hr, headCursor: hr, kind: "char" },
        },
        type: "core",
      }),
    );

    activateEditorForDocument(editor.view);

    expect(invalidEndpoints(editor)).toBeNull();
  });

  it("activation reset keeps the selection valid (NodeSelection + pending op)", () => {
    const editor = makeEditor(DOC);
    const hr = atomPos(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, hr)),
    );
    const cur = vimPluginKey.getState(editor.state) as unknown as {
      core: Record<string, unknown>;
    };
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        core: { ...cur.core, pending: "d" },
        type: "core",
      }),
    );

    activateEditorForDocument(editor.view);

    expect(invalidEndpoints(editor)).toBeNull();
  });
});

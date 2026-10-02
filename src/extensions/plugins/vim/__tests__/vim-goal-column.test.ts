// §298 issue 776 — the goal column (vim's curswant) through the real plugin:
// keydown → core → selection path → plugin state, plus every transaction
// outside vim that has to forget it. Each pin names the mutation that turns it
// red; goals are SEEDED to a value different from the cursor's column so a
// "keep" and a "re-measure" cannot look alike.

import type { GoalColumn, VimCoreState } from "../core/types";

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../index";
import { tagSyntaxRevealEphemeral } from "../../syntax-reveal-state";
import { resetVimRegister } from "../adapters/register";
import { vimPluginKey, withVimExternalEdit } from "../vim-keys";
import { type VimPluginState } from "../vim-plugin-state";
import { submitSearchLine } from "../vim-search-line";

const LONG = "abcdefghij";
const FAR = "ABCDEFGHIJ";

const editors: Editor[] = [];

afterEach(() => {
  resetVimRegister();
  for (const e of editors.splice(0)) e.destroy();
});

function core(editor: Editor): VimCoreState {
  return (vimPluginKey.getState(editor.state) as unknown as VimPluginState)
    .core;
}

function goal(editor: Editor): GoalColumn | null {
  return core(editor).goalColumn;
}

function head(editor: Editor): number {
  return editor.state.selection.head;
}

function keys(editor: Editor, ...sequence: string[]): void {
  for (const k of sequence) {
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: k }),
    );
  }
}

function makeVimEditor(content: string): Editor {
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

function posOfText(editor: Editor, text: string): number {
  let found: null | number = null;
  editor.state.doc.descendants((node, pos) => {
    if (found === null && node.isText && node.text?.includes(text)) {
      found = pos + (node.text?.indexOf(text) ?? 0);
    }
    return found === null;
  });
  if (found === null) throw new Error(`text not found: ${text}`);
  return found;
}

/** Put the vim cursor at `pos` with a remembered goal, through vim's own meta
 *  (a bare selection would be a foreign one and forget the goal). */
function seed(editor: Editor, pos: number, goalColumn: GoalColumn): void {
  editor.view.dispatch(
    editor.state.tr
      .setSelection(TextSelection.create(editor.state.doc, pos))
      .setMeta(vimPluginKey, {
        core: { ...core(editor), goalColumn },
        type: "core",
      }),
  );
}

describe("j/k remember the column across a short line", () => {
  it("j j and 2j return to column 6 (the issue's transcript)", () => {
    // Fails if: the selection path does not write the measured goal into the
    // meta (j j re-measures column 1 on the short line). 2j alone survives
    // that — it fails if the walk carries its clamped column instead.
    const editor = makeVimEditor(`<p>${LONG}</p><p>xy</p><p>${FAR}</p>`);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, posOfText(editor, "g")),
      ),
    );
    keys(editor, "j");
    expect(head(editor)).toBe(posOfText(editor, "y"));
    expect(goal(editor)).toBe(6);
    keys(editor, "j");
    expect(head(editor)).toBe(posOfText(editor, "G"));

    keys(editor, "k", "k");
    expect(head(editor)).toBe(posOfText(editor, "g"));
    keys(editor, "2", "j");
    expect(head(editor)).toBe(posOfText(editor, "G"));
  });

  it("$ then j follows each line's end, past a short line to a longer one", () => {
    // Fails if: core turns `$` into a forgotten goal (null) — the second j
    // would re-measure column 0 on "x".
    const editor = makeVimEditor(`<p>pqr</p><p>x</p><p>${LONG}</p>`);
    seed(editor, posOfText(editor, "p"), 0);
    keys(editor, "$", "j", "j");
    expect(head(editor)).toBe(posOfText(editor, "j"));
  });

  it("visual j measures the goal, remembers it, and moves the head to it", () => {
    // Fails if: the visual branch builds its core from result.state and drops
    // the measured goal — the second j would re-measure column 1 on "xy".
    // Starts with NO goal (a plain selection forgets it) so the first j has
    // to measure and write it back.
    const editor = makeVimEditor(`<p>${LONG}</p><p>xy</p><p>${FAR}</p>`);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, posOfText(editor, "g")),
      ),
    );
    expect(goal(editor)).toBeNull();
    keys(editor, "v", "j", "j");
    expect(core(editor).visual?.headCursor).toBe(posOfText(editor, "G"));
    expect(goal(editor)).toBe(6);
  });
});

describe("a find forgets the goal only when it matched", () => {
  function onXyz(): Editor {
    const editor = makeVimEditor(`<p>xyz</p>`);
    seed(editor, posOfText(editor, "x"), 9);
    return editor;
  }

  it("misses keep it: f F t T, and ; , after a miss", () => {
    // Fails if: goalAfterFind ignores `matched`, or the backward / reversed
    // repeat path reports a miss as a match.
    for (const sequence of [
      ["f", "Q"],
      ["F", "Q"],
      ["t", "Q"],
      ["T", "Q"],
      ["f", "Q", ";"],
      ["f", "Q", ","],
    ]) {
      const editor = onXyz();
      keys(editor, ...sequence);
      expect(goal(editor)).toBe(9);
    }
  });

  it("a match forgets it — a zero-distance t/T too", () => {
    // Fails if: the outcome is judged by "did the cursor move" — `ty` from
    // x and `Tx` from y match without moving.
    const forward = onXyz();
    keys(forward, "f", "z");
    expect(goal(forward)).toBeNull();

    const tillForward = onXyz();
    keys(tillForward, "t", "y");
    expect(head(tillForward)).toBe(posOfText(tillForward, "x"));
    expect(goal(tillForward)).toBeNull();

    const tillBack = makeVimEditor(`<p>xyz</p>`);
    seed(tillBack, posOfText(tillBack, "y"), 9);
    keys(tillBack, "T", "x");
    expect(head(tillBack)).toBe(posOfText(tillBack, "y"));
    expect(goal(tillBack)).toBeNull();
  });
});

describe("a search forgets it, matched or not, on both submit paths", () => {
  it("keyed Enter", () => {
    const editor = makeVimEditor(`<p>xyz</p>`);
    seed(editor, posOfText(editor, "x"), 9);
    keys(editor, "/", "Q", "Enter");
    expect(goal(editor)).toBeNull();
  });

  it("the StatusBar input's submit", () => {
    // Fails if: submitSearchLine stamps its core without goalColumn: null.
    for (const pattern of ["z", "Q"]) {
      const editor = makeVimEditor(`<p>xyz</p>`);
      seed(editor, posOfText(editor, "x"), 9);
      keys(editor, "/", pattern);
      submitSearchLine(editor);
      expect(core(editor).searchLine).toBeNull();
      expect(goal(editor)).toBeNull();
    }
  });
});

describe("transactions outside vim", () => {
  function seeded(): Editor {
    const editor = makeVimEditor(`<p>${LONG}</p><p>${FAR}</p>`);
    seed(editor, posOfText(editor, "c"), 6);
    return editor;
  }

  it("a foreign selection in normal mode (a click) forgets it", () => {
    // Fails if: priority 4 only handles visual mode.
    const editor = seeded();
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, posOfText(editor, "e")),
      ),
    );
    expect(goal(editor)).toBeNull();
  });

  it("an untagged text change forgets it", () => {
    // Fails if: priority 3 keeps the goal.
    const editor = seeded();
    editor.view.dispatch(editor.state.tr.insertText("!", 1));
    expect(goal(editor)).toBeNull();
  });

  it("an explicit external edit forgets it", () => {
    // Fails if: priority 2 keeps the goal.
    const editor = seeded();
    editor.view.dispatch(withVimExternalEdit(editor.state.tr));
    expect(goal(editor)).toBeNull();
  });

  it("syntax reveal's expand/collapse keeps it — and only those", () => {
    // Fails if: forgetsGoal ignores SYNTAX_REVEAL_EPHEMERAL_META.
    const editor = seeded();
    const tr = editor.state.tr.insertText("**", 1);
    tagSyntaxRevealEphemeral(tr);
    editor.view.dispatch(tr);
    expect(goal(editor)).toBe(6);
  });

  it("a code-block boundary handoff and an island suspension forget it", () => {
    // Fails if: reduce's setMode / setSuspended keep the goal.
    const boundary = seeded();
    boundary.view.dispatch(
      boundary.state.tr.setMeta(vimPluginKey, {
        boundary: true,
        mode: "normal",
        type: "setMode",
      }),
    );
    expect(goal(boundary)).toBeNull();

    const island = seeded();
    island.view.dispatch(
      island.state.tr.setMeta(vimPluginKey, {
        island: "math",
        suspended: true,
        type: "setSuspended",
      }),
    );
    expect(goal(island)).toBeNull();
  });

  it("a mousedown forgets it before the click lands", () => {
    // Fails if: the plugin's mousedown handler is removed — a click that
    // syntax reveal turns into an expansion is tagged ephemeral and would
    // otherwise keep the old goal.
    const editor = seeded();
    editor.view.dom.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    expect(goal(editor)).toBeNull();
  });
});

describe("syntax reveal on the way (full extension set)", () => {
  it("j j j across a bold short line ends on column 6, the goal held at each step", () => {
    // Fails if: either syntax reveal transaction (the expansion dispatched
    // after the move, or the collapse appended to the next one) forgets the
    // goal — the third line is short so a collapse-only loss still shows.
    const editor = makeVimEditor(
      `<p>${LONG}</p><p><strong>xy</strong></p><p>pq</p><p>${FAR}</p>`,
    );
    seed(editor, posOfText(editor, "g"), 6);
    for (let i = 0; i < 3; i++) {
      keys(editor, "j");
      expect(goal(editor)).toBe(6);
    }
    expect(head(editor)).toBe(posOfText(editor, "G"));
  });
});

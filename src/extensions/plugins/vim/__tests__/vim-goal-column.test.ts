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
import {
  readVimRegister,
  resetVimRegister,
  writeVimRegister,
} from "../adapters/register";
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
    // Fails if: goalAfter keeps the goal for a search (vim normal_search
    // forgets it before searching, so a miss forgets it too).
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
  it("an untagged text change maps a visual range even with no goal", () => {
    // The reducer's priority 3 returns early when there is nothing to do.
    // Fails if: that equality gate ignores the visual range — an insertion
    // before it would leave the anchor on a different character.
    const editor = makeVimEditor("<p>abcdef</p>");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)),
    );
    keys(editor, "v", "l");
    expect(goal(editor)).toBeNull();
    const visual = core(editor).visual;
    expect(visual?.anchorCursor).toBe(3); // "c"
    editor.view.dispatch(editor.state.tr.insertText("Z", 1));
    expect(core(editor).visual?.anchorCursor).toBe(4); // still "c"
  });

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

  it("a press that moves nothing keeps it — a right-click, a Cmd-click on a link", () => {
    // Fails if: the press itself clears the goal (the old mousedown handler)
    // instead of arming a watch that waits for the cursor to move.
    const editor = seeded();
    editor.view.dom.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    editor.view.dispatch(editor.state.tr.setMeta("noop", true)); // a view update
    expect(goal(editor)).toBe(6);
  });

  it("a press whose cursor move is tagged ephemeral (a click syntax reveal expands) forgets it", () => {
    // Fails if: the appendTransaction takeMovedPress step is removed — the tagged
    // move is exempt in the reducer, so nothing else forgets the goal.
    const editor = seeded();
    editor.view.dom.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    const tr = editor.state.tr.insertText("!", 1);
    tr.setSelection(
      TextSelection.create(tr.doc, tr.mapping.map(posOfText(editor, "e"))),
    );
    tagSyntaxRevealEphemeral(tr);
    editor.view.dispatch(tr);
    expect(goal(editor)).toBeNull();
  });

  it("the watch stays armed through a transaction that moves nothing", () => {
    // A press, an unrelated view update, THEN the tagged reveal move.
    // Fails if: takeMovedPress disarms on the first transaction whose cursor
    // did not move — the later tagged move would keep the goal.
    const editor = seeded();
    editor.view.dom.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    editor.view.dispatch(editor.state.tr.setMeta("noop", true));
    expect(goal(editor)).toBe(6);
    const tr = editor.state.tr.insertText("!", 1);
    tr.setSelection(
      TextSelection.create(tr.doc, tr.mapping.map(posOfText(editor, "e"))),
    );
    tagSyntaxRevealEphemeral(tr);
    editor.view.dispatch(tr);
    expect(goal(editor)).toBeNull();
  });

  it("an ordinary click forgets it once, with no extra transaction", () => {
    // Fails if: takeMovedPress drops its "already forgotten" guard — it would append
    // a second, redundant meta to every ordinary click. Counted through
    // applyTransaction: appended transactions are not separate dispatches.
    const editor = seeded();
    editor.view.dom.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    const { state, transactions } = editor.state.applyTransaction(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, posOfText(editor, "e")),
      ),
    );
    expect(
      (vimPluginKey.getState(state) as unknown as VimPluginState).core
        .goalColumn,
    ).toBeNull();
    expect(transactions).toHaveLength(1);
  });

  it("a press left armed is not read against another document's state (a cached tab)", () => {
    // Fails if: takeMovedPress drops the document check — the other state's own
    // cursor move would be taken for the press's and its goal forgotten.
    const editor = seeded();
    // Another tab's cached state, built BEFORE the press like a real cache:
    // a different document with its own goal. (Building it after the press
    // would run appendTransaction and consume the watch on the way.)
    const base = editor.state.apply(editor.state.tr.insertText("Z", 1));
    const cached = base.apply(
      base.tr.setMeta(vimPluginKey, {
        core: { ...core(editor), goalColumn: 9 },
        type: "core",
      }),
    );
    editor.view.dom.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    editor.view.updateState(cached);
    editor.view.dispatch(
      editor.state.tr
        .setSelection(
          TextSelection.create(editor.state.doc, posOfText(editor, "h")),
        )
        .setMeta(vimPluginKey, { core: core(editor), type: "core" }),
    );
    expect(goal(editor)).toBe(9);
  });

  it("a press whose tagged move ends past a line forgets the goal AND clamps the caret", () => {
    // Fails if: appendClampAndGoalReset returns a goal-only transaction first:
    // the caret stays at 12 instead of being clamped to 11.
    const editor = seeded();
    editor.view.dom.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    const lineEnd = posOfText(editor, "j") + 1; // past the last character
    const tr = editor.state.tr.insertText("!", 1);
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(lineEnd)));
    tagSyntaxRevealEphemeral(tr);
    editor.view.dispatch(tr);
    expect(goal(editor)).toBeNull();
    expect(head(editor)).toBe(posOfText(editor, "j"));
  });

  it("pointerdown arms the watch too (touch and pen)", () => {
    // Fails if: only mousedown arms it.
    const editor = seeded();
    editor.view.dom.dispatchEvent(
      new Event("pointerdown", { bubbles: true, cancelable: true }),
    );
    const tr = editor.state.tr.insertText("!", 1);
    tr.setSelection(
      TextSelection.create(tr.doc, tr.mapping.map(posOfText(editor, "e"))),
    );
    tagSyntaxRevealEphemeral(tr);
    editor.view.dispatch(tr);
    expect(goal(editor)).toBeNull();
  });

  it("the next key disarms it, so a j after a still click keeps the goal", () => {
    // Fails if: keydown does not disarm — the j's own cursor move would be
    // read as the press moving the cursor, and the goal forgotten.
    const editor = seeded();
    editor.view.dom.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    keys(editor, "j");
    expect(goal(editor)).toBe(6);
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

describe("`:N` lands on the line's first non-blank, like gg/G (issue 776)", () => {
  it(":2 Enter", () => {
    // Fails if: the ex jump keeps cursorLineStart's line start.
    const editor = makeVimEditor("<p>x</p>");
    editor.commands.setContent({
      content: ["top", "  second"].map((text) => ({
        content: [{ text, type: "text" }],
        type: "paragraph",
      })),
      type: "doc",
    });
    keys(editor, ":", "2", "Enter");
    expect(head(editor)).toBe(posOfText(editor, "second"));
  });
});

describe("an operator its motion cancelled keeps the goal column (issue 776)", () => {
  it("dfQ with no Q on the line changes nothing and keeps the goal", () => {
    // Fails if: the handler passes cancelled as false to goalAfterOperator: the goal is null.
    const editor = makeVimEditor("<p>xyz</p>");
    seed(editor, posOfText(editor, "x"), 9);
    keys(editor, "d", "f", "Q");
    expect(editor.state.doc.textContent).toBe("xyz");
    expect(goal(editor)).toBe(9);
  });

  it("cfQ with no Q returns to normal and keeps the goal", () => {
    // Fails if: the goal is decided before the recovery to normal mode: the goal is null.
    const editor = makeVimEditor("<p>xyz</p>");
    seed(editor, posOfText(editor, "x"), 9);
    keys(editor, "c", "f", "Q");
    expect(editor.state.doc.textContent).toBe("xyz");
    expect(core(editor).mode).toBe("normal");
    expect(goal(editor)).toBe(9);
  });

  it("dj on the last line deletes nothing and keeps the goal", () => {
    // Fails if: the handler passes cancelled as false to goalAfterOperator: the goal is null.
    const editor = makeVimEditor("<p>abcdefghij</p><p>xy</p><p>z</p>");
    seed(editor, posOfText(editor, "z"), 6);
    keys(editor, "d", "j");
    expect(editor.state.doc.textContent).toBe("abcdefghijxyz");
    expect(goal(editor)).toBe(6);
  });

  it("dk on the first line deletes nothing and keeps the goal", () => {
    // Fails if: the handler passes cancelled as false to goalAfterOperator: the goal is null.
    const editor = makeVimEditor("<p>abcdefghij</p><p>xy</p><p>z</p>");
    seed(editor, posOfText(editor, "a"), 6);
    keys(editor, "d", "k");
    expect(editor.state.doc.textContent).toBe("abcdefghijxyz");
    expect(goal(editor)).toBe(6);
  });

  it("dj and dk between a list item and its nested child still run", () => {
    // The item and its child are ONE line unit, so the span counts 1 while
    // j and k move between them.
    // Fails if: the cancellation asks span.count === 1 instead of whether
    // the motion moved — the item survives and the goal stays 6.
    const nested =
      "<ul><li><p>it1</p></li><li><p>it2</p><ul><li><p>ne</p></li></ul></li></ul><p>tl</p>";
    for (const [from, motion] of [
      ["it2", "j"],
      ["ne", "k"],
    ] as const) {
      const editor = makeVimEditor(nested);
      seed(editor, posOfText(editor, from), 6);
      keys(editor, "d", motion);
      expect(editor.state.doc.textContent, motion).not.toContain("it2");
      expect(goal(editor), motion).toBeNull();
    }
  });

  it("yj on the last line keeps the register and goal", () => {
    // Fails if: the handler passes cancelled as false to goalAfterOperator: the goal is null.
    const editor = makeVimEditor("<p>abcdefghij</p><p>xy</p><p>z</p>");
    writeVimRegister({
      kind: "char",
      slice: editor.state.doc.slice(1, 3).toJSON(),
    });
    const register = readVimRegister();
    seed(editor, posOfText(editor, "z"), 6);
    keys(editor, "y", "j");
    expect(editor.state.doc.textContent).toBe("abcdefghijxyz");
    expect(readVimRegister()).toBe(register);
    expect(goal(editor)).toBe(6);
  });

  it("cj on the last line returns to normal and keeps the goal", () => {
    // Fails if: the goal is decided before the recovery to normal mode: the goal is null.
    const editor = makeVimEditor("<p>abcdefghij</p><p>xy</p><p>z</p>");
    seed(editor, posOfText(editor, "z"), 6);
    keys(editor, "c", "j");
    expect(editor.state.doc.textContent).toBe("abcdefghijxyz");
    expect(core(editor).mode).toBe("normal");
    expect(goal(editor)).toBe(6);
  });

  it("d3j with one line below deletes both lines and forgets the goal", () => {
    // Fails if: a partial vertical walk is cancelled: the two trailing lines survive.
    const editor = makeVimEditor("<p>abcdefghij</p><p>xy</p><p>z</p>");
    seed(editor, posOfText(editor, "x"), 6);
    keys(editor, "d", "3", "j");
    expect(editor.state.doc.textContent).toBe("abcdefghij");
    expect(editor.state.doc.childCount).toBe(1);
    expect(goal(editor)).toBeNull();
  });

  it("dgg on the first line deletes it and forgets the goal", () => {
    // Fails if: the cancellation guard includes docStart/docEnd: the line survives.
    const editor = makeVimEditor("<p>abcdefghij</p><p>xy</p><p>z</p>");
    seed(editor, posOfText(editor, "a"), 6);
    keys(editor, "d", "g", "g");
    expect(editor.state.doc.textContent).toBe("xyz");
    expect(editor.state.doc.childCount).toBe(2);
    expect(goal(editor)).toBeNull();
  });

  it("dG on the last line deletes it and forgets the goal", () => {
    // Fails if: the cancellation guard includes docStart/docEnd: the line survives.
    const editor = makeVimEditor("<p>abcdefghij</p><p>xy</p><p>z</p>");
    seed(editor, posOfText(editor, "z"), 6);
    keys(editor, "d", "G");
    expect(editor.state.doc.textContent).toBe("abcdefghijxy");
    expect(editor.state.doc.childCount).toBe(2);
    expect(goal(editor)).toBeNull();
  });
});

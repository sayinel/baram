// §298 Vim Phase 1 core — state machine tests (design §14 S1).
//
// The core is pure, so these run without a DOM or a ProseMirror document.
// Two properties get as much attention as the commands themselves:
//   - pass-through: normal mode must NOT swallow Cmd+S or the menu chords
//   - operator sequences: a half-typed `d` must not leak into the next key

import type { CoreCommand, KeyToken, VimCoreState } from "../types";

import { describe, expect, it } from "vitest";

import { step } from "../state-machine";
import { initialCoreState } from "../types";

function key(k: string, mods: Partial<KeyToken> = {}): KeyToken {
  return { alt: false, ctrl: false, key: k, mod: false, shift: false, ...mods };
}

/** Feed a sequence of bare keys, returning the final state and last command. */
function run(
  keys: string[],
  start: VimCoreState = initialCoreState(),
  cursor = 10,
): { commands: CoreCommand[]; state: VimCoreState } {
  const commands: CoreCommand[] = [];
  let state = start;
  for (const k of keys) {
    const r = step(state, key(k), { cursor });
    state = r.state;
    if (r.command) commands.push(r.command);
  }
  return { commands, state };
}

describe("mode entry and exit", () => {
  it("i/a/I/A enter insert with the right anchor", () => {
    for (const [k, at] of [
      ["i", "atCursor"],
      ["a", "afterCursor"],
      ["I", "lineStart"],
      ["A", "lineEnd"],
    ] as const) {
      const { commands, state } = run([k]);
      expect(commands).toEqual([{ at, type: "enterInsert" }]);
      expect(state.mode).toBe("insert");
    }
  });

  it("Escape leaves insert without emitting an edit", () => {
    const { commands, state } = run(["Escape"], initialCoreState("insert"));
    expect(commands).toEqual([]);
    expect(state.mode).toBe("normal");
  });

  it("v anchors visual at the supplied cursor; Escape collapses it", () => {
    const entered = step(initialCoreState(), key("v"), { cursor: 42 });
    expect(entered.command).toEqual({ type: "enterVisual" });
    expect(entered.state.visual).toEqual({ anchorCursor: 42, headCursor: 42 });

    const left = step(entered.state, key("Escape"), { cursor: 42 });
    expect(left.command).toEqual({ type: "leaveVisual" });
    expect(left.state.mode).toBe("normal");
    expect(left.state.visual).toBeNull();
  });
});

describe("counts", () => {
  it("accumulates multi-digit prefixes", () => {
    const { commands } = run(["5", "0", "j"]);
    expect(commands).toEqual([{ count: 50, motion: "lineDown", type: "move" }]);
  });

  it("treats a leading 0 as the line-start motion, not a count", () => {
    const { commands } = run(["0"]);
    expect(commands).toEqual([{ count: 1, motion: "lineStart", type: "move" }]);
  });

  it("carries the count across an operator sequence", () => {
    const { commands } = run(["3", "d", "d"]);
    expect(commands).toEqual([{ count: 3, type: "deleteLine" }]);
  });

  it("resets the count after the command consumes it", () => {
    const { commands } = run(["3", "j", "j"]);
    expect(commands).toEqual([
      { count: 3, motion: "lineDown", type: "move" },
      { count: 1, motion: "lineDown", type: "move" },
    ]);
  });
});

describe("operator sequences", () => {
  it("dd deletes lines and yy yanks them", () => {
    expect(run(["d", "d"]).commands).toEqual([
      { count: 1, type: "deleteLine" },
    ]);
    expect(run(["y", "y"]).commands).toEqual([{ count: 1, type: "yankLine" }]);
  });

  it("gg jumps to the document start", () => {
    expect(run(["g", "g"]).commands).toEqual([
      { count: 1, motion: "docStart", type: "move" },
    ]);
  });

  it("an aborted operator consumes the next key instead of running it", () => {
    // `dx` must not fall through to `x` — that would delete a character the
    // user never asked for.
    const { commands, state } = run(["d", "x"]);
    expect(commands).toEqual([]);
    expect(state.pending).toBeNull();
    expect(state.count).toBeNull();
  });

  it("Escape cancels a pending operator without leaving normal mode", () => {
    const { commands, state } = run(["2", "d", "Escape"]);
    expect(commands).toEqual([]);
    expect(state.mode).toBe("normal");
    expect(state.pending).toBeNull();
    expect(state.count).toBeNull();
  });
});

describe("visual mode keys", () => {
  const inVisual = (): VimCoreState => ({
    count: null,
    mode: "visual",
    pending: null,
    visual: { anchorCursor: 5, headCursor: 9 },
  });

  it("d and x both delete the selection and return to normal", () => {
    for (const k of ["d", "x"]) {
      const r = step(inVisual(), key(k), { cursor: 9 });
      expect(r.command).toEqual({ type: "deleteVisual" });
      expect(r.state.mode).toBe("normal");
      expect(r.state.visual).toBeNull();
    }
  });

  it("y yanks and v toggles back out", () => {
    expect(step(inVisual(), key("y"), { cursor: 9 }).command).toEqual({
      type: "yankVisual",
    });
    expect(step(inVisual(), key("v"), { cursor: 9 }).command).toEqual({
      type: "leaveVisual",
    });
  });

  it("motions stay motions in visual mode (the adapter moves the head)", () => {
    const r = step(inVisual(), key("j"), { cursor: 9 });
    expect(r.command).toEqual({ count: 1, motion: "lineDown", type: "move" });
    expect(r.state.mode).toBe("visual");
  });
});

describe("pass-through — the core must not eat the app's keys", () => {
  it("lets Mod chords through in normal mode", () => {
    for (const k of ["s", "c", "v", "x", "/"]) {
      const r = step(initialCoreState(), key(k, { mod: true }), { cursor: 0 });
      expect(r.handled).toBe(false);
      expect(r.command).toBeNull();
    }
  });

  it("lets unknown Ctrl chords through but claims <C-r> for redo", () => {
    expect(
      step(initialCoreState(), key("t", { ctrl: true }), { cursor: 0 }).handled,
    ).toBe(false);
    const redo = step(initialCoreState(), key("r", { ctrl: true }), {
      cursor: 0,
    });
    expect(redo.command).toEqual({ count: 1, type: "redo" });
  });

  it("passes every insert-mode key except Escape", () => {
    const insert = initialCoreState("insert");
    for (const k of ["a", "ㅁ", "j", "d"]) {
      expect(step(insert, key(k), { cursor: 0 }).handled).toBe(false);
    }
  });

  it("swallows unmapped bare keys in normal mode so they cannot type", () => {
    const r = step(initialCoreState(), key("ㅁ"), { cursor: 0 });
    expect(r.handled).toBe(true);
    expect(r.command).toBeNull();
  });
});

describe("normal-mode edits", () => {
  it("x deletes forward, p/P paste on either side, u undoes", () => {
    expect(run(["2", "x"]).commands).toEqual([
      { count: 2, type: "deleteCharForward" },
    ]);
    expect(run(["p"]).commands).toEqual([
      { after: true, count: 1, type: "paste" },
    ]);
    expect(run(["P"]).commands).toEqual([
      { after: false, count: 1, type: "paste" },
    ]);
    expect(run(["u"]).commands).toEqual([{ count: 1, type: "undo" }]);
  });

  it("o and O open a line and enter insert", () => {
    const below = run(["o"]);
    expect(below.commands).toEqual([{ below: true, type: "openLine" }]);
    expect(below.state.mode).toBe("insert");
    expect(run(["O"]).commands).toEqual([{ below: false, type: "openLine" }]);
  });
});

describe("arrow keys are motions (device report)", () => {
  it.each([
    ["ArrowLeft", "charLeft"],
    ["ArrowRight", "charRight"],
    ["ArrowUp", "lineUp"],
    ["ArrowDown", "lineDown"],
    ["Home", "lineStart"],
    ["End", "lineEnd"],
    ["^", "lineFirstNonBlank"],
  ] as const)("%s → %s in normal mode", (k, motion) => {
    const result = step(initialCoreState("normal"), key(k), { cursor: 0 });
    expect(result.handled).toBe(true);
    expect(result.command).toEqual({ count: 1, motion, type: "move" });
  });

  it("counts apply: 3 ArrowDown moves three lines", () => {
    let state = initialCoreState("normal");
    state = step(state, key("3"), { cursor: 0 }).state;
    const result = step(state, key("ArrowDown"), { cursor: 0 });
    expect(result.command).toEqual({
      count: 3,
      motion: "lineDown",
      type: "move",
    });
  });

  it("arrows in visual mode move the head too", () => {
    let state = initialCoreState("normal");
    state = step(state, key("v"), { cursor: 0 }).state;
    const result = step(state, key("ArrowRight"), { cursor: 0 });
    expect(result.command).toEqual({
      count: 1,
      motion: "charRight",
      type: "move",
    });
    expect(result.state.mode).toBe("visual");
  });
});

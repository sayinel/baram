// §298 issue 776 — the goal column rule in the core (core/goal-column.ts).
//
// Every case starts from a REMEMBERED goal (7, or "lineEnd") — starting from
// null would let a "keep" mutated into "forget" pass unnoticed. Each block
// names the mutation that turns it red.

import type { GoalColumn, KeyToken, VimCoreState } from "../types";

import { describe, expect, it } from "vitest";

import { step } from "../state-machine";
import { initialCoreState } from "../types";

function key(k: string, mods: Partial<KeyToken> = {}): KeyToken {
  return { alt: false, ctrl: false, key: k, mod: false, shift: false, ...mods };
}

function seeded(
  goalColumn: GoalColumn = 7,
  over: Partial<VimCoreState> = {},
): VimCoreState {
  return { ...initialCoreState("normal"), goalColumn, ...over };
}

/** Feed keys from `start`; the goal column after the last one. */
function goalAfterKeys(
  keys: (KeyToken | string)[],
  start: VimCoreState = seeded(),
): GoalColumn | null {
  let state = start;
  for (const k of keys) {
    state = step(state, typeof k === "string" ? key(k) : k, {
      cursor: 3,
    }).state;
  }
  return state.goalColumn;
}

describe("j/k keep the goal", () => {
  it("j, k, arrows, counted j", () => {
    // Fails if: goalAfter forgets on lineDown/lineUp.
    for (const keys of [["j"], ["k"], ["ArrowDown"], ["ArrowUp"], ["3", "j"]]) {
      expect(goalAfterKeys(keys)).toBe(7);
      expect(goalAfterKeys(keys, seeded("lineEnd"))).toBe("lineEnd");
    }
  });

  it("keys that emit no command leave it alone — `j` then `2j` keeps it", () => {
    // Fails if: withGoalColumn applies the rule to command-less steps, or a
    // count digit / pending operator / ex line keystroke clears the goal.
    for (const keys of [["2"], ["d"], ["g"], ["z"], ["f"], [":"], [":", "w"]]) {
      expect(goalAfterKeys(keys)).toBe(7);
    }
    expect(goalAfterKeys(["/", "q", "Escape"])).toBe(7); // abandoned search
    expect(goalAfterKeys(["Escape"])).toBe(7); // nothing pending
    expect(goalAfterKeys(["Q"])).toBe(7); // unmapped, swallowed
  });
});

describe("$ sets the line-end goal", () => {
  it("$ and End", () => {
    // Fails if: lineEnd forgets (null) instead of "lineEnd".
    expect(goalAfterKeys(["$"])).toBe("lineEnd");
    expect(goalAfterKeys(["End"])).toBe("lineEnd");
  });
});

describe("other moves and every change forget it", () => {
  it("horizontal and document moves", () => {
    // Fails if: any of these keeps the goal.
    for (const keys of [
      ["h"],
      ["l"],
      ["w"],
      ["b"],
      ["0"],
      ["^"],
      ["G"],
      ["g", "g"],
    ]) {
      expect(goalAfterKeys(keys)).toBeNull();
    }
  });

  it("edits, history, insert entry, yank", () => {
    // Fails if: goalAfter keeps the goal for any of these variants.
    for (const keys of [
      ["x"],
      ["d", "d"],
      ["d", "w"],
      ["y", "y"],
      ["p"],
      ["u"],
      [key("r", { ctrl: true })],
      ["o"],
    ]) {
      expect(goalAfterKeys(keys)).toBeNull();
    }
    // Asserted right after entry — an Esc afterwards would mask a mutation
    // that kept the goal on enterInsert.
    expect(goalAfterKeys(["i"])).toBeNull();
  });

  it("insert Esc forgets it", () => {
    // Fails if: step's insert Escape branch keeps the goal.
    expect(goalAfterKeys(["Escape"], seeded(7, { mode: "insert" }))).toBeNull();
  });

  it("an executed search forgets it", () => {
    // Fails if: search keeps the goal.
    expect(goalAfterKeys(["/", "q", "Enter"])).toBeNull();
  });
});

describe("cursor-preserving commands keep it", () => {
  it("zz keeps, z. forgets", () => {
    // Fails if: scrollCursor ignores firstNonBlank.
    expect(goalAfterKeys(["z", "z"])).toBe(7);
    expect(goalAfterKeys(["z", "."])).toBeNull();
  });

  it("v/V and toggling visual off keep; visual Escape forgets (vim nv_esc)", () => {
    // Fails if: leaveVisual ignores its reason.
    expect(goalAfterKeys(["v"])).toBe(7);
    expect(goalAfterKeys(["v", "v"])).toBe(7);
    expect(goalAfterKeys([key("V", { shift: true })])).toBe(7);
    expect(goalAfterKeys(["v", "Escape"])).toBeNull();
  });

  it(":w keeps, :3 and :$ forget", () => {
    // Fails if: exCommand forgets regardless of name, or keeps for a jump.
    expect(goalAfterKeys([":", "w", "Enter"])).toBe(7);
    expect(goalAfterKeys([":", "3", "Enter"])).toBeNull();
    expect(goalAfterKeys([":", "$", "Enter"])).toBeNull();
  });

  it("a find is left to the adapter (it knows whether it matched)", () => {
    // Fails if: findChar forgets in the core — a miss would lose the goal.
    expect(goalAfterKeys(["f", "x"])).toBe(7);
    expect(
      goalAfterKeys([";"], seeded(7, { lastFind: { char: "x", kind: "f" } })),
    ).toBe(7);
  });
});

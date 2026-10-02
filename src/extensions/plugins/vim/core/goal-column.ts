// §298 Vim core — the goal column rule (issue 776, vim's curswant).
//
// j/k remember the column they set out from, so a short line on the way does
// not lose it. Which commands keep that memory and which forget it is decided
// HERE, for every CoreCommand: the switch has no default, so a new variant
// does not compile until it says what it does to the goal. Forgetting is
// lazy (null) like vim's w_set_curswant — the adapters measure the cursor's
// column only when the next j/k needs it, never on an ordinary keystroke.
//
// Two answers depend on the document and are not made here: a find (f/t/;/,)
// forgets the goal only when it MATCHED (vim nv_csearch returns before
// touching curswant on a miss), so the adapter reports the outcome through
// goalAfterFind. A search forgets it either way (vim normal_search sets
// curswant before searching).

import type { CoreCommand, GoalColumn } from "./types";

/** `:N` / `:$` — the ex names that move the cursor (issue 487). Shared with
 *  the selection path that executes them, so the two cannot disagree. */
const EX_LINE_JUMP = /^(\d+|\$)$/;

/** The goal column after `command` ran from a state whose goal was `prev`. */
export function goalAfter(
  prev: GoalColumn | null,
  command: CoreCommand,
): GoalColumn | null {
  switch (command.type) {
    case "changeLine":
    case "deleteCharForward":
    case "deleteLine":
    case "deleteVisual":
    case "enterInsert":
    case "openLine":
    case "operatorFind":
    case "operatorMotion":
    case "paste":
    case "redo":
    case "search":
    case "toggleTask":
    case "undo":
    case "yankLine":
    case "yankVisual":
      // Every operator re-sets curswant in vim, yank included (ops.c
      // do_pending_operator), and so do put, undo and redo.
      return null;
    case "enterVisual":
    case "findChar": // decided by the adapter — goalAfterFind
      return prev;
    case "exCommand":
      return isExLineJump(command.name) ? null : prev;
    case "leaveVisual":
      return command.reason === "escape" ? null : prev;
    case "move":
      if (command.motion === "lineDown" || command.motion === "lineUp") {
        return prev;
      }
      return command.motion === "lineEnd" ? "lineEnd" : null;
    case "scrollCursor":
      // zz keeps the cursor; z. moves it to the first non-blank.
      return command.firstNonBlank ? null : prev;
  }
}

/** A find forgets the goal only when it matched — a miss leaves the cursor
 *  and the goal where they were. */
export function goalAfterFind(
  prev: GoalColumn | null,
  matched: boolean,
): GoalColumn | null {
  return matched ? null : prev;
}

export function isExLineJump(name: string): boolean {
  return EX_LINE_JUMP.test(name.trim());
}

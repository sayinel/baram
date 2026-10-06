// §298 Vim core — the goal column rule (issue 776, vim's curswant).
//
// j/k remember the column they set out from, so a short line on the way does
// not lose it. Which commands keep that memory and which forget it is decided
// HERE, for every CoreCommand: the switch has no default, so a new variant
// does not compile until it says what it does to the goal. Forgetting is
// lazy (null) like vim's w_set_curswant — the adapters measure the goal
// column only when the next j/k needs it, not on the key that forgot it.
//
// Document-dependent outcomes are resolved outside the core: a find (f/t/;/,)
// forgets the goal only when it MATCHED (vim nv_csearch returns before
// touching curswant on a miss), so the adapter reports the outcome through
// goalAfterFind. A search forgets it either way (vim normal_search sets
// curswant before searching). An operator forgets the goal when it runs, and
// whether it ran is the adapter's to say: goalAfterOperator gives the goal
// back to one its motion cancelled.

import type { CoreCommand, GoalColumn } from "./types";

import { isExLineJump } from "./command-lines";

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
    case "operatorFind": // unless the motion cancelled it —
    case "operatorMotion": // goalAfterOperator
    case "paste":
    case "redo":
    case "search":
    case "toggleTask":
    case "undo":
    case "yankLine":
    case "yankVisual":
      // An executed operator re-sets curswant in vim, yank included (ops.c
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

/**
 * The goal once the adapter has said whether an operator ran. `before` is the
 * goal from before the key, `after` the one the key left (goalAfter forgot
 * it, and so does the recovery of a change to normal mode).
 *
 * An operator its motion cancelled did not run — vim's clearopbeep — and
 * keeps curswant. The adapter cancels on two paths: runOperatorFind when the
 * find has no match, and runOperatorMotion when a j or k cannot leave its
 * line. The other nine motions (core Motion) do not cancel it. gg and G
 * always have a line to act on, and for the rest Neovim 0.12.5 agrees: an
 * operator whose h, l, 0, ^, $, w or b cannot move (dh at a line start, d$
 * on an empty line, db at the buffer start) changes nothing either but
 * re-sets curswant, which is what forgetting does here.
 *
 * Forgetting first and giving the goal back is the safe order: a path that
 * skips this call re-measures the column, it does not keep a stale one.
 */
export function goalAfterOperator(
  before: GoalColumn | null,
  after: GoalColumn | null,
  cancelled: boolean,
): GoalColumn | null {
  return cancelled ? before : after;
}

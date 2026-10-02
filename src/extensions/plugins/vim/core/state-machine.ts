// §298 Vim Phase 1 core — the modal state machine (design §14 S1).
//
// One keystroke in, at most one intent out. No ProseMirror, no DOM: the only
// document knowledge that crosses this boundary is a cursor position, as a
// plain number, so the whole modal layer is unit-testable.
//
// The pass-through rule matters as much as the commands: `handled: false`
// means "this key is not ours". Swallowing everything in normal mode would
// eat Cmd+S and the platform menu accelerators (design §5).

import type { KeyToken, StepResult, VimCoreState } from "./types";

import { exLineStep, searchLineStep } from "./command-lines";
import { goalAfter } from "./goal-column";
import { handleEscape, normalKey } from "./normal-keys";
import { resolvePending } from "./pending-keys";
import {
  applyDigit,
  emit,
  isCountDigit,
  isFindKind,
  MOTIONS,
  pass,
  REVERSED_FIND,
  swallow,
  takeCount,
} from "./step-kit";
import { visualKey } from "./visual-keys";

/** Context the caller supplies alongside the key. */
export interface StepContext {
  /** Where the cursor is right now — needed to anchor visual mode. */
  cursor: number;
}

/**
 * Feed one keystroke to the core.
 *
 * Insert mode is deliberately almost inert here — the design routes insert
 * Escape through PM's `handleKeyDown` so it inherits composition handling
 * (§3), and every other insert keystroke is ordinary typing the core must not
 * touch.
 */
export function step(
  state: VimCoreState,
  token: KeyToken,
  ctx: StepContext,
): StepResult {
  if (state.mode === "insert") {
    if (token.key === "Escape" && !token.mod && !token.ctrl && !token.alt) {
      // Leaving insert re-measures the goal column: whatever was typed
      // moved the cursor (issue 776).
      return swallow({
        ...state,
        count: null,
        goalColumn: null,
        mode: "normal",
        pending: null,
        pendingCount: null,
      });
    }
    return pass(state);
  }
  return withGoalColumn(state, normalOrVisualStep(state, token, ctx));
}

function normalOrVisualStep(
  state: VimCoreState,
  token: KeyToken,
  ctx: StepContext,
): StepResult {
  // An open ex line owns every key until it is submitted or abandoned —
  // this must come before the chord and count branches (PR 307 review).
  if (state.searchLine !== null) return searchLineStep(state, token);
  if (state.exLine !== null) return exLineStep(state, token);

  // <C-r> is vim's redo. Every other chord belongs to the app.
  if (token.ctrl && !token.alt) {
    if (token.key === "r") {
      const { count, next } = takeCount(state);
      return emit(next, { count, type: "redo" });
    }
    return pass(state);
  }
  if (token.mod || token.alt) return pass(state);

  if (token.key === "Escape") return handleEscape(state);
  if (state.pending !== null) return resolvePending(state, token);
  if (isCountDigit(state, token.key))
    return swallow(applyDigit(state, token.key));

  if (isFindKind(token.key)) {
    return swallow({ ...state, pending: token.key });
  }
  if (token.key === ";" || token.key === ",") {
    const { count, next } = takeCount(state);
    const last = state.lastFind;
    if (!last) return swallow(next);
    const kind = token.key === ";" ? last.kind : REVERSED_FIND[last.kind];
    return emit(next, {
      char: last.char,
      count,
      kind,
      repeat: true,
      type: "findChar",
    });
  }

  const motion = MOTIONS[token.key];
  if (motion) {
    const { count, next } = takeCount(state);
    return emit(next, { count, motion, type: "move" });
  }

  if (state.mode === "visual") return visualKey(state, token);
  return normalKey(state, token, ctx);
}

/** Apply the goal column rule (goal-column.ts) to whatever command the key
 *  produced. A key that produced no command — a count digit, an operator
 *  waiting for its motion, an ex line keystroke — leaves the goal alone, so
 *  `j` then `2j` still remembers it. */
function withGoalColumn(prev: VimCoreState, result: StepResult): StepResult {
  if (result.command === null) return result;
  const goalColumn = goalAfter(prev.goalColumn, result.command);
  if (goalColumn === result.state.goalColumn) return result;
  return { ...result, state: { ...result.state, goalColumn } };
}

// §298 Vim core — shared step primitives (issue 776 split).
//
// The motion table, count arithmetic, and the StepResult constructors every
// key handler of the state machine returns through.

import type {
  CoreCommand,
  FindKind,
  Motion,
  OperatorKey,
  StepResult,
  VimCoreState,
} from "./types";

/** Bare keys that are motions in both normal and visual mode. Arrow keys
 *  are first-class vim motions too — and on a non-editable view nothing
 *  else can move the caret, since PM's own arrow handling sits behind the
 *  editable gate (device finding). */
export const MOTIONS: Record<string, Motion> = {
  $: "lineEnd",
  0: "lineStart",
  "^": "lineFirstNonBlank",
  ArrowDown: "lineDown",
  ArrowLeft: "charLeft",
  ArrowRight: "charRight",
  ArrowUp: "lineUp",
  b: "wordBack",
  End: "lineEnd",
  G: "docEnd",
  h: "charLeft",
  Home: "lineStart",
  j: "lineDown",
  k: "lineUp",
  l: "charRight",
  w: "wordForward",
};

/** Counts are capped like vim's own sanity limit — an unbounded count would
 *  drive adapters into arbitrarily long synchronous loops (review S2-R2). */
export const MAX_COUNT = 9999;

export const REVERSED_FIND: Record<FindKind, FindKind> = {
  f: "F",
  F: "f",
  t: "T",
  T: "t",
};

export function applyDigit(state: VimCoreState, key: string): VimCoreState {
  const digit = Number(key);
  return {
    ...state,
    count: Math.min((state.count ?? 0) * 10 + digit, MAX_COUNT),
  };
}

export function emit(state: VimCoreState, command: CoreCommand): StepResult {
  return { command, handled: true, state };
}

/** Emit an operator command; `c` lands in insert like vim. */
export function emitOperator(
  next: VimCoreState,
  op: OperatorKey,
  count: number,
  motion: Motion,
): StepResult {
  return emit(op === "c" ? { ...next, mode: "insert" } : next, {
    count,
    motion,
    op,
    type: "operatorMotion",
  });
}

/** A digit that continues or starts a count prefix. `0` only counts as a
 *  digit once a prefix exists — otherwise it is the line-start motion. */
export function isCountDigit(state: VimCoreState, key: string): boolean {
  if (!/^[0-9]$/.test(key)) return false;
  return key !== "0" || state.count !== null;
}

export function isFindKind(key: string): key is FindKind {
  return key === "f" || key === "F" || key === "t" || key === "T";
}

export function pass(state: VimCoreState): StepResult {
  return { command: null, handled: false, state };
}

export function swallow(state: VimCoreState): StepResult {
  return { command: null, handled: true, state };
}

/** Consume the pending count, defaulting to 1, and clear the prefix state. */
export function takeCount(state: VimCoreState): {
  count: number;
  next: VimCoreState;
} {
  return {
    count: Math.min((state.count ?? 1) * (state.pendingCount ?? 1), MAX_COUNT),
    next: { ...state, count: null, pending: null, pendingCount: null },
  };
}

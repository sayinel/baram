// §298 Vim Phase 1 core — the modal state machine (design §14 S1).
//
// One keystroke in, at most one intent out. No ProseMirror, no DOM: the only
// document knowledge that crosses this boundary is a cursor position, as a
// plain number, so the whole modal layer is unit-testable.
//
// The pass-through rule matters as much as the commands: `handled: false`
// means "this key is not ours". Swallowing everything in normal mode would
// eat Cmd+S and the platform menu accelerators (design §5).

import type {
  CoreCommand,
  KeyToken,
  Motion,
  StepResult,
  VimCoreState,
} from "./types";

import { startVisual } from "./visual-state";

/** Context the caller supplies alongside the key. */
export interface StepContext {
  /** Where the cursor is right now — needed to anchor visual mode. */
  cursor: number;
}

/** Bare keys that are motions in both normal and visual mode. Arrow keys
 *  are first-class vim motions too — and on a non-editable view nothing
 *  else can move the caret, since PM's own arrow handling sits behind the
 *  editable gate (device finding). */
const MOTIONS: Record<string, Motion> = {
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
      return swallow({ ...state, count: null, mode: "normal", pending: null });
    }
    return pass(state);
  }
  return normalOrVisualStep(state, token, ctx);
}

/** Counts are capped like vim's own sanity limit — an unbounded count would
 *  drive adapters into arbitrarily long synchronous loops (review S2-R2). */
const MAX_COUNT = 9999;

function applyDigit(state: VimCoreState, key: string): VimCoreState {
  const digit = Number(key);
  return {
    ...state,
    count: Math.min((state.count ?? 0) * 10 + digit, MAX_COUNT),
  };
}

function emit(state: VimCoreState, command: CoreCommand): StepResult {
  return { command, handled: true, state };
}

/** Escape: drop any half-typed operator or count before changing mode. */
function handleEscape(state: VimCoreState): StepResult {
  if (state.pending !== null || state.count !== null) {
    return swallow({ ...state, count: null, pending: null });
  }
  if (state.mode === "visual") {
    return emit(
      { ...state, mode: "normal", visual: null },
      { type: "leaveVisual" },
    );
  }
  // Already in normal with nothing pending: vim beeps, we just consume it.
  return swallow(state);
}

/** A digit that continues or starts a count prefix. `0` only counts as a
 *  digit once a prefix exists — otherwise it is the line-start motion. */
function isCountDigit(state: VimCoreState, key: string): boolean {
  if (!/^[0-9]$/.test(key)) return false;
  return key !== "0" || state.count !== null;
}

function normalKey(
  state: VimCoreState,
  token: KeyToken,
  ctx: StepContext,
): StepResult {
  const { count, next } = takeCount(state);

  switch (token.key) {
    case "A":
      return emit(
        { ...next, mode: "insert" },
        { at: "lineEnd", type: "enterInsert" },
      );
    case "a":
      return emit(
        { ...next, mode: "insert" },
        { at: "afterCursor", type: "enterInsert" },
      );
    case "d":
    case "g":
    case "y":
      // Operator/prefix: keep the count, wait for the second key.
      return swallow({ ...state, pending: token.key });
    case "I":
      return emit(
        { ...next, mode: "insert" },
        { at: "lineStart", type: "enterInsert" },
      );
    case "i":
      return emit(
        { ...next, mode: "insert" },
        { at: "atCursor", type: "enterInsert" },
      );
    case "O":
      return emit(
        { ...next, mode: "insert" },
        { below: false, type: "openLine" },
      );
    case "o":
      return emit(
        { ...next, mode: "insert" },
        { below: true, type: "openLine" },
      );
    case "P":
      return emit(next, { after: false, count, type: "paste" });
    case "p":
      return emit(next, { after: true, count, type: "paste" });
    case "u":
      return emit(next, { count, type: "undo" });
    case "v":
      return emit(
        { ...next, mode: "visual", visual: startVisual(ctx.cursor) },
        { type: "enterVisual" },
      );
    case "x":
      return emit(next, { count, type: "deleteCharForward" });
    default:
      // Unmapped bare key. Consume it: normal mode must never type.
      return swallow({ ...state, count: null, pending: null });
  }
}

function normalOrVisualStep(
  state: VimCoreState,
  token: KeyToken,
  ctx: StepContext,
): StepResult {
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

  const motion = MOTIONS[token.key];
  if (motion) {
    const { count, next } = takeCount(state);
    return emit(next, { count, motion, type: "move" });
  }

  if (state.mode === "visual") return visualKey(state, token);
  return normalKey(state, token, ctx);
}

function pass(state: VimCoreState): StepResult {
  return { command: null, handled: false, state };
}

/** Second key of a `d`/`y`/`g` sequence. */
function resolvePending(state: VimCoreState, token: KeyToken): StepResult {
  const { count, next } = takeCount(state);
  const pending = state.pending;

  if (pending === "d" && token.key === "d") {
    return emit(next, { count, type: "deleteLine" });
  }
  if (pending === "y" && token.key === "y") {
    return emit(next, { count, type: "yankLine" });
  }
  if (pending === "g" && token.key === "g") {
    return emit(next, { count, motion: "docStart", type: "move" });
  }
  // Anything else aborts the sequence, exactly like vim. The key is consumed:
  // letting `dx` fall through to `x` would delete a character the user never
  // asked to delete.
  return swallow({ ...state, count: null, pending: null });
}

function swallow(state: VimCoreState): StepResult {
  return { command: null, handled: true, state };
}

/** Consume the pending count, defaulting to 1, and clear the prefix state. */
function takeCount(state: VimCoreState): { count: number; next: VimCoreState } {
  return {
    count: state.count ?? 1,
    next: { ...state, count: null, pending: null },
  };
}

function visualKey(state: VimCoreState, token: KeyToken): StepResult {
  const cleared: VimCoreState = {
    ...state,
    count: null,
    mode: "normal",
    pending: null,
    visual: null,
  };
  switch (token.key) {
    case "d":
    case "x":
      return emit(cleared, { type: "deleteVisual" });
    case "v":
      return emit(cleared, { type: "leaveVisual" });
    case "y":
      return emit(cleared, { type: "yankVisual" });
    default:
      // Unknown key in visual mode: consume it so it cannot reach the
      // document, but leave the selection intact.
      return swallow({ ...state, count: null });
  }
}

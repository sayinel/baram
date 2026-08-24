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
  FindKind,
  KeyToken,
  Motion,
  OperatorKey,
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
      return swallow({
        ...state,
        count: null,
        mode: "normal",
        pending: null,
        pendingCount: null,
      });
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

/** Emit an operator command; `c` lands in insert like vim. */
function emitOperator(
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

/** Keys while an ex line is open. Enter submits, Escape abandons, Backspace
 *  deletes (and closes on the colon itself, as vim does); printable single
 *  characters accumulate. Everything is swallowed either way — an ex line
 *  that let keys through would run them as normal-mode commands. */
function exLineStep(state: VimCoreState, token: KeyToken): StepResult {
  const line = state.exLine ?? "";
  const closed = { ...state, exLine: null };

  if (token.key === "Escape") return swallow(closed);
  if (token.key === "Enter") {
    const name = line.trim();
    if (name === "") return swallow(closed);
    return emit(closed, { name, type: "exCommand" });
  }
  if (token.key === "Backspace") {
    if (line === "") return swallow(closed);
    return swallow({ ...state, exLine: line.slice(0, -1) });
  }
  // `raw` carries the character the user actually produced (a Korean layout
  // reports the jamo there while `key` is the physical-key resolution).
  const char = token.raw ?? token.key;
  if (char.length !== 1 || token.mod || token.ctrl || token.alt) {
    return swallow(state);
  }
  return swallow({ ...state, exLine: line + char });
}

/** Escape: drop any half-typed operator or count before changing mode. */
function handleEscape(state: VimCoreState): StepResult {
  if (state.pending !== null || state.count !== null) {
    return swallow({
      ...state,
      count: null,
      pending: null,
      pendingCount: null,
    });
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
    case "/":
      // A count before `/` multiplies the JUMP in vim; nothing here takes
      // it — drop it like `:` does rather than half-apply it.
      return swallow({
        ...next,
        searchLine: { direction: "forward", text: "" },
      });
    case ":":
      // Open the ex line. A count before `:` is vim's line-range prefix,
      // which no Baram ex command takes — drop it rather than half-apply it.
      return swallow({ ...next, exLine: "" });
    case "?":
      return swallow({
        ...next,
        searchLine: { direction: "backward", text: "" },
      });
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
    case "c":
    case "d":
    case "g":
    case "y":
    case "z":
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
    case "N":
    case "n": {
      const last = state.lastSearch;
      if (last === null) return swallow(next); // silent, like an f miss
      const direction =
        token.key === "n"
          ? last.direction
          : last.direction === "forward"
            ? "backward"
            : "forward";
      return emit(next, {
        count,
        direction,
        pattern: last.pattern,
        type: "search",
      });
    }
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
    case "V":
      return emit(
        { ...next, mode: "visual", visual: startVisual(ctx.cursor, "line") },
        { type: "enterVisual" },
      );
    case "v":
      return emit(
        { ...next, mode: "visual", visual: startVisual(ctx.cursor) },
        { type: "enterVisual" },
      );
    case "x":
      return emit(next, { count, type: "deleteCharForward" });
    default:
      // Unmapped bare key. Consume it: normal mode must never type.
      return swallow({
        ...state,
        count: null,
        pending: null,
        pendingCount: null,
      });
  }
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

function pass(state: VimCoreState): StepResult {
  return { command: null, handled: false, state };
}

/** `/`·`?` line — the exLine's twin: accumulate, Escape closes, Enter emits
 *  the search and records it for `n`/`N`. An empty Enter repeats the LAST
 *  pattern in the line's direction (vim semantics); with no history it just
 *  closes — the same silence as an `f` miss. */
function searchLineStep(state: VimCoreState, token: KeyToken): StepResult {
  const line = state.searchLine;
  if (line === null) return swallow(state);
  const closed = { ...state, searchLine: null };

  if (token.key === "Escape") return swallow(closed);
  if (token.key === "Enter") {
    const pattern = line.text !== "" ? line.text : state.lastSearch?.pattern;
    if (pattern === undefined) return swallow(closed);
    return emit(
      { ...closed, lastSearch: { direction: line.direction, pattern } },
      { count: 1, direction: line.direction, pattern, type: "search" },
    );
  }
  if (token.key === "Backspace") {
    if (line.text === "") return swallow(closed);
    return swallow({
      ...state,
      searchLine: { ...line, text: line.text.slice(0, -1) },
    });
  }
  const char = token.raw ?? token.key;
  if (char.length !== 1 || token.mod || token.ctrl || token.alt) {
    return swallow(state);
  }
  return swallow({
    ...state,
    searchLine: { ...line, text: line.text + char },
  });
}

/** Next key of a `c`/`d`/`y`/`g` sequence. */
const REVERSED_FIND: Record<FindKind, FindKind> = {
  f: "F",
  F: "f",
  t: "T",
  T: "t",
};

function isFindKind(key: string): key is FindKind {
  return key === "f" || key === "F" || key === "t" || key === "T";
}

function resolvePending(state: VimCoreState, token: KeyToken): StepResult {
  const pending = state.pending;

  if (
    pending !== null &&
    pending.length === 2 &&
    isFindKind(pending[1]) &&
    (pending[0] === "c" || pending[0] === "d" || pending[0] === "y")
  ) {
    const char = token.raw ?? token.key;
    if (char.length !== 1 || token.mod || token.ctrl || token.alt) {
      return swallow({
        ...state,
        count: null,
        pending: null,
        pendingCount: null,
      });
    }
    const { count, next } = takeCount(state);
    const op = pending[0] as OperatorKey;
    const kind = pending[1] as FindKind;
    return emit(
      {
        ...next,
        lastFind: { char, kind },
        ...(op === "c" ? { mode: "insert" as const } : {}),
      },
      { char, count, kind, op, type: "operatorFind" },
    );
  }

  if (pending !== null && isFindKind(pending)) {
    // The next key is a LITERAL target — raw beats the layout remap, so a
    // hangul search target stays hangul. Non-character keys abort.
    const char = token.raw ?? token.key;
    if (char.length !== 1 || token.mod || token.ctrl || token.alt) {
      return swallow({
        ...state,
        count: null,
        pending: null,
        pendingCount: null,
      });
    }
    const { count, next } = takeCount(state);
    return emit(
      { ...next, lastFind: { char, kind: pending } },
      { char, count, kind: pending, type: "findChar" },
    );
  }

  // Digits between operator and motion accumulate their OWN count, which
  // multiplies with the operator count at resolution (2d3w = 6 — review
  // ops-R1: decimal concatenation deleted 23 words).
  if (
    /^[0-9]$/.test(token.key) &&
    (token.key !== "0" || state.pendingCount !== null)
  ) {
    const digit = Number(token.key);
    return swallow({
      ...state,
      pendingCount: Math.min((state.pendingCount ?? 0) * 10 + digit, MAX_COUNT),
    });
  }

  const { count, next } = takeCount(state);

  if (pending === "c" || pending === "d" || pending === "y") {
    if (token.key === pending) {
      // Doubled operator: whole-line form.
      if (pending === "d") return emit(next, { count, type: "deleteLine" });
      if (pending === "y") return emit(next, { count, type: "yankLine" });
      return emit({ ...next, mode: "insert" }, { count, type: "changeLine" });
    }
    if (token.key === "g") {
      // dgg and friends — hold the count, wait for the second g.
      return swallow({ ...state, pending: `${pending}g` });
    }
    if (isFindKind(token.key)) {
      // dfx / ctx — hold the operator, wait for the literal target.
      return swallow({ ...state, pending: `${pending}${token.key}` });
    }
    const motion = MOTIONS[token.key];
    if (motion) return emitOperator(next, pending, count, motion);
  }

  if (pending === "g" && token.key === "g") {
    return emit(next, { count, motion: "docStart", type: "move" });
  }
  if (pending === "z") {
    // z. re-centers and homes to the first non-blank; zz keeps the column.
    // The count is spent — vim's [count]z. line targeting is out of scope.
    if (token.key === ".") {
      return emit(next, { firstNonBlank: true, type: "scrollCursor" });
    }
    if (token.key === "z") {
      return emit(next, { firstNonBlank: false, type: "scrollCursor" });
    }
  }
  if (
    (pending === "cg" || pending === "dg" || pending === "yg") &&
    token.key === "g"
  ) {
    return emitOperator(next, pending[0] as OperatorKey, count, "docStart");
  }

  // Anything else aborts the sequence, exactly like vim. The key is consumed:
  // letting `dx` fall through to `x` would delete a character the user never
  // asked to delete.
  return swallow({ ...state, count: null, pending: null, pendingCount: null });
}

function swallow(state: VimCoreState): StepResult {
  return { command: null, handled: true, state };
}

/** Consume the pending count, defaulting to 1, and clear the prefix state. */
function takeCount(state: VimCoreState): { count: number; next: VimCoreState } {
  return {
    count: Math.min((state.count ?? 1) * (state.pendingCount ?? 1), MAX_COUNT),
    next: { ...state, count: null, pending: null, pendingCount: null },
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
    case "V":
      // vim: V in charwise switches the kind; V in linewise exits.
      if (state.visual?.kind === "line") {
        return emit(cleared, { type: "leaveVisual" });
      }
      return emit(
        {
          ...state,
          count: null,
          visual: state.visual ? { ...state.visual, kind: "line" } : null,
        },
        { type: "enterVisual" },
      );
    case "v":
      if (state.visual?.kind === "line") {
        return emit(
          {
            ...state,
            count: null,
            visual: { ...state.visual, kind: "char" },
          },
          { type: "enterVisual" },
        );
      }
      return emit(cleared, { type: "leaveVisual" });
    case "y":
      return emit(cleared, { type: "yankVisual" });
    case "z":
      // Scroll commands work in visual too, selection retained (vim) —
      // resolvePending's z branch preserves mode and visual via takeCount.
      return swallow({ ...state, pending: "z" });
    default:
      // Unknown key in visual mode: consume it so it cannot reach the
      // document, but leave the selection intact.
      return swallow({ ...state, count: null });
  }
}

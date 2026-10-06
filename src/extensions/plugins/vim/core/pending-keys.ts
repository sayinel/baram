// §298 Vim core — the second key of a pending sequence (issue 776 split).
//
// Operators, g/z prefixes, find targets, and operator+find combinations.

import type {
  FindKind,
  KeyToken,
  OperatorKey,
  StepResult,
  VimCoreState,
} from "./types";

import {
  emit,
  emitOperator,
  isFindKind,
  MAX_COUNT,
  MOTIONS,
  swallow,
  takeCount,
} from "./step-kit";

/** Next key of a `c`/`d`/`y`/`g` sequence. */
export function resolvePending(
  state: VimCoreState,
  token: KeyToken,
): StepResult {
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

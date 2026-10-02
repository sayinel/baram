// §298 Vim core — normal-mode bare keys and Escape (issue 776 split).

import type { StepContext } from "./state-machine";
import type { KeyToken, StepResult, VimCoreState } from "./types";

import { emit, swallow, takeCount } from "./step-kit";
import { startVisual } from "./visual-state";

/** Escape: drop any half-typed operator or count before changing mode. */
export function handleEscape(state: VimCoreState): StepResult {
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
      { reason: "escape", type: "leaveVisual" },
    );
  }
  // Already in normal with nothing pending: vim beeps, we just consume it.
  return swallow(state);
}

export function normalKey(
  state: VimCoreState,
  token: KeyToken,
  ctx: StepContext,
): StepResult {
  const { count, next } = takeCount(state);

  switch (token.key) {
    // §298 checklist toggle — deliberately NOT stock vim (which moves right
    // on Space): normal mode had no way to complete a task item, and Space
    // was a dead key (the default below swallows unmapped printables). The
    // pending count is dropped, like the search-line open.
    case " ":
      return emit(next, { type: "toggleTask" });
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

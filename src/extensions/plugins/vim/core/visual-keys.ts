// §298 Vim core — visual-mode bare keys (issue 776 split).

import type { KeyToken, StepResult, VimCoreState } from "./types";

import { emit, swallow } from "./step-kit";

export function visualKey(state: VimCoreState, token: KeyToken): StepResult {
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
        return emit(cleared, { reason: "toggle", type: "leaveVisual" });
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
      return emit(cleared, { reason: "toggle", type: "leaveVisual" });
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

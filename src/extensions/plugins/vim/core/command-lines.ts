// §298 Vim core — the ex `:` and search `/`·`?` lines (issue 776 split).
//
// While either line is open it owns every key.

import type { KeyToken, StepResult, VimCoreState } from "./types";

import { emit, swallow } from "./step-kit";

const EX_LINE_JUMP = /^(\d+|\$)$/;

/** Keys while an ex line is open. Enter submits, Escape abandons, Backspace
 *  deletes (and closes on the colon itself, as vim does); printable single
 *  characters accumulate. Everything is swallowed either way — an ex line
 *  that let keys through would run them as normal-mode commands. */
export function exLineStep(state: VimCoreState, token: KeyToken): StepResult {
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

/** `:N` / `:$` — the ex names that move the cursor (issue 487). Shared by
 *  the goal column rule and the selection path that executes them, so the
 *  two cannot disagree. `name` is already trimmed: exLineStep emits it so. */
export function isExLineJump(name: string): boolean {
  return EX_LINE_JUMP.test(name);
}

/** `/`·`?` line — the exLine's twin: accumulate, Escape closes, Enter emits
 *  the search and records it for `n`/`N`. An empty Enter repeats the LAST
 *  pattern in the line's direction (vim semantics); with no history it just
 *  closes — the same silence as an `f` miss. */
export function searchLineStep(
  state: VimCoreState,
  token: KeyToken,
): StepResult {
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

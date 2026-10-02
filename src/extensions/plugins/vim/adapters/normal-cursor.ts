// §298 — the normal-mode cursor sits ON a unit (issue 776).
//
// motions.ts states the invariant: a normal-mode cursor is a unit start, so
// `l` on the last character stays put and `$` lands ON it. Vim's own motions
// keep it, but the caret still reached the terminal boundary past the last
// unit from outside them — insert Esc kept the insert caret where it was, and
// any change or selection that ends a line under the caret (`x` on the last
// character, a click past the text) left it there. vim backs the caret onto a
// unit: `ins_esc` moves one left, and the cursor is re-checked after a change.
// insertEscTarget is the first, terminalClampTarget (run from the plugin's
// appendTransaction) the second.

import type { EditorState } from "@tiptap/pm/state";

import { isCodeBlockLanding } from "./code-block-landing";
import { segmentSpanAt } from "./cursor-line-columns";
import { prevUnitBoundary } from "./graphemes";

/**
 * Where insert Esc leaves the cursor: one unit left of the insert caret,
 * like vim's `ins_esc`, but never across the line start — an Esc at the
 * start of a line or on an empty one stays. null = leave the selection alone.
 */
export function insertEscTarget(state: EditorState): null | number {
  const span = caretSpan(state);
  return span ? unitBefore(state, span.head, span.from) : null;
}

/**
 * The last unit's start when a normal-mode caret sits on the terminal
 * boundary of a non-empty line, else null. An empty line keeps its caret —
 * there is no unit to stand on, and the EOL widget draws it.
 */
export function terminalClampTarget(state: EditorState): null | number {
  const span = caretSpan(state);
  if (!span || span.head !== span.to) return null;
  return unitBefore(state, span.head, span.from);
}

/** The collapsed caret and its cursor line. null for a range or a
 *  NodeSelection (block atom line), off a textblock (segmentSpanAt), and in a
 *  code block — CodeMirror owns that caret, and a code block's line END is a
 *  legal landing there (code-block-landing.ts). */
function caretSpan(
  state: EditorState,
): null | { from: number; head: number; to: number } {
  const sel = state.selection;
  if (!sel.empty) return null;
  if (isCodeBlockLanding(state, sel.head)) return null;
  const span = segmentSpanAt(state, sel.head);
  return span ? { from: span.from, head: sel.head, to: span.to } : null;
}

/** One unit left of `head`, or null when there is none ON this line: at a
 *  line start prevUnitBoundary returns the head itself (null, not a no-op
 *  move — the clamp runs as an appendTransaction), and after a hard break the
 *  unit before is the break, a step onto the previous segment. */
function unitBefore(
  state: EditorState,
  head: number,
  lineStart: number,
): null | number {
  const prev = prevUnitBoundary(state, head);
  return prev < head && prev >= lineStart ? prev : null;
}

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

import { NodeSelection, Selection } from "@tiptap/pm/state";

import { isCodeBlockLanding } from "./code-block-landing";
import { segmentSpanAt } from "./cursor-line-columns";
import { prevUnitBoundary } from "./graphemes";

/**
 * Where insert Esc leaves the cursor: one unit left of the insert caret,
 * like vim's `ins_esc`, but never across the line start — an Esc at the
 * start of a line or on an empty one stays. null = leave the selection alone.
 *
 * A RANGE made while inserting (Shift+arrows, a drag, select all) collapses:
 * normal mode has one cursor, and a range left behind would be replaced
 * wholesale by the next `i` + typing. A forward range lands on its last unit
 * — the one before the head, on the previous line when the head sits at a
 * line start (Shift+Down ends a range there) — a backward one on the unit at
 * the head. A NodeSelection stays — it is how normal mode stands on a block
 * atom line.
 */
export function insertEscTarget(state: EditorState): null | number {
  const sel = state.selection;
  if (!sel.empty && !(sel instanceof NodeSelection)) {
    if (sel.head < sel.anchor) return sel.head;
    return lastUnitBefore(state, sel.head) ?? sel.head;
  }
  const span = caretSpan(state);
  return span ? unitBefore(state, span.head, span.from) : null;
}

/**
 * The last unit's start when a normal-mode caret sits on the terminal
 * boundary of a non-empty line, else null. An empty line keeps its caret —
 * there is no unit to stand on, and the EOL widget draws it.
 *
 * This runs from appendTransaction on EVERY normal-mode transaction, so it
 * rejects with an O(depth) look at the resolved position before any unit
 * work: a line ends only at the textblock's end or right before a hard break
 * (splitSegments' only separator). No segment list is built.
 */
export function terminalClampTarget(state: EditorState): null | number {
  const sel = state.selection;
  if (!sel.empty || isCodeBlockLanding(state, sel.head)) return null;
  const $head = state.doc.resolve(sel.head);
  if (!$head.parent.isTextblock) return null;
  const atLineEnd =
    $head.parentOffset === $head.parent.content.size ||
    $head.nodeAfter?.type.name === "hardBreak";
  // Right after a hard break the line is empty — the unit before is the break.
  if (!atLineEnd || $head.nodeBefore?.type.name === "hardBreak") return null;
  const prev = prevUnitBoundary(state, sel.head);
  return prev < sel.head ? prev : null;
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

/** The start of the last cursor unit before `head`: on its own line, or —
 *  at a line start — the end of the line before it, found locally (no
 *  document-wide line list: Esc on a huge document must stay cheap). Across a
 *  hard break that is the previous segment; across a block boundary it is the
 *  nearest selectable position before the block — the last cell's text of a
 *  table, a block atom's own position, an empty paragraph's caret. null when
 *  nothing precedes, or when that position is inside a code block: CodeMirror
 *  owns that caret, and landing there would hand focus to the island, which
 *  Esc never does. */
function lastUnitBefore(state: EditorState, head: number): null | number {
  const span = segmentSpanAt(state, head);
  const onLine = span ? unitBefore(state, head, span.from) : null;
  if (onLine !== null) return onLine;
  const $head = state.doc.resolve(head);
  if (span && $head.parent.isTextblock && span.from > $head.start()) {
    // After a hard break: the break node sits right before this segment.
    return lastUnitOfLineEndingAt(state, span.from - 1);
  }
  const before = $head.parent.isTextblock ? $head.before() : head;
  const found = Selection.findFrom(state.doc.resolve(before), -1);
  if (!found) return null;
  if (found instanceof NodeSelection) return found.from;
  if (isCodeBlockLanding(state, found.head)) return null;
  return lastUnitOfLineEndingAt(state, found.head);
}

/** The last unit of the line that ends at `end`, or `end` itself when that
 *  line is empty. */
function lastUnitOfLineEndingAt(state: EditorState, end: number): number {
  const span = segmentSpanAt(state, end);
  return (span && unitBefore(state, end, span.from)) ?? end;
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

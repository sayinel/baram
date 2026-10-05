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

import type { ResolvedPos } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

import { NodeSelection, Selection } from "@tiptap/pm/state";

import { isCodeBlockLanding } from "./code-block-landing";
import { sourceLineSpan } from "./cursor-line-columns";
import { prevUnitBoundary } from "./graphemes";

/**
 * Where insert Esc leaves the cursor: one unit left of the insert caret,
 * like vim's `ins_esc`, but never across the line start — an Esc at the
 * start of a line or on an empty one stays. Inside frontmatter the line is
 * the YAML source line (sourceLineSpan). null = leave the selection alone.
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
    return forwardRangeEscTarget(state, sel.head) ?? sel.head;
  }
  // A caret in a code block is CodeMirror's: stepping it here would also hand
  // focus to the island (dispatchCursor). Off a textblock there is no line.
  if (!sel.empty || isCodeBlockLanding(state, sel.head)) return null;
  const span = sourceLineSpan(state, sel.head);
  return span ? unitBeforeOnLine(state, sel.head, span.from) : null;
}

/**
 * The last unit's start when a normal-mode caret sits on the terminal
 * boundary of a non-empty line, else null. An empty line keeps its caret —
 * there is no unit to stand on, and the EOL widget draws it.
 *
 * This runs from appendTransaction on EVERY normal-mode transaction, so it
 * rejects with an O(depth) look at the resolved position before any unit
 * work. The one-unit step uses containing(), without iterating the text node
 * or building an index. A line ends at the textblock's end or before a hard break
 * (splitSegments' only separator). No segment list is built.
 */
export function terminalClampTarget(state: EditorState): null | number {
  const sel = state.selection;
  if (!sel.empty || isCodeBlockLanding(state, sel.head)) return null;
  const $head = state.doc.resolve(sel.head);
  // Inside a text node is never a line end — and reading nodeAfter there
  // would cut a copy of the node's remaining text on every transaction.
  if (!$head.parent.isTextblock || $head.textOffset !== 0) return null;
  const atLineEnd =
    $head.parentOffset === $head.parent.content.size ||
    $head.nodeAfter?.type.name === "hardBreak";
  // Right after a hard break the line is empty — the unit before is the break.
  if (!atLineEnd || $head.nodeBefore?.type.name === "hardBreak") return null;
  // Same after a trailing YAML newline: the empty last source line
  // (sourceLineSpan). Only the block's end gets here — frontmatter has no
  // hard breaks — so the whole-block model stays intact everywhere else.
  if (endsAfterYamlNewline($head)) return null;
  const prev = prevUnitBoundary(state, sel.head);
  return prev < sel.head ? prev : null;
}

/** Where Esc lands a FORWARD insert range whose head is `head`: the start
 *  of the last cursor unit before it — on its own line, or —
 *  at a line start — the end of the line before it, found locally (no
 *  document-wide line list: Esc on a huge document must stay cheap). Across a
 *  hard break that is the previous segment; across a block boundary it is the
 *  nearest selectable position before the block — the last cell's text of a
 *  table, a block atom's own position, an empty paragraph's caret. A code
 *  block is skipped (the search goes on before it): CodeMirror owns that
 *  caret, and landing there would hand focus to the island, which Esc never
 *  does. null when nothing precedes. */
function forwardRangeEscTarget(
  state: EditorState,
  head: number,
): null | number {
  const span = sourceLineSpan(state, head);
  const onLine = span ? unitBeforeOnLine(state, head, span.from) : null;
  if (onLine !== null) return onLine;
  const $head = state.doc.resolve(head);
  if (span && $head.parent.isTextblock && span.from > $head.start()) {
    // After a hard break (or a YAML newline in frontmatter): the separator
    // sits right before this line.
    return lastUnitOfLineEndingAt(state, span.from - 1);
  }
  const before = $head.parent.isTextblock ? $head.before() : head;
  let found = Selection.findFrom(state.doc.resolve(before), -1);
  while (
    found &&
    !(found instanceof NodeSelection) &&
    isCodeBlockLanding(state, found.head)
  ) {
    found = Selection.findFrom(state.doc.resolve(found.$head.before()), -1);
  }
  if (!found) return null;
  if (found instanceof NodeSelection) return found.from;
  return lastUnitOfLineEndingAt(state, found.head);
}

/** The last unit of the line that ends at `end`, or that line's end
 *  (span.to) when it is empty — `end` itself except before a CRLF. */
function lastUnitOfLineEndingAt(state: EditorState, end: number): number {
  const span = sourceLineSpan(state, end);
  if (!span) return end;
  // span.to, not `end`: before a CRLF the two differ by the "\r" — and `end`
  // sits inside that one-grapheme cluster.
  return unitBeforeOnLine(state, span.to, span.from) ?? span.to;
}

/** One unit left of `head`, or null when there is none ON this line: at a
 *  textblock start prevUnitBoundary returns the head itself (null, so insert
 *  Esc keeps the plain mode dispatch instead of a no-op cursor move); after a
 *  hard break or a YAML newline the unit before is that separator, a step
 *  onto the previous line that the `lineStart` bound rejects. */
function unitBeforeOnLine(
  state: EditorState,
  head: number,
  lineStart: number,
): null | number {
  const prev = prevUnitBoundary(state, head);
  return prev < head && prev >= lineStart ? prev : null;
}

/** The caret sits at the end of frontmatter whose text ends with a newline. */
function endsAfterYamlNewline($head: ResolvedPos): boolean {
  if ($head.parent.type.name !== "frontmatter") return false;
  const before = $head.nodeBefore;
  return before?.isText === true && before.text?.endsWith("\n") === true;
}

// §298 Vim Phase 1 — motions (design §2 adapters, P1/P2, S3).
//
// Pure resolution: EditorState + position + motion → target position. The
// plugin dispatches the selection; nothing here mutates.
//
// Cursor invariant (§6, review S3-R1): a resolved position is always a UNIT
// START — the first code unit of a grapheme cluster, an inline atom's
// boundary, or a block atom's boundary. `l` on the last character stays put
// and `$` lands ON it; columns are counted in units, never UTF-16 offsets,
// so j/k can never split an NFD cluster.
//
// The vertical model is P1's: a "line" is a markdown logical line — every
// hard-break segment, every atom block, and every TABLE ROW (j/k inside a
// table move by row, column-preserving via TableMap). Soft-wrap visual
// lines stay demoted per §13 ("50j 강등").

import type { Motion } from "../core/types";
import type { MotionOptions } from "./vertical-walk";
import type { EditorState } from "@tiptap/pm/state";

import { isCodeBlockLanding } from "./code-block-landing";
import {
  firstNonBlankUnit,
  lineSpanAt,
  lineUnitStarts,
  segmentSpanAt,
  sourceLineSpan,
} from "./cursor-line-columns";
import {
  nextUnitBoundary,
  prevUnitBoundary,
  prevUnitBoundaryIndexed,
} from "./graphemes";
import {
  collectLines,
  firstTextblockIn,
  lastTextblockIn,
} from "./line-sequence";
import { verticalTarget } from "./vertical-walk";
import { wordWalk } from "./word-motions";

/**
 * Where a jump to a whole line lands — gg, G, `:N`: its first non-blank, as
 * vim does with its default `startofline` (issue 776). A code block keeps its
 * content start: CodeMirror owns that caret, and the block's whole source is
 * one span here, so a first non-blank search would skip a blank first source
 * line into the next one.
 */
export function lineJumpTarget(state: EditorState, lineStart: number): number {
  return isCodeBlockLanding(state, lineStart)
    ? lineStart
    : resolveMotion(state, lineStart, "lineFirstNonBlank", 1);
}

/**
 * Resolve a motion to its target position. `count` repeats the unit motion;
 * targets clamp at document edges (vim: excess counts stop at the edge).
 */
export function resolveMotion(
  state: EditorState,
  pos: number,
  motion: Motion,
  count: number,
  options?: MotionOptions,
): number {
  switch (motion) {
    case "charLeft": {
      // A plain h asks for the one cluster before the cursor; only a counted
      // walk indexes the text node (graphemes.ts), so an h after an edit
      // does not pay a pass over a long line.
      const step = count === 1 ? prevUnitBoundary : prevUnitBoundaryIndexed;
      let p = pos;
      for (let i = 0; i < count; i++) {
        const prev = step(state, p);
        if (prev !== p) {
          p = prev;
          continue;
        }
        // At the segment start: a table row is ONE line, so keep walking
        // into the previous cell (PR 307 review).
        const hop = cellHop(state, p, -1);
        if (hop === null) break;
        p = hop;
      }
      return p;
    }
    case "charRight": {
      let p = pos;
      for (let i = 0; i < count; i++) {
        const span = segmentSpanAt(state, p);
        if (!span) break;
        const next = nextUnitBoundary(state, p);
        // A unit must EXIST at the target — the boundary past the last
        // character is not a cursor position (review S3-R1).
        if (next !== p && next < span.to) {
          p = next;
          continue;
        }
        const hop = cellHop(state, p, 1);
        if (hop === null) break;
        p = hop;
      }
      return p;
    }
    case "docEnd": {
      const lines = collectLines(state);
      return lines.length > 0
        ? lineJumpTarget(state, lines[lines.length - 1].start)
        : pos;
    }
    case "docStart": {
      const lines = collectLines(state);
      return lines.length > 0 ? lineJumpTarget(state, lines[0].start) : pos;
    }
    case "lineDown":
      return verticalTarget(state, pos, count, options);
    case "lineEnd": {
      const span = segmentSpanAt(state, pos);
      if (!span) return pos;
      return span.from === span.to
        ? span.from
        : prevUnitBoundary(state, span.to);
    }
    case "lineFirstNonBlank": {
      // The first cursor UNIT that is not blank; an all-blank line falls back
      // to the line start, for ^ and for gg/G/:N through lineJumpTarget.
      // Vim lands near the end of a blank line — a Phase 2 nicety here.
      // Judged per unit (firstNonBlankUnit), not by a regex offset into the
      // line's text: an offset can land inside a grapheme (" " + U+0301 is
      // one unit) and drifts past inline nodes with content (issue 776:
      // gg, G and :N land through here too). Bounded by the YAML source
      // line inside frontmatter (sourceLineSpan) — a blank first YAML line
      // must not send gg to the next line's key.
      const span = sourceLineSpan(state, pos);
      if (!span) return pos;
      return (
        firstNonBlankUnit(state, { end: span.to, start: span.from }) ??
        span.from
      );
    }
    case "lineStart": {
      const span = segmentSpanAt(state, pos);
      return span ? span.from : pos;
    }
    case "lineUp":
      return verticalTarget(state, pos, -count, options);
    case "wordBack":
      return wordWalk(state, pos, count, -1);
    case "wordForward":
      return wordWalk(state, pos, count, 1);
  }
}

/** Step into the neighbouring cell of the SAME table row.
 *
 *  A table row is one cursor line (see collectLines), so h/l have to traverse
 *  the whole row the way they traverse a paragraph. Without this every cell
 *  but the first is unreachable from the keyboard: j/k walk rows by column,
 *  but nothing moves the caret across a cell boundary (PR 307 review).
 *
 *  Returns null outside a table and at the row's edge — `l` never leaves its
 *  line, exactly as in vim. Operators are unaffected: they build their own
 *  half-open endpoint from nextUnitBoundary, so `dl` still stops at the cell. */
function cellHop(state: EditorState, pos: number, dir: -1 | 1): null | number {
  const $pos = state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const role = $pos.node(depth).type.spec.tableRole;
    if (role !== "cell" && role !== "header_cell") continue;

    const rowDepth = depth - 1;
    const row = $pos.node(rowDepth);
    const index = $pos.index(rowDepth);

    if (dir > 0) {
      if (index + 1 >= row.childCount) return null;
      return firstTextblockIn(state, $pos.after(depth));
    }
    if (index === 0) return null;
    const prevCell = $pos.before(depth) - row.child(index - 1).nodeSize;
    const entry = lastTextblockIn(state, prevCell);
    if (entry === null) return null;
    // Land on the last unit START — a caret past the final character is not
    // a normal-mode cursor position.
    const starts = lineUnitStarts(state, lineSpanAt(state, entry));
    return starts.length > 0 ? starts[starts.length - 1] : entry;
  }
  return null;
}

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
import type { EditorState } from "@tiptap/pm/state";

import { TableMap } from "@tiptap/pm/tables";

import { nextUnitBoundary, prevUnitBoundary } from "./graphemes";
import { splitSegments } from "./line-units";

/** One cursor line: a segment's content span, or an atom block boundary. */
interface CursorLine {
  end: number;
  start: number;
}

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/**
 * Resolve a motion to its target position. `count` repeats the unit motion;
 * targets clamp at document edges (vim: excess counts stop at the edge).
 */
export function resolveMotion(
  state: EditorState,
  pos: number,
  motion: Motion,
  count: number,
): number {
  switch (motion) {
    case "charLeft": {
      let p = pos;
      for (let i = 0; i < count; i++) {
        const prev = prevUnitBoundary(state, p);
        if (prev === p) break;
        p = prev;
      }
      return p;
    }
    case "charRight": {
      const span = segmentSpanAt(state, pos);
      if (!span) return pos;
      let p = pos;
      for (let i = 0; i < count; i++) {
        const next = nextUnitBoundary(state, p);
        // A unit must EXIST at the target — the boundary past the last
        // character is not a cursor position (review S3-R1).
        if (next === p || next >= span.to) break;
        p = next;
      }
      return p;
    }
    case "docEnd": {
      const lines = collectLines(state);
      return lines.length > 0 ? lines[lines.length - 1].start : pos;
    }
    case "docStart": {
      const lines = collectLines(state);
      return lines.length > 0 ? lines[0].start : pos;
    }
    case "lineDown":
      return verticalTarget(state, pos, count);
    case "lineEnd": {
      const span = segmentSpanAt(state, pos);
      if (!span) return pos;
      return span.from === span.to
        ? span.from
        : prevUnitBoundary(state, span.to);
    }
    case "lineStart": {
      const span = segmentSpanAt(state, pos);
      return span ? span.from : pos;
    }
    case "lineUp":
      return verticalTarget(state, pos, -count);
    case "wordBack": {
      const lines = collectLines(state);
      let p = pos;
      for (let i = 0; i < count; i++) {
        const prev = wordBackOnce(state, lines, p);
        if (prev === p) break;
        p = prev;
      }
      return p;
    }
    case "wordForward": {
      const lines = collectLines(state);
      let p = pos;
      for (let i = 0; i < count; i++) {
        const next = wordForwardOnce(state, lines, p);
        if (next === p) break;
        p = next;
      }
      return p;
    }
  }
}

// ── unit columns ───────────────────────────────────────────────────────────

/**
 * Every cursor line in document order: hard-break segments, atom blocks,
 * and one ENTRY line per table row (first cell's first textblock — the
 * cell-preserving walk lives in tableVertical). O(doc) per motion command;
 * the §11 gate-5 device pass revisits this against the latency budget.
 */
function collectLines(state: EditorState): CursorLine[] {
  const lines: CursorLine[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.spec.tableRole === "table") {
      node.forEach((row, rowOffset) => {
        const cell = row.firstChild;
        if (!cell) return;
        const cellPos = pos + 1 + rowOffset + 1;
        let entry: CursorLine | null = null;
        cell.forEach((child, childOffset) => {
          if (!entry && child.isTextblock) {
            const start = cellPos + 1 + childOffset + 1;
            entry = { end: start + child.content.size, start };
          }
        });
        if (entry) lines.push(entry);
      });
      return false;
    }
    if (node.isTextblock) {
      for (const seg of splitSegments(node, pos)) {
        lines.push({ end: seg.to, start: seg.from });
      }
      return false;
    }
    if (node.isAtom || node.isLeaf) {
      lines.push({ end: pos, start: pos });
      return false;
    }
    return true; // container — descend
  });
  return lines;
}

/** The line whose span holds `pos`; boundary positions bind to the earliest
 *  line whose end reaches them (cursor-on-break stays on the line before). */
function lineIndexAround(lines: CursorLine[], pos: number): number {
  for (let i = 0; i < lines.length; i++) {
    if (pos <= lines[i].end && pos >= lines[i].start) return i;
    if (pos < lines[i].start) return Math.max(0, i - 1);
  }
  return lines.length - 1;
}

/** The start of the `column`-th unit in a line, clamped to the LAST unit
 *  start — never the end boundary, never inside a cluster (review S3-R1). */
function posAtUnitColumn(
  state: EditorState,
  line: CursorLine,
  column: number,
): number {
  let p = line.start;
  for (let i = 0; i < column; i++) {
    const next = nextUnitBoundary(state, p);
    if (next === p || next >= line.end) break;
    p = next;
  }
  return p;
}

// ── the line sequence ──────────────────────────────────────────────────────

/** The hard-break segment (or whole-textblock span) holding `pos`; null on
 *  an atom boundary. */
function segmentSpanAt(
  state: EditorState,
  pos: number,
): null | { from: number; to: number } {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  const textblockPos = $pos.before($pos.depth);
  const segments = splitSegments($pos.parent, textblockPos);
  return (
    segments.find((s) => pos >= s.from && pos <= s.to) ??
    segments[segments.length - 1]
  );
}

/** Row-wise vertical motion inside a table; null when `pos` is not in a
 *  table or the walk leaves it (the generic line walk takes over). */
function tableVertical(
  state: EditorState,
  pos: number,
  delta: number,
): null | number {
  const $pos = state.doc.resolve(pos);
  let tableDepth = -1;
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.spec.tableRole === "table") {
      tableDepth = d;
      break;
    }
  }
  if (tableDepth < 0 || $pos.depth < tableDepth + 3) return null;

  const table = $pos.node(tableDepth);
  const tableStart = $pos.start(tableDepth);
  const map = TableMap.get(table);
  const cellPos = $pos.before(tableDepth + 2);
  const rect = map.findCell(cellPos - tableStart);
  const targetRow = rect.top + delta;
  if (targetRow < 0 || targetRow >= map.height) return null; // exits the table

  const targetCellPos = tableStart + map.map[targetRow * map.width + rect.left];
  const targetCell = state.doc.nodeAt(targetCellPos);
  if (!targetCell) return null;

  let entry: CursorLine | null = null;
  targetCell.forEach((child, childOffset) => {
    if (!entry && child.isTextblock) {
      const start = targetCellPos + 1 + childOffset + 1;
      entry = { end: start + child.content.size, start };
    }
  });
  if (!entry) return targetCellPos;

  const column = unitColumn(state, $pos.start($pos.depth), pos);
  return posAtUnitColumn(state, entry, column);
}

/** How many units sit between `start` and `pos` (both unit starts). */
function unitColumn(state: EditorState, start: number, pos: number): number {
  let column = 0;
  let p = start;
  while (p < pos) {
    const next = nextUnitBoundary(state, p);
    if (next === p) break;
    p = next;
    column++;
  }
  return column;
}

function verticalTarget(
  state: EditorState,
  pos: number,
  delta: number,
): number {
  // Inside a table: rows are the lines, columns are CELLS (P1 — review
  // S3-R1: j must go to the next row's matching cell, not the next cell).
  const tabular = tableVertical(state, pos, delta);
  if (tabular !== null) return tabular;

  const lines = collectLines(state);
  if (lines.length === 0) return pos;
  const index = lineIndexAround(lines, pos);
  const target = lines[Math.min(Math.max(index + delta, 0), lines.length - 1)];
  const current = lines[index];
  if (target === current) return pos;
  const column = unitColumn(
    state,
    current.start,
    Math.min(Math.max(pos, current.start), current.end),
  );
  return posAtUnitColumn(state, target, column);
}

// ── words ──────────────────────────────────────────────────────────────────

function wordBackOnce(
  state: EditorState,
  lines: CursorLine[],
  pos: number,
): number {
  let index = lineIndexAround(lines, pos);
  let boundary = pos;
  while (index >= 0) {
    const line = lines[index];
    const starts = wordStartsIn(state, line).filter(
      (start) => line.start + start < boundary,
    );
    if (starts.length > 0) return line.start + starts[starts.length - 1];
    index--;
    if (index >= 0) boundary = lines[index].end + 1; // whole previous line
  }
  return pos;
}

function wordForwardOnce(
  state: EditorState,
  lines: CursorLine[],
  pos: number,
): number {
  const index = lineIndexAround(lines, pos);
  const line = lines[index];
  if (line) {
    const next = wordStartsIn(state, line).find(
      (start) => line.start + start > pos,
    );
    if (next !== undefined) return line.start + next;
  }
  // No further word on this line — the start of the next line (vim w).
  return index + 1 < lines.length ? lines[index + 1].start : pos;
}

/** Start offsets (line-relative) of word-like segments in a line. */
function wordStartsIn(state: EditorState, line: CursorLine): number[] {
  // Leaf placeholder keeps offsets aligned: inline atoms are nodeSize 1.
  const text = state.doc.textBetween(line.start, line.end, undefined, " ");
  const starts: number[] = [];
  for (const seg of wordSegmenter.segment(text)) {
    if (seg.isWordLike) starts.push(seg.index);
  }
  return starts;
}

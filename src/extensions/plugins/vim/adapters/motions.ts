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

/** Carried table-walk state: one findCell at entry, local rect expansion
 *  per step afterwards. */
interface TableWalk {
  map: TableMap;
  rect: { bottom: number; left: number; top: number };
  tableStart: number;
}

// ── unit columns ───────────────────────────────────────────────────────────

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
    case "wordBack":
      return wordWalk(state, pos, count, -1);
    case "wordForward":
      return wordWalk(state, pos, count, 1);
  }
}

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

/** Content start of the first textblock inside the node at `pos`. */
function firstTextblockIn(state: EditorState, pos: number): null | number {
  const node = state.doc.nodeAt(pos);
  if (!node) return null;
  let entry: null | number = null;
  node.forEach((child, childOffset) => {
    if (entry === null && child.isTextblock) {
      entry = pos + 1 + childOffset + 1;
    }
  });
  return entry;
}

// ── the line sequence ──────────────────────────────────────────────────────

function initTableWalk(state: EditorState, pos: number): null | TableWalk {
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
  return {
    map,
    rect: { bottom: rect.bottom, left: rect.left, top: rect.top },
    tableStart,
  };
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

/** The current line's span for column math: a hard-break segment (works
 *  inside table cells too) or an atom boundary. */
function lineSpanAt(state: EditorState, pos: number): CursorLine {
  const span = segmentSpanAt(state, pos);
  return span ? { end: span.to, start: span.from } : { end: pos, start: pos };
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

/** The landed cell's rect, expanded from a known slot — O(span), where
 *  findCell would re-scan the whole map. */
function rectAround(
  map: TableMap,
  slotRow: number,
  slotCol: number,
  cellRel: number,
): { bottom: number; left: number; top: number } {
  let top = slotRow;
  while (top > 0 && map.map[(top - 1) * map.width + slotCol] === cellRel) {
    top--;
  }
  let bottom = slotRow + 1;
  while (
    bottom < map.height &&
    map.map[bottom * map.width + slotCol] === cellRel
  ) {
    bottom++;
  }
  let left = slotCol;
  while (left > 0 && map.map[slotRow * map.width + left - 1] === cellRel) {
    left--;
  }
  return { bottom, left, top };
}

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

/**
 * Vertical motion. Each of the |delta| steps applies the CURRENT line's
 * unit column and feeds the clamped landing into the next step — by
 * construction `3j` is exactly `j;j;j`, intermediate clamps included
 * (review S3-R4; a persistent goal column à la vim's curswant is a
 * documented Phase 2 refinement). Walk state is carried: the generic walk
 * keeps its line index, the table walk keeps its map/rect and expands the
 * landed cell's rect locally instead of re-running findCell (review S3-R4:
 * both re-scans made 9999j quadratic).
 */
function verticalTarget(
  state: EditorState,
  pos: number,
  delta: number,
): number {
  const lines = collectLines(state);
  if (lines.length === 0) return pos;
  const direction: -1 | 1 = delta > 0 ? 1 : -1;

  let p = pos;
  let lineIndex: null | number = null;
  let walk: null | TableWalk = null;
  let walkResolved = false;

  for (let i = 0; i < Math.abs(delta); i++) {
    const span = lineSpanAt(state, p);
    const column = unitColumn(
      state,
      span.start,
      Math.min(Math.max(p, span.start), span.end),
    );

    if (!walkResolved) {
      walk = initTableWalk(state, p);
      walkResolved = true;
    }

    let landed: null | number = null;
    if (walk) {
      const nextRow = direction > 0 ? walk.rect.bottom : walk.rect.top - 1;
      if (nextRow < 0 || nextRow >= walk.map.height) {
        walk = null; // exiting the table — the generic walk takes over
      } else {
        const cellRel = walk.map.map[nextRow * walk.map.width + walk.rect.left];
        walk.rect = rectAround(walk.map, nextRow, walk.rect.left, cellRel);
        const cellAbs = walk.tableStart + cellRel;
        landed = firstTextblockIn(state, cellAbs) ?? cellAbs;
        lineIndex = null;
      }
    }

    if (landed === null) {
      if (lineIndex === null) lineIndex = lineIndexAround(lines, p);
      const nextIndex: number = lineIndex + direction;
      if (nextIndex < 0 || nextIndex >= lines.length) break; // doc edge
      landed = lines[nextIndex].start;
      lineIndex = nextIndex;
      walkResolved = false; // the landing may have entered a table
    }

    p = posAtUnitColumn(state, lineSpanAt(state, landed), column);
  }
  return p;
}

// ── words ──────────────────────────────────────────────────────────────────

function wordStartsIn(state: EditorState, line: CursorLine): number[] {
  // Leaf placeholder keeps offsets aligned: inline atoms are nodeSize 1.
  const text = state.doc.textBetween(line.start, line.end, undefined, " ");
  const starts: number[] = [];
  for (const seg of wordSegmenter.segment(text)) {
    if (seg.isWordLike) starts.push(seg.index);
  }
  return starts;
}

function wordWalk(
  state: EditorState,
  pos: number,
  count: number,
  direction: -1 | 1,
): number {
  // The line index is CARRIED across repetitions and word starts are cached
  // per line — restarting lineIndexAround every step made counted motions
  // O(count × lines) (review S3-R2).
  const lines = collectLines(state);
  if (lines.length === 0) return pos;
  const startsCache = new Map<number, number[]>();
  const startsAt = (index: number): number[] => {
    let starts = startsCache.get(index);
    if (!starts) {
      starts = wordStartsIn(state, lines[index]);
      startsCache.set(index, starts);
    }
    return starts;
  };

  let index = lineIndexAround(lines, pos);
  let p = pos;

  for (let i = 0; i < count; i++) {
    if (direction === 1) {
      const line = lines[index];
      const next = startsAt(index).find((start) => line.start + start > p);
      if (next !== undefined) {
        p = line.start + next;
        continue;
      }
      if (index + 1 >= lines.length) break;
      index++;
      p = lines[index].start; // next line start — vim w
      continue;
    }

    // backward: last word start strictly before p, walking lines up.
    let found = false;
    let boundary = p;
    let scan = index;
    while (scan >= 0) {
      const line = lines[scan];
      const starts = startsAt(scan).filter((s) => line.start + s < boundary);
      if (starts.length > 0) {
        p = line.start + starts[starts.length - 1];
        index = scan;
        found = true;
        break;
      }
      scan--;
      if (scan >= 0) boundary = lines[scan].end + 1; // whole previous line
    }
    if (!found) break;
  }
  return p;
}

// §298 Vim Phase 1 — motions (design §2 adapters, P1/P2, S3).
//
// Pure resolution: EditorState + position + motion → target position. The
// plugin dispatches the selection; nothing here mutates.
//
// The vertical model is P1's: a "line" is a markdown logical line — every
// hard-break segment of a textblock, and every interior-less block (math,
// rules) on its own. j/k walk that sequence with column preservation
// (clamped, vim-style); soft-wrap visual lines are out of Phase 1 scope
// (§13 "50j 강등" — documented demotion).

import type { Motion } from "../core/types";
import type { EditorState } from "@tiptap/pm/state";

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
      let p = pos;
      for (let i = 0; i < count; i++) {
        const next = nextUnitBoundary(state, p);
        if (next === p) break;
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
    case "lineEnd":
      return lineAround(state, pos).end;
    case "lineStart":
      return lineAround(state, pos).start;
    case "lineUp":
      return verticalTarget(state, pos, -count);
    case "wordBack": {
      let p = pos;
      for (let i = 0; i < count; i++) {
        const prev = wordBackOnce(state, p);
        if (prev === p) break;
        p = prev;
      }
      return p;
    }
    case "wordForward": {
      let p = pos;
      for (let i = 0; i < count; i++) {
        const next = wordForwardOnce(state, p);
        if (next === p) break;
        p = next;
      }
      return p;
    }
  }
}

// ── the line sequence ──────────────────────────────────────────────────────

/** Every cursor line in document order. O(doc) — fine at Phase 1 sizes;
 *  the virtualization handshake (§11 gate 5) revisits this on-device. */
function collectLines(state: EditorState): CursorLine[] {
  const lines: CursorLine[] = [];
  state.doc.descendants((node, pos) => {
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

function lineAround(state: EditorState, pos: number): CursorLine {
  const lines = collectLines(state);
  return lines[lineIndexAround(lines, pos)] ?? { end: pos, start: pos };
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

function verticalTarget(
  state: EditorState,
  pos: number,
  delta: number,
): number {
  const lines = collectLines(state);
  if (lines.length === 0) return pos;
  const index = lineIndexAround(lines, pos);
  const target = lines[Math.min(Math.max(index + delta, 0), lines.length - 1)];
  if (target === lines[index]) return pos;
  // Column preservation, clamped into the target line (vim-style).
  const column = Math.max(0, pos - lines[index].start);
  return Math.min(target.start + column, target.end);
}

// ── words ──────────────────────────────────────────────────────────────────

function wordBackOnce(state: EditorState, pos: number): number {
  const lines = collectLines(state);
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

function wordForwardOnce(state: EditorState, pos: number): number {
  const lines = collectLines(state);
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

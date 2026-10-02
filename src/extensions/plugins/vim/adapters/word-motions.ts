// §298 — word motions w/b and the cw word end (issue 776 split).
//
// Word starts come from Intl.Segmenter over each cursor line.

import type { EditorState } from "@tiptap/pm/state";

import { type CursorLine, segmentSpanAt } from "./cursor-line-columns";
import { collectLines, lineIndexAround } from "./line-sequence";

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/**
 * End position (exclusive) of the word-like segment containing `pos`, or
 * null when the cursor is not on a word character — vim's cw-acts-as-ce
 * rule needs exactly this (change the word, keep the following space).
 */
export function wordEndAt(state: EditorState, pos: number): null | number {
  const span = segmentSpanAt(state, pos);
  if (!span) return null;
  const text = state.doc.textBetween(span.from, span.to, undefined, " ");
  for (const seg of wordSegmenter.segment(text)) {
    const from = span.from + seg.index;
    const to = from + seg.segment.length;
    if (pos >= from && pos < to) return seg.isWordLike ? to : null;
  }
  return null;
}

export function wordWalk(
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

function wordStartsIn(state: EditorState, line: CursorLine): number[] {
  // Leaf placeholder keeps offsets aligned: inline atoms are nodeSize 1.
  const text = state.doc.textBetween(line.start, line.end, undefined, " ");
  const starts: number[] = [];
  for (const seg of wordSegmenter.segment(text)) {
    if (seg.isWordLike) starts.push(seg.index);
  }
  return starts;
}

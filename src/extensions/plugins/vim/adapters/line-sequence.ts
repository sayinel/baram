// §298 — the cursor line sequence (issue 776 split).
//
// The markdown logical lines j/k, w/b, gg/G and `:N` walk, cached per
// document, plus the textblock entry helpers cell hops and table walks share.

import type { CursorLine } from "./cursor-line-columns";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

import { splitSegments } from "./line-units";

/**
 * Every cursor line of a document, in order: hard-break segments, atom
 * blocks, and one ENTRY line per table row (first cell's first textblock —
 * the cell-preserving walk lives in tableVertical).
 *
 * Cached PER DOCUMENT. Building it walks the whole doc and allocates a line
 * object each time, and verticalTarget/wordWalk want it for every j/k/w/b:
 * that measured ~4.8MB of transient garbage per keystroke on a
 * 10k-paragraph document, roughly 145MB/s under key repeat (performance
 * review P2). A PM doc is immutable, so its identity is a sound key and a
 * WeakMap keeps nothing alive. Callers treat the array as READ-ONLY.
 */
const lineIndex = new WeakMap<PMNode, CursorLine[]>();

export function collectLines(state: EditorState): CursorLine[] {
  const cached = lineIndex.get(state.doc);
  if (cached) return cached;
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
  lineIndex.set(state.doc, lines);
  return lines;
}

/** issue 487 — ex `:N` 줄 이동의 대상: N번째 커서 줄의 시작. 줄 모델은
 *  j/k와 동일(collectLines)이라 hard-break 분절·테이블 행·"코드블록 =
 *  한 줄" 카운트가 자동 일치한다. 본가 vim처럼 범위 밖은 마지막 줄로
 *  클램프, `"$"`는 마지막 줄. 빈 문서면 null. */
export function cursorLineStart(
  state: EditorState,
  line: "$" | number,
): null | number {
  const lines = collectLines(state);
  if (lines.length === 0) return null;
  const index =
    line === "$"
      ? lines.length - 1
      : Math.min(Math.max(line, 1), lines.length) - 1;
  return lines[index].start;
}

/** Content start of the first textblock inside the node at `pos`. */
export function firstTextblockIn(
  state: EditorState,
  pos: number,
): null | number {
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

/** The END of the last textblock in the node at `pos` — where a leftward
 *  cell hop arrives (cellHop then backs up to the last unit start). */
export function lastTextblockIn(
  state: EditorState,
  pos: number,
): null | number {
  const node = state.doc.nodeAt(pos);
  if (!node) return null;
  let entry: null | number = null;
  node.forEach((child, childOffset) => {
    if (child.isTextblock) {
      entry = pos + 1 + childOffset + 1 + child.content.size;
    }
  });
  return entry;
}

/** The line whose span holds `pos`; boundary positions bind to the earliest
 *  line whose end reaches them (cursor-on-break stays on the line before). */
export function lineIndexAround(lines: CursorLine[], pos: number): number {
  for (let i = 0; i < lines.length; i++) {
    if (pos <= lines[i].end && pos >= lines[i].start) return i;
    if (pos < lines[i].start) return Math.max(0, i - 1);
  }
  return lines.length - 1;
}

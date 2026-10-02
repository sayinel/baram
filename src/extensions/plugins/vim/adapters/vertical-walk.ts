// §298 — vertical motion j/k (issue 776 split).
//
// The carried-column line walk and its table branch (TableMap rect walk).

import type { MotionOptions } from "./motions";
import type { EditorState } from "@tiptap/pm/state";

import { TableMap } from "@tiptap/pm/tables";

import { codeBlockLandingAt } from "./code-block-landing";
import { columnOf, lineSpanAt, lineUnitStarts } from "./cursor-line-columns";
import {
  collectLines,
  firstTextblockIn,
  lineIndexAround,
} from "./line-sequence";

/** Carried table-walk state: one findCell at entry, local rect expansion
 *  per step afterwards. */
interface TableWalk {
  map: TableMap;
  rect: { bottom: number; left: number; top: number };
  tableStart: number;
}

/**
 * Vertical motion. Each of the |delta| steps lands on the target line's
 * unit at the CARRIED column, and the clamped landing column feeds the next
 * step — semantically identical to re-deriving the column from the landed
 * position (the landing IS that unit's start), so `3j` stays exactly
 * `j;j;j`, but without re-walking units through doc.resolve: unit starts
 * come from ONE line-local segmentation pass per visited line (review
 * S3-R5: per-step unitColumn walks made 3999j from column 99 take ~10s).
 * A persistent goal column (vim's curswant) remains a Phase 2 refinement.
 * Walk state is carried too: line index outside tables, map/rect inside
 * (review S3-R4).
 */
export function verticalTarget(
  state: EditorState,
  pos: number,
  delta: number,
  options?: MotionOptions,
): number {
  const lines = collectLines(state);
  if (lines.length === 0) return pos;
  const directionalEntry = options?.codeBlockEntry === "directional";
  const direction: -1 | 1 = delta > 0 ? 1 : -1;

  const originStarts = lineUnitStarts(state, lineSpanAt(state, pos));
  let column = columnOf(originStarts, pos);

  let p = pos;
  let lineIndex: null | number = null;
  let walk: null | TableWalk = null;
  let walkResolved = false;

  for (let i = 0; i < Math.abs(delta); i++) {
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

    // Code block landing — 정책은 code-block-landing.ts. 반환이 non-null
    // 이면 착지 확정: 캐리 칼럼을 갱신하지 않고 다음 스텝으로 (counted
    // j/k가 짧은 블록을 관통할 때 칼럼이 살아남는 계약).
    const landing = codeBlockLandingAt(
      state,
      landed,
      direction,
      column,
      directionalEntry,
    );
    if (landing !== null) {
      p = landing;
      continue;
    }

    const starts = lineUnitStarts(state, lineSpanAt(state, landed));
    if (starts.length === 0) {
      p = landed;
      column = 0;
    } else {
      const clamped = Math.min(column, starts.length - 1);
      p = starts[clamped];
      column = clamped;
    }
  }
  return p;
}

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

// §298 — vertical motion j/k (issue 776 split).
//
// The goal-column line walk and its table branch (TableMap rect walk).

import type { GoalColumn } from "../core/types";
import type { EditorState } from "@tiptap/pm/state";

import { TableMap } from "@tiptap/pm/tables";

import { codeBlockLandingAt } from "./code-block-landing";
import { columnAt, lineSpanAt, lineUnitStarts } from "./cursor-line-columns";
import {
  collectLines,
  firstTextblockIn,
  lineIndexAround,
} from "./line-sequence";

/** The numeric column a "lineEnd" goal ($) walks with: larger than any line,
 *  so every landing clamps to that line's last unit (codeBlockLandingAt
 *  receives it too). */
const LINE_END_COLUMN = Number.POSITIVE_INFINITY;

/** Optional per-call motion policy (issue 472). */
export interface MotionOptions {
  /** Vertical landing INTO a CodeMirror-backed code block: "directional"
   *  lands `k`-entry on the block's LAST source line (stock-vim spatial
   *  continuity). The default "first-line" keeps every other caller —
   *  visual head movement, operator ranges — exactly as before: a head
   *  parked mid-block breaks the next walk's column math (the block's
   *  source is one span, so the offset becomes a huge carried column) and
   *  widens/narrows visual d/y ranges, neither of which issue 472
   *  approved (adversarial review). */
  codeBlockEntry?: "directional" | "first-line";
  /** The remembered goal column for j/k (vim's curswant, issue 776). Absent:
   *  the origin's own column — what operators and other one-shot callers
   *  want, since they pick LINES and never carry the goal on. */
  goalColumn?: GoalColumn | null;
}

/** Carried table-walk state: one findCell at entry, local rect expansion
 *  per step afterwards. */
interface TableWalk {
  map: TableMap;
  rect: { bottom: number; left: number; top: number };
  tableStart: number;
}

/**
 * Vertical motion. Each of the |delta| steps lands on the target line's unit
 * at the GOAL column (vim's curswant, issue 776), clamped to that line's last
 * unit — the goal itself never shrinks, so a short or empty line on the way
 * does not lose it and `3j` lands where `j` `j` `j` with the same remembered goal
 * does. The caller passes the goal it remembers; without one, the origin's
 * column is the goal (measured here, once). A code block landing is the
 * exception that codeBlockLandingAt decides: normal mode enters at the goal
 * column of the entry source line, visual mode and operators at the
 * content start ("first-line"); the goal itself survives either way. Unit
 * starts come from ONE line-local segmentation pass per visited line
 * (review S3-R5: per-step unitColumn walks made 3999j from column 99 take
 * ~10s). Walk state is carried: line index outside tables, map/rect inside
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

  const goal = options?.goalColumn ?? columnAt(state, pos);
  // "lineEnd" ($) lands every line on its last unit: the clamp below does it.
  const column = goal === "lineEnd" ? LINE_END_COLUMN : goal;

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
    // 이면 착지 확정, 다음 스텝으로. goal 은 어느 착지에서도 줄지 않으므로
    // counted j/k 가 짧은 블록을 관통해도 칼럼이 살아남는다.
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

    // An empty line or a block atom has no unit to stand on — land on it
    // and keep the goal for the next line.
    const starts = lineUnitStarts(state, lineSpanAt(state, landed));
    p =
      starts.length === 0
        ? landed
        : starts[Math.min(column, starts.length - 1)];
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

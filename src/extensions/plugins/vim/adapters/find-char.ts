// §298 — f/F/t/T find-char resolution (issue 776 split).
//
// Matching is per cursor unit, so hangul targets go through core/hangul.

import type { FindKind } from "../core/types";
import type { EditorState } from "@tiptap/pm/state";

import { findTargetMatches } from "../core/hangul";
import {
  type CursorLine,
  lineUnitStarts,
  segmentSpanAt,
} from "./cursor-line-columns";

/**
 * f/F/t/T — the count-th occurrence of `char` in the CURRENT segment,
 * forward for f/t, backward for F/T; t/T stop one unit short. A miss keeps
 * the cursor where it is (vim: the motion simply fails). Matching is per
 * cursor UNIT, so a hangul target matches its whole grapheme.
 */
export function resolveFindChar(
  state: EditorState,
  pos: number,
  char: string,
  kind: FindKind,
  count: number,
  repeat = false,
): number {
  const span = segmentSpanAt(state, pos);
  if (!span) return pos;
  const line: CursorLine = { end: span.to, start: span.from };
  const starts = lineUnitStarts(state, line);
  const unitText = (index: number): string =>
    state.doc.textBetween(
      starts[index],
      starts[index + 1] ?? line.end,
      undefined,
      "\uFFFC",
    );

  const forward = kind === "f" || kind === "t";
  const till = kind === "t" || kind === "T";
  let remaining = count;
  let matchIndex = -1;

  if (forward) {
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= pos) continue;
      if (!findTargetMatches(unitText(i), char)) continue;
      // A repeated t must not re-match the target it already sits before —
      // its landing would be the current position (review ops-R2).
      if (till && repeat && (starts[i - 1] ?? -1) <= pos) continue;
      if (--remaining === 0) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex < 0) return pos;
    const target = till ? starts[matchIndex - 1] : starts[matchIndex];
    return target !== undefined && target > pos ? target : pos;
  }

  for (let i = starts.length - 1; i >= 0; i--) {
    if (starts[i] >= pos) continue;
    if (!findTargetMatches(unitText(i), char)) continue;
    if (till && repeat && (starts[i + 1] ?? line.end + 1) >= pos) continue;
    if (--remaining === 0) {
      matchIndex = i;
      break;
    }
  }
  if (matchIndex < 0) return pos;
  const target = till ? starts[matchIndex + 1] : starts[matchIndex];
  return target !== undefined && target < pos ? target : pos;
}

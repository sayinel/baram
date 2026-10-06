// §298 — f/F/t/T find-char resolution (issue 776 split).
//
// Matching is per cursor unit, so hangul targets go through core/hangul.

import type { FindKind } from "../core/types";
import type { EditorState } from "@tiptap/pm/state";

import { findTargetMatches } from "../core/hangul";
import {
  type CursorLine,
  forEachLineUnit,
  segmentSpanAt,
} from "./cursor-line-columns";

/** The text a non-text inline node reads as — textBetween's leaf
 *  placeholder: one inline node, one character. */
const INLINE_NODE_TEXT = "\uFFFC";

/**
 * f/F/t/T — the count-th occurrence of `char` in the CURRENT segment,
 * forward for f/t, backward for F/T; t/T stop one unit short. null on a miss
 * (vim: the motion simply fails). A MATCH can still land on `pos` itself — a
 * `t` whose target is the very next unit — which is why the outcome is not
 * "did the cursor move" (the goal column rule needs the difference, issue
 * 776). Matching is per cursor UNIT, so a hangul target matches its whole
 * grapheme.
 */
export function findCharTarget(
  state: EditorState,
  pos: number,
  char: string,
  kind: FindKind,
  count: number,
  repeat = false,
): null | number {
  const span = segmentSpanAt(state, pos);
  if (!span) return null;
  const line: CursorLine = { end: span.to, start: span.from };
  // Unit starts and their text from ONE traversal (forEachLineUnit) — a
  // textBetween per unit restarted the range walk each time. A non-text
  // inline node reads as U+FFFC, as textBetween's leaf placeholder did.
  const starts: number[] = [];
  const texts: string[] = [];
  forEachLineUnit(state, line, (start, text) => {
    starts.push(start);
    texts.push(text ?? INLINE_NODE_TEXT);
    return true;
  });

  const forward = kind === "f" || kind === "t";
  const till = kind === "t" || kind === "T";
  let remaining = count;
  let matchIndex = -1;

  if (forward) {
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= pos) continue;
      if (!findTargetMatches(texts[i], char)) continue;
      // A repeated t must not re-match the target it already sits before —
      // its landing would be the current position (review ops-R2).
      if (till && repeat && (starts[i - 1] ?? -1) <= pos) continue;
      if (--remaining === 0) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex < 0) return null;
    const target = till ? starts[matchIndex - 1] : starts[matchIndex];
    return target !== undefined && target > pos ? target : pos;
  }

  for (let i = starts.length - 1; i >= 0; i--) {
    if (starts[i] >= pos) continue;
    if (!findTargetMatches(texts[i], char)) continue;
    if (till && repeat && (starts[i + 1] ?? line.end + 1) >= pos) continue;
    if (--remaining === 0) {
      matchIndex = i;
      break;
    }
  }
  if (matchIndex < 0) return null;
  const target = till ? starts[matchIndex + 1] : starts[matchIndex];
  return target !== undefined && target < pos ? target : pos;
}

/** findCharTarget with a miss resolved to `pos` — the cursor stays put. */
export function resolveFindChar(
  state: EditorState,
  pos: number,
  char: string,
  kind: FindKind,
  count: number,
  repeat = false,
): number {
  return findCharTarget(state, pos, char, kind, count, repeat) ?? pos;
}

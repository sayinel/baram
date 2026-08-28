// §298 — code block landing policy (issue 372 split).
//
// 코드블록은 PM 스키마상 textblock(content: "text*")이라 수직 워크에는
// "한 줄"로 보이고, 내부 개행은 리터럴 문자다 — 착지 정책(방향·칼럼
// 보존·grapheme 경계)을 여기로 모아 motions는 워크만 남긴다.

import type { EditorState } from "@tiptap/pm/state";

import { columnOf, lineSpanAt, lineUnitStarts } from "./cursor-line-columns";

/** `journal-*` languages render a widget NodeView with no CodeMirror
 *  island (code-block.ts addNodeView) — a hidden-source landing has no
 *  caret to receive the offset, so directional entry applies only to
 *  CM-backed blocks (adversarial review). */
function isCmBackedCodeBlock(state: EditorState, pos: number): boolean {
  const lang = String(state.doc.resolve(pos).parent.attrs.language ?? "");
  return !lang.startsWith("journal-");
}

/** True when `pos` lands in a block whose own editor owns the caret.
 *
 *  `codeBlock` declares `content: "text*"`, so it reads as a textblock and
 *  collectLines records it as ONE line — correct for j/k, wrong for the column
 *  walk, whose unit list would span the block's entire source.
 *
 *  Matched by NAME, not by `spec.code`: `frontmatter` is also `code: true` but
 *  renders through NodeViewContent, so ProseMirror keeps managing the caret
 *  inside it and the column walk is right there. Using the flag made `k` into
 *  frontmatter jump to its first YAML character from any column. */
function isCodeBlockLanding(state: EditorState, pos: number): boolean {
  return state.doc.resolve(pos).parent.type.name === "codeBlock";
}

/** The first/last source line of the code block containing `pos`, as an
 *  absolute start plus length (issue 472). The block's newlines are literal
 *  characters in one text node, so lines are `\n`-delimited slices of the
 *  parent text. parentOffset-derived so any in-block position is safe. */
function codeLineSpan(
  state: EditorState,
  pos: number,
  edge: "first" | "last",
): { length: number; start: number } {
  const $pos = state.doc.resolve(pos);
  const text = $pos.parent.textContent;
  const contentStart = pos - $pos.parentOffset;
  if (edge === "first") {
    const nl = text.indexOf("\n");
    return { length: nl === -1 ? text.length : nl, start: contentStart };
  }
  const nl = text.lastIndexOf("\n");
  const lineStart = nl === -1 ? 0 : nl + 1;
  return { length: text.length - lineStart, start: contentStart + lineStart };
}

/** issue 477 — insert-mode arrow entry target: the directionally adjacent
 *  source line of the code block whose CONTENT starts at `inside`, carrying
 *  the column of the PM caret at `from`. The caret model differs from the
 *  normal-mode walk: an insert caret sits BETWEEN characters and may
 *  legally land at line END, where normal mode clamps to the last
 *  character. Column policy is the shared one (file
 *  header): logical lines — hard breaks split, soft wraps demoted — in
 *  grapheme units, the v1 approximation whose full curswant treatment is
 *  issue 372 tier 1. Returns null for a block with no CodeMirror caret to
 *  receive the offset (journal-* widget NodeViews). */
export function insertEntryTarget(
  state: EditorState,
  from: number,
  inside: number,
  edge: "first" | "last",
): null | number {
  if (!isCmBackedCodeBlock(state, inside)) return null;
  const column = columnOf(lineUnitStarts(state, lineSpanAt(state, from)), from);
  const line = codeLineSpan(state, inside, edge);
  // The carried column is a GRAPHEME index — resolve it through the target
  // line's own grapheme starts instead of adding it as a UTF-16 offset,
  // which would land inside a surrogate pair or combining sequence
  // (adversarial review). Past the last grapheme = line END, the insert
  // caret's extra legal column.
  const starts = lineUnitStarts(state, {
    end: line.start + line.length,
    start: line.start,
  });
  return column < starts.length ? starts[column] : line.start + line.length;
}

/**
 * 수직 워크의 코드블록 착지 (issue 472). null = 코드블록이 아님(일반
 * 분기로). 숫자 = 착지 위치이며, 호출자는 반드시 `continue`로 다음
 * 스텝으로 넘어가고 **캐리 칼럼을 갱신하지 않는다** — journal/기본
 * 착지(landed 그대로)도 여기 포함되어 일반 분기의 칼럼 산술을 절대
 * 타지 않는다 (적대 리뷰: null을 journal로 쓰면 counted j/k의 칼럼이
 * 변한다).
 */
export function codeBlockLandingAt(
  state: EditorState,
  landed: number,
  direction: -1 | 1,
  column: number,
  directional: boolean,
): null | number {
  if (!isCodeBlockLanding(state, landed)) return null;
  if (directional && isCmBackedCodeBlock(state, landed)) {
    // Column-preserving entry (vim's curswant semantics at the block
    // boundary): land on the directionally adjacent source line — the
    // FIRST from above, the LAST from below — at the carried column,
    // clamped to the line's last character like vim across short lines.
    // The carried column is a GRAPHEME index resolved through the target
    // line's own grapheme starts (a UTF-16 add landed inside surrogate
    // pairs). Persistent curswant is issue 372 tier 1.
    const line = codeLineSpan(state, landed, direction < 0 ? "last" : "first");
    const starts = lineUnitStarts(state, {
      end: line.start + line.length,
      start: line.start,
    });
    return starts.length === 0
      ? line.start
      : starts[Math.min(column, starts.length - 1)];
  }
  return landed;
}

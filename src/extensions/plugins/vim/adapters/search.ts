// §298 vim `/` 검색 어댑터 (#372 티어 3에서 승격).
//
// vim의 `/`는 버퍼 안에서만 검색한다 — Baram에서 버퍼 = 열린 문서. 패턴은
// JS RegExp다 (vim 방언이 아니라 — VSCode Vim 등 에뮬레이터 관행): "gm"
// 플래그라 `.`은 줄을 넘지 못하고 `^`/`$`는 줄 단위로 앵커된다. 대소문자는
// smartcase: 패턴에 대문자가 하나도 없으면 무시, 있으면 구분.
//
// 텍스트 추출은 위치 정렬이 생명이다: hardBreak는 개행 1글자로, 그 외
// 인라인 leaf(수식·이미지 atom)는 자리표시 1글자로 바꾼다 — 둘 다
// nodeSize 1이라 `블록시작 + 1 + match.index`가 정확한 문서 위치가 된다.

import type { SearchDirection } from "../core/types";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

/** Inline atom placeholder — outside every real text alphabet, so a pattern
 *  cannot accidentally match through an atom. */
const OBJECT_CHAR = "￼";

/**
 * Document position of the search target, or null for a silent miss (no
 * match, invalid pattern) — the same silence as an `f` miss. `from` is the
 * vim cursor; forward finds the first match strictly after it, backward the
 * last one strictly before, both wrapping (vim's wrapscan). `count` steps
 * that many matches. The returned position is the match START.
 */
export interface SearchOptions {
  /** Synchronous scan budget. The pattern is the USER's own regex — a shared
   *  document cannot run a search — so a pathological one is a self-freeze,
   *  not an attack surface; the budget bounds it to one block's exec and
   *  turns the rest into a silent miss. Worker-based full containment is a
   *  follow-up (#372). */
  budgetMs?: number;
  /** Injected clock so the budget can be pinned without wall-clock flake. */
  now?: () => number;
}

export function resolveSearch(
  state: EditorState,
  from: number,
  pattern: string,
  direction: SearchDirection,
  count: number,
  options: SearchOptions = {},
): null | number {
  const regex = compile(pattern);
  if (regex === null) return null;
  const budgetMs = options.budgetMs ?? 50;
  const now = options.now ?? (() => performance.now());
  const deadline = now() + budgetMs;

  const matches: number[] = [];
  let spent = false;
  state.doc.descendants((node, pos) => {
    if (spent) return false;
    if (!node.isTextblock) return true;
    if (now() > deadline) {
      spent = true;
      return false;
    }
    const text = node.textBetween(0, node.content.size, "\n", leafText);
    regex.lastIndex = 0;
    let boundaries: null | Set<number> = null;
    let previous = -1;
    let m = regex.exec(text);
    while (m !== null) {
      // A zero-length match (e.g. `x*` with no x) would loop forever and
      // means nothing to jump to — skip past it.
      if (m[0].length === 0) {
        regex.lastIndex += 1;
      } else {
        // Match indices are UTF-16 offsets, and a non-unicode regex `.`
        // happily matches HALF a surrogate pair — landing the cursor there
        // lets the next `x` delete half an emoji (adversarial review,
        // reproduced). Only grapheme STARTS are real cursor targets; the
        // boundary set is built lazily, for blocks that match at all.
        boundaries ??= graphemeStarts(text);
        if (boundaries.has(m.index) && m.index !== previous) {
          matches.push(pos + 1 + m.index);
          previous = m.index;
        }
      }
      m = regex.exec(text);
    }
    return false;
  });
  // An incomplete scan must fail CLOSED: the collected early matches would
  // wrap the cursor backward past a real next match the scan never reached —
  // a confident wrong answer is worse than a silent miss (adversarial
  // review, reproduced).
  if (spent) return null;
  if (matches.length === 0) return null;

  const len = matches.length;
  let index: number;
  if (direction === "forward") {
    const next = matches.findIndex((p) => p > from);
    index = next === -1 ? 0 : next; // wrapscan
    index = (index + (count - 1)) % len;
  } else {
    let prev = -1;
    for (let i = len - 1; i >= 0; i--) {
      if (matches[i] < from) {
        prev = i;
        break;
      }
    }
    index = prev === -1 ? len - 1 : prev; // wrapscan
    index = (((index - (count - 1)) % len) + len) % len;
  }
  return matches[index];
}

/** smartcase + always "gm"; an invalid pattern is a miss, not a crash.
 *  Escape opcodes (`\W`, `\S`, `\B`…) are regex syntax, not uppercase
 *  intent — vim's smartcase ignores them too, while an explicit `[A-Z]`
 *  range stays case-sensitive (adversarial review, reproduced with
 *  `\Wfoo` missing " FOO"). Non-ASCII capitals count via \p{Lu}. */
function compile(pattern: string): null | RegExp {
  const literal = pattern.replace(/\\./g, "");
  const flags = /\p{Lu}/u.test(literal) ? "gm" : "gim";
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/** UTF-16 indices where a grapheme begins — the only legal cursor targets. */
function graphemeStarts(text: string): Set<number> {
  const starts = new Set<number>();
  const segmenter = new Intl.Segmenter();
  for (const segment of segmenter.segment(text)) {
    starts.add(segment.index);
  }
  return starts;
}

function leafText(leaf: PMNode): string {
  return leaf.type.name === "hardBreak" ? "\n" : OBJECT_CHAR;
}

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
export function resolveSearch(
  state: EditorState,
  from: number,
  pattern: string,
  direction: SearchDirection,
  count: number,
): null | number {
  const regex = compile(pattern);
  if (regex === null) return null;

  const matches: number[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, "\n", leafText);
    regex.lastIndex = 0;
    let m = regex.exec(text);
    while (m !== null) {
      // A zero-length match (e.g. `x*` with no x) would loop forever and
      // means nothing to jump to — skip past it.
      if (m[0].length === 0) {
        regex.lastIndex += 1;
      } else {
        matches.push(pos + 1 + m.index);
      }
      m = regex.exec(text);
    }
    return false;
  });
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

/** smartcase + always "gm"; an invalid pattern is a miss, not a crash. */
function compile(pattern: string): null | RegExp {
  const flags = /[A-Z]/.test(pattern) ? "gm" : "gim";
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function leafText(leaf: PMNode): string {
  return leaf.type.name === "hardBreak" ? "\n" : OBJECT_CHAR;
}

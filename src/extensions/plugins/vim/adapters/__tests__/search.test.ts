// §298 vim `/` 검색 — resolveSearch 어댑터 (#372 티어 3에서 승격).
//
// vim의 `/`는 버퍼(=열린 문서) 안에서만, 줄 경계를 넘지 않는 매칭이다.
// 여기서는 그 계약을 고정한다: JS RegExp("gm" 플래그 — `.`은 줄을 못
// 넘고 `^`/`$`는 줄 단위), smartcase(패턴에 대문자가 없으면 무시),
// wrapscan(끝에 닿으면 반대편에서 계속), 매치 시작 위치에 착지.
// 텍스트는 위치 정렬로 뽑는다 — hardBreak는 개행 1글자, 인라인 atom은
// 자리표시 1글자(둘 다 nodeSize 1이라 오프셋이 흐트러지지 않는다).

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../../../../pipeline/md-to-pm";
import { createBaramExtensions } from "../../../../index";
import { resolveSearch } from "../search";

const editors: Editor[] = [];

function makeState(md: string) {
  const editor = new Editor({
    content: "<p></p>",
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  return editor.state;
}

/** Absolute doc position of the n-th occurrence (0-based) of `needle` in the
 *  concatenated textblock texts — independent ground truth for the pins. */
function nthOccurrence(
  state: ReturnType<typeof makeState>,
  needle: string,
  n: number,
): number {
  const hits: number[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    let at = text.indexOf(needle);
    while (at !== -1) {
      hits.push(pos + 1 + at);
      at = text.indexOf(needle, at + 1);
    }
    return false;
  });
  expect(hits.length).toBeGreaterThan(n);
  return hits[n];
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
});

describe("forward / backward with wrapscan", () => {
  const md = "alpha bag one\n\nbeta bag two\n\ngamma bag three\n";

  it("forward lands on the next match START after the cursor", () => {
    const state = makeState(md);
    const first = nthOccurrence(state, "bag", 0);
    const second = nthOccurrence(state, "bag", 1);
    expect(resolveSearch(state, first, "bag", "forward", 1)).toBe(second);
  });

  it("forward wraps from the last match to the first", () => {
    const state = makeState(md);
    const last = nthOccurrence(state, "bag", 2);
    const first = nthOccurrence(state, "bag", 0);
    expect(resolveSearch(state, last, "bag", "forward", 1)).toBe(first);
  });

  it("backward lands on the previous match, wrapping at the top", () => {
    const state = makeState(md);
    const first = nthOccurrence(state, "bag", 0);
    const second = nthOccurrence(state, "bag", 1);
    const last = nthOccurrence(state, "bag", 2);
    expect(resolveSearch(state, second, "bag", "backward", 1)).toBe(first);
    expect(resolveSearch(state, first, "bag", "backward", 1)).toBe(last);
  });

  it("a count steps that many matches (wrapping)", () => {
    const state = makeState(md);
    const first = nthOccurrence(state, "bag", 0);
    const third = nthOccurrence(state, "bag", 2);
    expect(resolveSearch(state, first, "bag", "forward", 2)).toBe(third);
    // 3 steps from the first wraps back onto itself
    expect(resolveSearch(state, first, "bag", "forward", 3)).toBe(first);
  });
});

describe("regex semantics", () => {
  it("patterns are JS RegExp", () => {
    const state = makeState("a big dog\n\na bag of rice\n");
    const big = nthOccurrence(state, "big", 0);
    const bag = nthOccurrence(state, "bag", 0);
    expect(resolveSearch(state, 1, "b.g", "forward", 1)).toBe(big);
    expect(resolveSearch(state, big, "b.g", "forward", 1)).toBe(bag);
  });

  it("`.` does not cross a hardBreak (vim: patterns stay on one line)", () => {
    const state = makeState("ab  \ncd\n"); // two-space hard break
    expect(resolveSearch(state, 1, "b.c", "forward", 1)).toBeNull();
  });

  it("`^` anchors to line starts inside a code block (m flag)", () => {
    const state = makeState("```txt\none\ntwo\n```\n");
    const two = nthOccurrence(state, "two", 0);
    expect(resolveSearch(state, 1, "^two", "forward", 1)).toBe(two);
  });

  it("an invalid pattern is a silent miss, not a crash", () => {
    const state = makeState("plain text\n");
    expect(resolveSearch(state, 1, "([", "forward", 1)).toBeNull();
  });

  it("zero-length matches are ignored (no hang, no false hit)", () => {
    // The fixture must contain no `x` at all: `x*` then matches only empty
    // strings, which mean nothing to jump to and would loop exec() forever.
    const state = makeState("plain words\n");
    expect(resolveSearch(state, 1, "x*", "forward", 1)).toBeNull();
  });
});

describe("smartcase", () => {
  const md = "Alpha alpha ALPHA\n";

  it("an all-lowercase pattern matches any case", () => {
    const state = makeState(md);
    const first = nthOccurrence(state, "Alpha", 0);
    expect(resolveSearch(state, first, "alpha", "forward", 1)).toBe(
      nthOccurrence(state, "alpha", 0),
    );
  });

  it("an uppercase letter makes the pattern exact", () => {
    const state = makeState(md);
    // From the start: the only "Alpha" is at position 1 → wraps onto itself.
    const cap = nthOccurrence(state, "Alpha", 0);
    expect(resolveSearch(state, cap, "Alpha", "forward", 1)).toBe(cap);
  });
});

describe("no match", () => {
  it("returns null when the pattern is absent", () => {
    const state = makeState("plain text\n");
    expect(resolveSearch(state, 1, "absent", "forward", 1)).toBeNull();
  });
});

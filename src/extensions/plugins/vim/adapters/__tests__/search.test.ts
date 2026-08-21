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

describe("grapheme alignment (adversarial review)", () => {
  it("`.` never lands mid-surrogate — half an emoji is not a target", () => {
    const state = makeState("a😀b\n");
    // Cursor on the emoji start (pos 2). The next grapheme start is `b` at 4;
    // 3 (between the surrogate halves) must never be returned — an `x` there
    // deletes half the emoji.
    expect(resolveSearch(state, 2, ".", "forward", 1)).toBe(4);
  });

  it("a match inside a combining sequence snaps out of existence", () => {
    // "e\u0301" is one grapheme; a pattern hitting the combining mark alone
    // is not a real cursor target.
    const state = makeState("xe\u0301y\n");
    expect(resolveSearch(state, 1, "\u0301", "forward", 1)).toBeNull();
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

  it("escape opcodes are not uppercase intent (`\\Wfoo` matches ` FOO`)", () => {
    // vim's smartcase ignores capitals that are regex syntax — only literal
    // capitals (and explicit ranges) make the pattern exact (adversarial
    // review, reproduced: the raw scan forced sensitivity and missed FOO).
    const state = makeState("x FOO y\n");
    expect(resolveSearch(state, 1, "\\Wfoo", "forward", 1)).not.toBeNull();
  });

  it("an explicit `[A-Z]` range stays case-sensitive", () => {
    const state = makeState("abc Abc\n");
    const cap = nthOccurrence(state, "Abc", 0);
    expect(resolveSearch(state, 1, "[A-Z]bc", "forward", 1)).toBe(cap);
  });
});

describe("time budget (adversarial review — self-inflicted ReDoS)", () => {
  // A pathological pattern like `(a+)+$` backtracks exponentially. The
  // pattern only ever comes from the user's own keyboard — a shared document
  // cannot run a search — so this is a self-freeze, not an attack surface;
  // the budget bounds the damage to one line's exec and skips the rest.
  // Deterministic via an injected clock: wall-clock timing pins flake.
  it("stops scanning once the budget is spent (injected clock)", () => {
    const state = makeState("first line\n\nsecond bag line\n");
    let ticks = 0;
    const target = resolveSearch(state, 1, "bag", "forward", 1, {
      budgetMs: 50,
      now: () => (ticks += 100), // every check "costs" 100ms
    });
    // The match exists in the second block, but the clock burned the budget
    // before the scan reached it — a silent miss, same as any other.
    expect(target).toBeNull();
  });

  it("the default clock finds the same match (positive control)", () => {
    const state = makeState("first line\n\nsecond bag line\n");
    expect(resolveSearch(state, 1, "bag", "forward", 1)).toBe(
      nthOccurrence(state, "bag", 0),
    );
  });
});

describe("no match", () => {
  it("returns null when the pattern is absent", () => {
    const state = makeState("plain text\n");
    expect(resolveSearch(state, 1, "absent", "forward", 1)).toBeNull();
  });
});

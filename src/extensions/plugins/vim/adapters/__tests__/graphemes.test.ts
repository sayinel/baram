// §298 vim — cursor units: cluster correctness + the boundary index that
// keeps counted motions out of quadratic territory (security review).

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../../index";
import { lineUnitStarts, segmentSpanAt } from "../cursor-line-columns";
import {
  nextUnitBoundary,
  prevUnitBoundary,
  prevUnitBoundaryIndexed,
} from "../graphemes";

const editors: Editor[] = [];

function makeEditor(content: string): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

/** Walk `count` units from `pos`; returns the landing position. */
function walk(editor: Editor, pos: number, count: number, dir: -1 | 1): number {
  let at = pos;
  for (let i = 0; i < count; i++) {
    const next =
      dir < 0
        ? prevUnitBoundaryIndexed(editor.state, at)
        : nextUnitBoundary(editor.state, at);
    if (next === at) break;
    at = next;
  }
  return at;
}

describe("cursor units are grapheme clusters", () => {
  it("treats an NFD hangul syllable as ONE unit both ways", () => {
    const editor = makeEditor(`<p>a강b</p>`);
    const start = 1; // on "a"
    const afterA = nextUnitBoundary(editor.state, start);
    expect(afterA).toBe(2);
    const afterSyllable = nextUnitBoundary(editor.state, afterA);
    expect(afterSyllable).toBe(5); // 3 code units skipped as one cluster
    expect(prevUnitBoundary(editor.state, afterSyllable)).toBe(afterA);
  });

  it("treats a ZWJ emoji sequence as ONE unit both ways", () => {
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    const editor = makeEditor(`<p>x${family}y</p>`);
    const afterX = 2;
    const afterFamily = nextUnitBoundary(editor.state, afterX);
    expect(afterFamily).toBe(afterX + family.length);
    expect(prevUnitBoundary(editor.state, afterFamily)).toBe(afterX);
  });

  it("walks a long line symmetrically", () => {
    const editor = makeEditor(`<p>${"ab".repeat(500)}</p>`);
    const end = walk(editor, 1, 400, 1);
    expect(end).toBe(401);
    expect(walk(editor, end, 400, -1)).toBe(1);
  });
});

describe("the two cursor-unit definitions agree", () => {
  // forEachLineUnit (via lineUnitStarts) iterates a line's units; graphemes.ts
  // steps over them. Nothing else ties the two together. Fails if: either
  // drifts — e.g. forEachLineUnit iterating code points (the NFD syllable
  // splits into three) or skipping a non-text inline node (the mention).
  it("stepping right through a line visits exactly lineUnitStarts", () => {
    const editor = new Editor({ extensions: createBaramExtensions() });
    editors.push(editor);
    editor.commands.setContent({
      content: [
        {
          content: [
            { text: "a", type: "text" },
            {
              marks: [{ type: "bold" }],
              text: "b\u1100\u1161\u11a8",
              type: "text",
            },
            { text: "\u{1F468}\u200d\u{1F469} ", type: "text" },
            { attrs: { id: "s", label: "s" }, type: "mention" },
            { text: "x", type: "text" },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    });
    const span = segmentSpanAt(editor.state, 1);
    if (!span) throw new Error("no line");
    const stepped: number[] = [];
    for (let at = span.from; at < span.to;) {
      stepped.push(at);
      const next = nextUnitBoundary(editor.state, at);
      if (next === at) break;
      at = next;
    }
    expect(stepped).toHaveLength(7); // a · b · 각 · family · space · @s · x
    expect(
      lineUnitStarts(editor.state, { end: span.to, start: span.from }),
    ).toEqual(stepped);
  });
});

describe("a single rightward step stays lazy", () => {
  it("iterates ONE cluster, never the whole node (cursor decoration path)", () => {
    // nextUnitBoundary runs on every normal-mode cursor decoration, so a
    // long single-line document must not pay a full segmentation there
    // (measured: ~81ms and ~11MB retained for 1M characters).
    const editor = makeEditor(`<p>${"a".repeat(5000)}</p>`);
    const proto = Intl.Segmenter.prototype as unknown as {
      segment: (text: string) => Iterable<{ segment: string }>;
    };
    const original = proto.segment;
    let yields = 0;
    proto.segment = function (this: Intl.Segmenter, text: string) {
      const inner = original.call(this, text);
      return {
        [Symbol.iterator]() {
          const it = inner[Symbol.iterator]();
          return {
            [Symbol.iterator]() {
              return this;
            },
            next() {
              const r = it.next();
              if (!r.done) yields++;
              return r;
            },
          };
        },
      };
    };
    try {
      nextUnitBoundary(editor.state, 1);
    } finally {
      proto.segment = original;
    }
    expect(yields).toBe(1); // indexing the node would iterate 5000
  });
});

describe("counted motion segments each text node once", () => {
  it("a 500-step walk makes ONE segmentation pass, not one per step", () => {
    // Slicing and re-segmenting the prefix per step made counted motion
    // quadratic: a crafted long line froze the renderer for seconds
    // (security review — the defect measured 4.9s for 1500 steps on a 60k
    // line). Counting segmentation passes pins the fix deterministically,
    // with no timing to flake under parallel-suite load.
    const editor = makeEditor(`<p>${"a".repeat(2000)}</p>`);
    const proto = Intl.Segmenter.prototype as unknown as {
      segment: (text: string) => unknown;
    };
    const original = proto.segment;
    let calls = 0;
    proto.segment = function (this: Intl.Segmenter, text: string) {
      calls++;
      return original.call(this, text);
    };
    let landed: number;
    try {
      landed = walk(editor, 2001, 500, -1);
    } finally {
      proto.segment = original;
    }
    expect(landed).toBe(1501); // the walk itself still works
    expect(calls).toBeLessThanOrEqual(2); // the defect cost 500
  });
});

describe("one unit back without an index", () => {
  it("one unit back without the index agrees with the indexed walk at every position", () => {
    // Fails if: containing(inNode) replaces containing(inNode - 1): "abc" @2 returns 2, not 1.
    const corpus = [
      "abc",
      "한글 text",
      "한글",
      "a👨‍👩‍👧‍👦b",
      "🇰🇷🇯🇵x",
      "éé",
      "a\r\nb",
      "𝒳y",
    ];
    for (const text of corpus) {
      const editor = makeEditor("<p></p>");
      editor.commands.setContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      for (let pos = 1; pos <= 1 + text.length; pos++) {
        expect(
          prevUnitBoundary(editor.state, pos),
          `${JSON.stringify(text)} @${pos}`,
        ).toBe(prevUnitBoundaryIndexed(editor.state, pos));
      }
    }
  });
});

// §298 (PR 307 device finding) — a code block is ONE cursor line to PM vim.
//
// WHAT BROKE: `j` from the paragraph above a code block landed on a different
// code line depending on which column the cursor started from. Measured:
//
//   col=0  -> code line 1
//   col=6  -> code line 2
//   col=12 -> code line 3
//
// Because `codeBlock` declares `content: "text*"` it is a TEXTBLOCK, so
// collectLines treats it as a single segment and splitSegments only breaks on
// `hardBreak` nodes — a code block's newlines are literal characters inside
// one text node. The column-preserving walk then reuses the column as a raw
// offset into the block's source, which is why a caret further right dives
// further down.
//
// The contract (issue 472): entry is DIRECTIONAL for the normal-mode caller
// — `j` from above lands on the FIRST source line, `k` from below on the
// LAST — and never a line picked by accident of the previous paragraph's
// width. The directional landing is OPT-IN (`codeBlockEntry` option):
// visual-head and operator callers keep the first-line default, because a
// head parked mid-block breaks their column math and changes d/y ranges.
// The CodeMirror island owns movement inside the block from then on
// (Phase 0b).

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../../../../pipeline/md-to-pm";
import { createBaramExtensions } from "../../../../index";
import { insertEntryTarget } from "../code-block-landing";
import { resolveMotion } from "../motions";

const editors: Editor[] = [];

/** 1-based source line of `pos` inside the code block at `at`. */
function codeLineOf(pos: number, at: number, text: string): number {
  const offset = pos - (at + 1);
  return text.slice(0, Math.max(0, offset)).split("\n").length;
}

/** Top-level offset of the first node of a type, plus its text. */
function findNode(
  editor: Editor,
  typeName: string,
): { at: number; text: string } {
  let at = -1;
  let text = "";
  editor.state.doc.forEach((node, offset) => {
    if (at < 0 && node.type.name === typeName) {
      at = offset;
      text = node.textContent;
    }
  });
  expect(at).toBeGreaterThanOrEqual(0);
  return { at, text };
}

function makeEditor(md: string): Editor {
  const editor = new Editor({
    content: "<p></p>",
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
});

describe("j into a code block ignores the starting column", () => {
  const md = "abcdefghijklmnop\n\n```python\nx = 1\ny = 2\nz = 3\n```\n";

  it("lands on the FIRST code line from every column", () => {
    const editor = makeEditor(md);
    const code = findNode(editor, "codeBlock");
    let para = -1;
    editor.state.doc.forEach((node, offset) => {
      if (para < 0 && node.isTextblock && node.textContent.startsWith("abc")) {
        para = offset + 1;
      }
    });

    const landings = [0, 2, 6, 8, 12, 15].map((col) => {
      const target = resolveMotion(editor.state, para + col, "lineDown", 1);
      return codeLineOf(target, code.at, code.text);
    });

    expect(landings).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("default caller lands at the content start; directional preserves the column into the FIRST line", () => {
    const editor = makeEditor(md);
    const code = findNode(editor, "codeBlock");
    let para = -1;
    editor.state.doc.forEach((node, offset) => {
      if (para < 0 && node.isTextblock && node.textContent.startsWith("abc")) {
        para = offset + 1;
      }
    });
    const firstLen = code.text.indexOf("\n"); // "x = 1" = 5

    // From the far right of the paragraph — the worst case on device.
    // Default (visual/operator callers): content start, exactly as before.
    const target = resolveMotion(editor.state, para + 15, "lineDown", 1);
    expect(target).toBe(code.at + 1);

    // Directional (normal-mode caller): column preserved into the first
    // line, clamped to its last character — never a raw offset into the
    // whole source (the original device bug).
    const clamped = resolveMotion(editor.state, para + 15, "lineDown", 1, {
      codeBlockEntry: "directional",
    });
    expect(clamped).toBe(code.at + 1 + firstLen - 1);
    const col2 = resolveMotion(editor.state, para + 2, "lineDown", 1, {
      codeBlockEntry: "directional",
    });
    expect(col2).toBe(code.at + 1 + 2);
  });
});

describe("k INTO a code block lands on its LAST line (issue 472)", () => {
  // Stock-vim spatial continuity: `k` means "the line just above", and from
  // below a block the visually adjacent line is its LAST source line. The
  // always-first-line landing was a v1 simplification, not a UX decision.
  const md = "```python\nx = 1\ny = 2\nz = 3\n```\n\nbelowparagraph\n";

  function belowStart(editor: Editor): number {
    let below = -1;
    editor.state.doc.forEach((node, offset) => {
      if (
        below < 0 &&
        node.isTextblock &&
        node.textContent.startsWith("below")
      ) {
        below = offset + 1;
      }
    });
    expect(below).toBeGreaterThan(0);
    return below;
  }

  it("lands on the LAST code line from every column", () => {
    const editor = makeEditor(md);
    const code = findNode(editor, "codeBlock");
    const below = belowStart(editor);

    const landings = [0, 3, 7, 13].map((col) => {
      const target = resolveMotion(editor.state, below + col, "lineUp", 1, {
        codeBlockEntry: "directional",
      });
      return codeLineOf(target, code.at, code.text);
    });

    expect(landings).toEqual([3, 3, 3, 3]);
  });

  it("carried column lands WITHIN the last line, clamped to its end (curswant)", () => {
    const editor = makeEditor(md);
    const code = findNode(editor, "codeBlock");
    const below = belowStart(editor);
    const lastStart = code.at + 1 + code.text.lastIndexOf("\n") + 1;
    const lastLen = code.text.length - (code.text.lastIndexOf("\n") + 1); // "z = 3" = 5

    const fromCol0 = resolveMotion(editor.state, below, "lineUp", 1, {
      codeBlockEntry: "directional",
    });
    const fromCol2 = resolveMotion(editor.state, below + 2, "lineUp", 1, {
      codeBlockEntry: "directional",
    });
    const fromCol13 = resolveMotion(editor.state, below + 13, "lineUp", 1, {
      codeBlockEntry: "directional",
    });

    expect(fromCol0).toBe(lastStart); // column 0 preserved
    expect(fromCol2).toBe(lastStart + 2); // column preserved
    expect(fromCol13).toBe(lastStart + lastLen - 1); // clamped to `$`
  });

  it("directional is OPT-IN: the default caller still gets the first line", () => {
    // Visual-head and operator callers pass no option — a head parked
    // mid-block would break their column math and change d/y ranges.
    const editor = makeEditor(md);
    const code = findNode(editor, "codeBlock");
    const below = belowStart(editor);

    const target = resolveMotion(editor.state, below, "lineUp", 1);
    expect(target).toBe(code.at + 1);
  });

  it("journal-* blocks are NOT CodeMirror islands: k keeps the first line", () => {
    // journal-* languages render a widget NodeView with no CM caret to
    // receive a hidden-source offset (code-block.ts addNodeView).
    const editor = makeEditor(
      "```journal-list\nitem a\nitem b\n```\n\nbelowparagraph\n",
    );
    const code = findNode(editor, "codeBlock");
    expect(code.text.includes("\n")).toBe(true); // multi-line fixture guard
    const below = belowStart(editor);

    const target = resolveMotion(editor.state, below, "lineUp", 1, {
      codeBlockEntry: "directional",
    });
    expect(target).toBe(code.at + 1);
  });

  it("single-line block: k lands at the content start", () => {
    const editor = makeEditor("```py\nonly = 1\n```\n\nbelowparagraph\n");
    const code = findNode(editor, "codeBlock");
    const below = belowStart(editor);

    const target = resolveMotion(editor.state, below, "lineUp", 1, {
      codeBlockEntry: "directional",
    });
    expect(target).toBe(code.at + 1);
  });

  it("2k from below passes THROUGH the block to the paragraph above, column intact", () => {
    // The block stays ONE vim line: entering mid-count must not consume
    // extra steps, strand the walk inside the block, or poison the carried
    // column with a source offset.
    const editor = makeEditor(
      "above\n\n```py\na = 1\nb = 2\n```\n\nbelowparagraph\n",
    );
    const below = belowStart(editor);
    let above = -1;
    editor.state.doc.forEach((node, offset) => {
      if (above < 0 && node.isTextblock && node.textContent === "above") {
        above = offset + 1;
      }
    });
    expect(above).toBeGreaterThan(0);

    const target = resolveMotion(editor.state, below, "lineUp", 2, {
      codeBlockEntry: "directional",
    });
    expect(target).toBe(above); // column 0 carried exactly
  });

  it("content ending in a newline: k lands on the trailing empty line", () => {
    const editor = makeEditor("```py\na = 1\n\n```\n\nbelowparagraph\n");
    const code = findNode(editor, "codeBlock");
    // Fixture-shape guard: the pipeline must have kept the trailing newline
    // (an empty final source line). If this fails the fixture is wrong, not
    // the walk — adjust the fixture, don't weaken the pin.
    expect(code.text.endsWith("\n")).toBe(true);
    const below = belowStart(editor);

    const target = resolveMotion(editor.state, below, "lineUp", 1, {
      codeBlockEntry: "directional",
    });
    expect(target).toBe(code.at + 1 + code.text.length);
  });
});

describe("k out of a code block still leaves it", () => {
  it("from a code block, k reaches the paragraph above", () => {
    const editor = makeEditor("above\n\n```py\na = 1\nb = 2\n```\n");
    const code = findNode(editor, "codeBlock");

    const target = resolveMotion(editor.state, code.at + 1, "lineUp", 1);

    const $target = editor.state.doc.resolve(target);
    expect($target.parent.textContent).toBe("above");
  });
});

describe("frontmatter is NOT a CodeMirror island", () => {
  // `frontmatter` is also `code: true`, so a `spec.code` predicate caught it
  // too and `k` into it jumped to the first YAML character from any column.
  // It renders through NodeViewContent, meaning ProseMirror keeps managing the
  // caret inside it, so the column walk is correct there.
  it("k into frontmatter preserves the column", () => {
    const editor = makeEditor(
      "---\ntitle: hello world\n---\n\nbody paragraph here\n",
    );
    const frontmatter = findNode(editor, "frontmatter");
    let body = -1;
    editor.state.doc.forEach((node, offset) => {
      if (body < 0 && node.isTextblock && node.type.name === "paragraph") {
        body = offset + 1;
      }
    });
    expect(body).toBeGreaterThan(0);

    const fromStart = resolveMotion(editor.state, body, "lineUp", 1);
    const fromColumn4 = resolveMotion(editor.state, body + 4, "lineUp", 1);

    // Landing on the content start from column 0 is ordinary; landing there
    // from column 4 as well is the regression.
    expect(fromStart).toBe(frontmatter.at + 1);
    expect(fromColumn4).toBeGreaterThan(fromStart);
  });
});

describe("ordinary paragraphs keep their column (positive control)", () => {
  // A fix that clamped every vertical move to the line start would satisfy
  // the pins above while destroying normal j/k behaviour.
  it("j between paragraphs preserves the column", () => {
    const editor = makeEditor("abcdefghij\n\nklmnopqrst\n");
    let first = -1;
    let second = -1;
    editor.state.doc.forEach((node, offset) => {
      if (!node.isTextblock) return;
      if (first < 0) first = offset + 1;
      else if (second < 0) second = offset + 1;
    });

    const target = resolveMotion(editor.state, first + 4, "lineDown", 1);

    expect(target).toBe(second + 4);
  });
});

describe("insertEntryTarget (issue 477 — insert-mode arrow entry landing)", () => {
  // 캐럿 모델 차이가 계약이다: insert 캐럿은 문자 사이에 서므로 라인
  // END(length)까지 허용 — normal 워크는 length-1로 클램프한다.
  const md = "abcdefgh\n\n```ts\nconst x = 1;\nyz\n```\n\nafter\n";

  it("from above lands on the FIRST line, column preserved", () => {
    const editor = makeEditor(md);
    const block = findNode(editor, "codeBlock");
    const para = 0; // 첫 문단 "abcdefgh"
    const from = para + 1 + 3; // column 3
    const target = insertEntryTarget(editor.state, from, block.at + 1, "first");
    expect(target).toBe(block.at + 1 + 3);
  });

  it("from below lands on the LAST line, clamped to line END (not END-1)", () => {
    const editor = makeEditor(md);
    const block = findNode(editor, "codeBlock");
    // "after" 문단은 블록 뒤 — column 5 (라인 "yz"는 길이 2 → insert 클램프 = 2)
    let afterAt = -1;
    editor.state.doc.forEach((node, offset) => {
      if (offset > block.at && afterAt < 0 && node.type.name === "paragraph")
        afterAt = offset;
    });
    const from = afterAt + 1 + 5;
    const target = insertEntryTarget(editor.state, from, block.at + 1, "last");
    const lastLineStart = block.at + 1 + block.text.lastIndexOf("\n") + 1;
    expect(target).toBe(lastLineStart + 2); // "yz" END — normal이라면 1
  });

  it("CONTROL: the normal-mode walk still clamps the same line to END-1", () => {
    const editor = makeEditor(md);
    const block = findNode(editor, "codeBlock");
    let afterAt = -1;
    editor.state.doc.forEach((node, offset) => {
      if (offset > block.at && afterAt < 0 && node.type.name === "paragraph")
        afterAt = offset;
    });
    const from = afterAt + 1 + 5;
    const target = resolveMotion(editor.state, from, "lineUp", 1, {
      codeBlockEntry: "directional",
    });
    const lastLineStart = block.at + 1 + block.text.lastIndexOf("\n") + 1;
    expect(target).toBe(lastLineStart + 1); // "yz"의 마지막 문자 위
  });

  it("unicode target line: the column resolves through GRAPHEME starts", () => {
    // 캐리 column은 grapheme 인덱스다 — UTF-16 오프셋으로 더하면 서로게이트
    // 쌍 한가운데 착지한다 (adversarial review). 이모지(2 code units) 뒤
    // column 1은 start+2여야 한다.
    const editor = makeEditor("abc\n\n```ts\n\u{1F600}xy\n```\n\nafter\n");
    const block = findNode(editor, "codeBlock");
    const from = 0 + 1 + 1; // 첫 문단 column 1
    const target = insertEntryTarget(editor.state, from, block.at + 1, "first");
    expect(target).toBe(block.at + 1 + 2); // 이모지 grapheme 뒤
  });

  it("unicode target line: past the last grapheme clamps to line END", () => {
    const editor = makeEditor("abcdefgh\n\n```ts\n\u{1F600}x\n```\n\nafter\n");
    const block = findNode(editor, "codeBlock");
    const from = 0 + 1 + 7; // column 7 — 라인은 grapheme 2개(길이 3 units)
    const target = insertEntryTarget(editor.state, from, block.at + 1, "first");
    expect(target).toBe(block.at + 1 + 3); // 라인 END (units)
  });

  it("DIRECTIONAL walk: unicode landing resolves through grapheme starts too", () => {
    // insertEntryTarget만 고치고 normal 워크(624행 계열)를 빠뜨렸던 결함의
    // 핀: 이모지(2 code units) 선두 라인에 캐리 column 1로 j 진입하면
    // grapheme 시작(start+2)이어야지 서로게이트 한가운데(start+1)면 안 된다.
    const editor = makeEditor("abc\n\n```ts\n\u{1F600}xy\n```\n\nafter\n");
    const block = findNode(editor, "codeBlock");
    const from = 0 + 1 + 1; // 첫 문단 column 1
    const target = resolveMotion(editor.state, from, "lineDown", 1, {
      codeBlockEntry: "directional",
    });
    expect(target).toBe(block.at + 1 + 2); // 이모지 grapheme 뒤 == 'x'
    const cut = editor.state.doc.textBetween(block.at + 1, target);
    expect(cut).toBe("\u{1F600}"); // 온전한 grapheme 경계
  });

  it("DIRECTIONAL walk: unicode line clamps to the LAST grapheme start", () => {
    const editor = makeEditor(
      "abcdefgh\n\n```ts\nab\n\u{1F600}x\n```\n\nafter\n",
    );
    const block = findNode(editor, "codeBlock");
    let afterAt = -1;
    editor.state.doc.forEach((node, offset) => {
      if (offset > block.at && afterAt < 0 && node.type.name === "paragraph")
        afterAt = offset;
    });
    const from = afterAt + 1 + 5; // column 5("after" 끝) — 마지막 줄은 grapheme 2개
    const target = resolveMotion(editor.state, from, "lineUp", 1, {
      codeBlockEntry: "directional",
    });
    const lastLineStart = block.at + 1 + block.text.lastIndexOf("\n") + 1;
    expect(target).toBe(lastLineStart + 2); // 'x'의 시작 (마지막 unit start)
  });

  it("counted 2k passes THROUGH a short block with the column INTACT", () => {
    // 착지 분기는 캐리 칼럼을 갱신하지 않고 continue한다는 계약의 핀
    // (적대 리뷰: 기존 관통 핀은 column 0만 검사했다). column 6에서 2k로
    // 짧은 블록을 관통하면 위 문단의 column 6에 도착해야 한다 — 착지
    // 클램프(블록 줄은 2 grapheme)가 칼럼을 오염시키면 실패한다.
    const editor = makeEditor("abcdefgh\n\n```ts\nab\n```\n\nafter-line\n");
    const block = findNode(editor, "codeBlock");
    let afterAt = -1;
    editor.state.doc.forEach((node, offset) => {
      if (offset > block.at && afterAt < 0 && node.type.name === "paragraph")
        afterAt = offset;
    });
    const from = afterAt + 1 + 6; // "after-line" column 6
    const target = resolveMotion(editor.state, from, "lineUp", 2, {
      codeBlockEntry: "directional",
    });
    expect(target).toBe(0 + 1 + 6); // "abcdefgh" column 6 — 칼럼 생존
  });

  it("journal-* blocks have no CM caret: returns null", () => {
    const editor = makeEditor(
      "para\n\n```journal-recent\nquery\n```\n\nafter\n",
    );
    const block = findNode(editor, "codeBlock");
    expect(insertEntryTarget(editor.state, 1, block.at + 1, "first")).toBe(
      null,
    );
  });
});

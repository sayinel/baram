// §5.6 Find/Replace — 텍스트 추출이 예전과 같은 결과를 선형 비용으로 내는지 (#792)
import type { Node as PmNode } from "@tiptap/pm/model";

import { Schema } from "@tiptap/pm/model";
import { afterEach, describe, expect, test, vi } from "vitest";

import { extractTextWithPositions, findMatches } from "../plugins/find-replace";

// getAtomText 는 type.name 으로 가르므로 atom 이름을 앱과 똑같이 짓는다.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: { content: "inline*", group: "block" },
    codeBlock: { content: "text*", group: "block", code: true },
    blockquote: { content: "block+", group: "block" },
    bulletList: { content: "listItem+", group: "block" },
    listItem: { content: "block+" },
    text: { group: "inline" },
    wikiLink: {
      attrs: { href: {} },
      group: "inline",
      inline: true,
      atom: true,
    },
    tagNode: { attrs: { tag: {} }, group: "inline", inline: true, atom: true },
    mathInline: {
      attrs: { latex: {} },
      group: "inline",
      inline: true,
      atom: true,
    },
    // getAtomText 의 default — 글자를 더하지 않는 inline leaf
    hardBreak: { group: "inline", inline: true, atom: true },
  },
  marks: {},
});

// ── Oracle: 고치기 전 구현을 그대로 옮겼다 ───────────────────────────

function oldExtract(doc: PmNode): { posMap: number[]; text: string } {
  let text = "";
  const posMap: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        posMap.push(pos + i);
        text += node.text[i];
      }
    } else if (node.isInline && node.isLeaf && !node.isText) {
      const atomText = oldGetAtomText(node);
      for (let i = 0; i < atomText.length; i++) {
        posMap.push(pos);
        text += atomText[i];
      }
    } else if (
      node.isBlock &&
      text.length > 0 &&
      text[text.length - 1] !== "\n"
    ) {
      posMap.push(-1);
      text += "\n";
    }
    return true;
  });

  return { text, posMap };
}

function oldGetAtomText(node: PmNode): string {
  switch (node.type.name) {
    case "blockReference":
      return `![[${node.attrs.href}]]`;
    case "footnoteRef":
      return `[^${node.attrs.id}]`;
    case "mathInline":
      return `$${node.attrs.latex}$`;
    case "mention":
      return `@${node.attrs.id}`;
    case "tagNode":
      return `#${node.attrs.tag}`;
    case "wikiLink":
      return `[[${node.attrs.href}]]`;
    default:
      return "";
  }
}

// ── Corpus ───────────────────────────────────────────────────────────

const t = (s: string) => schema.text(s);
const p = (...c: PmNode[]) => schema.node("paragraph", null, c);
const code = (s: string) => schema.node("codeBlock", null, s ? [t(s)] : []);
const wiki = (href: string) => schema.node("wikiLink", { href });
const tag = (name: string) => schema.node("tagNode", { tag: name });
const math = (latex: string) => schema.node("mathInline", { latex });
const br = () => schema.node("hardBreak");
const quote = (...c: PmNode[]) => schema.node("blockquote", null, c);
const list = (...items: PmNode[][]) =>
  schema.node(
    "bulletList",
    null,
    items.map((c) => schema.node("listItem", null, c)),
  );
const doc = (...c: PmNode[]) => schema.node("doc", null, c);

const HAND_CORPUS: [string, PmNode][] = [
  ["starts with empty paragraphs", doc(p(), p(), p(t("Alpha")), p(), p())],
  ["code block whose text ends in a newline", doc(code("a\nb\n"), p(t("c")))],
  ["code block with only newlines", doc(code("\n\n"), code(""), p(t("x")))],
  [
    "nested lists and quotes",
    doc(
      quote(p(t("q1")), list([p(t("i1"))], [p(t("i2")), list([p(t("deep"))])])),
      p(t("after")),
    ),
  ],
  [
    "atoms, adjacent atoms and an empty atom",
    doc(
      p(wiki("Note A"), tag("todo"), math("x^2"), br(), t("tail")),
      p(br()),
      p(br(), br()),
      p(t("end"), wiki("n")),
    ),
  ],
  ["only an empty atom before a block", doc(p(br()), p(t("Alpha")))],
  ["surrogate pairs", doc(p(t("😀 smile 😀")), p(t("가나다 😀")))],
];

// 결정적 PRNG — 실패를 재현할 수 있게
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const WORDS = ["Alpha", "beta", "alpha-beta", "😀", "\n", "", "Ab", "aB", " "];

function randomBlock(r: () => number, depth: number): PmNode {
  const k = r();
  if (k < 0.5 || depth > 2) return p(...randomInline(r));
  if (k < 0.65) {
    const w = Array.from({ length: Math.floor(r() * 4) }, () =>
      r() < 0.4 ? "\n" : "alpha",
    ).join("");
    return code(w);
  }
  if (k < 0.8) return quote(randomBlock(r, depth + 1));
  return list([randomBlock(r, depth + 1)], [randomBlock(r, depth + 1)]);
}

function randomDoc(seed: number): PmNode {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 8);
  return doc(...Array.from({ length: n }, () => randomBlock(r, 0)));
}

function randomInline(r: () => number): PmNode[] {
  const out: PmNode[] = [];
  const n = Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const k = r();
    if (k < 0.55) {
      const w = WORDS[Math.floor(r() * WORDS.length)].replace("\n", "");
      if (w) out.push(t(w + (r() < 0.5 ? " " : "")));
    } else if (k < 0.7) out.push(wiki("alpha"));
    else if (k < 0.8) out.push(tag("beta"));
    else if (k < 0.9) out.push(math("a"));
    else out.push(br());
  }
  return out;
}

const RANDOM_CORPUS: [string, PmNode][] = Array.from(
  { length: 200 },
  (_, i) => [`random seed ${i}`, randomDoc(i + 1)],
);

const CORPUS = [...HAND_CORPUS, ...RANDOM_CORPUS];

// ── Equivalence ──────────────────────────────────────────────────────
// 이것을 실패시키는 것: 빈 atom 에서도 `lastChar` 를 바꾸게 하면(`atomText.length > 0` 관문
// 제거) 빈 atom 코퍼스 둘과 random 비교가, block 갈래에서 `lastChar !== "\n"` 을 빼면
// 빈 문단·code block 코퍼스와 random 비교가 깨진다.

describe("§5.6 extractTextWithPositions — same output as before (#792)", () => {
  test.each(HAND_CORPUS)("%s", (_name, d) => {
    expect(extractTextWithPositions(d)).toEqual(oldExtract(d));
  });

  test("200 random documents give the same text and posMap", () => {
    for (const [name, d] of RANDOM_CORPUS) {
      expect(extractTextWithPositions(d), name).toEqual(oldExtract(d));
    }
  });

  test("the hand corpus exercises the separator and empty-atom branches", () => {
    // 긍정 단정 — 위 비교가 공허하지 않도록 코퍼스가 갈래들을 실제로 지나는지 본다.
    const all = HAND_CORPUS.map(([, d]) => oldExtract(d));
    expect(all.some((r) => r.posMap.includes(-1))).toBe(true);
    expect(oldExtract(HAND_CORPUS[1][1]).text).toBe("a\nb\nc");
    expect(oldExtract(HAND_CORPUS[5][1]).text).toBe("Alpha");
  });

  // 검색 옵션 네 가지에서 match 개수와 위치가 같아야 한다. findMatches 는 새 추출을 쓰므로
  // 예전 추출로 같은 검색을 다시 돌린 결과와 비교한다.
  const OPTIONS: [string, string, boolean, boolean, boolean][] = [
    ["literal", "alpha", false, false, false],
    ["case-sensitive", "Alpha", true, false, false],
    ["regex", "a.p|\\[\\[|#beta|\\$a\\$", false, true, false],
    ["whole word", "alpha", false, false, true],
    ["emoji", "😀", false, false, false],
  ];

  test.each(OPTIONS)("findMatches (%s) matches the old extraction", (...o) => {
    const [, term, cs, re, ww] = o;
    let total = 0;
    for (const [name, d] of CORPUS) {
      const got = findMatches(d, term, cs, re, ww);
      const want = matchesFromExtraction(oldExtract(d), term, cs, re, ww);
      expect(got, name).toEqual(want);
      total += got.length;
    }
    expect(total).toBeGreaterThan(0);
  });
});

// findMatches 의 match 루프를 예전 추출 결과 위에서 다시 돈다.
function matchesFromExtraction(
  { posMap, text }: { posMap: number[]; text: string },
  term: string,
  caseSensitive: boolean,
  useRegex: boolean,
  wholeWord: boolean,
) {
  let pattern = useRegex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (wholeWord) pattern = `\\b${pattern}\\b`;
  const regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
  const out: { from: number; to: number }[] = [];
  let m: null | RegExpExecArray;
  while ((m = regex.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    let valid = true;
    for (let i = start; i < end; i++) {
      if (posMap[i] === -1) {
        valid = false;
        break;
      }
    }
    if (valid && start < posMap.length && end - 1 < posMap.length) {
      out.push({ from: posMap[start], to: posMap[end - 1] + 1 });
    }
    if (m[0].length === 0) regex.lastIndex++;
  }
  return out;
}

// ── Linearity ────────────────────────────────────────────────────────

describe("§5.6 extractTextWithPositions — linear in document size (#792)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function bigDoc(blocks: number): PmNode {
    return doc(
      ...Array.from({ length: blocks }, (_, i) =>
        i % 3 === 0
          ? p(t(`paragraph ${i} alpha `), tag("t"), t(" beta"))
          : p(t(`line ${i} with some text`)),
      ),
    );
  }

  // 펼쳐 만든 글자 수를 센다. 누적 문자열을 한 번만 펴면 그 수는 결과 글자 수와 같고,
  // 문서를 2배로 하면 2배다. 이것을 실패시키는 것: block 갈래에서 마지막 글자를
  // `parts.join("").at(-1)` 로 읽게 되돌리면 펼친 글자 수가 block 수에 비례해 늘어나
  // 첫 단정이 깨진다(실측 1,000 block: 25,225 대신 25,124,101). 끝의 `join` 을 `text +=`
  // 루프로 되돌려도 join 이 0회라 같은 단정이 깨진다.
  function materializedChars(d: PmNode): { chars: number; text: string } {
    let chars = 0;
    const join = Array.prototype.join;
    vi.spyOn(Array.prototype, "join").mockImplementation(function (
      this: unknown[],
      sep?: string,
    ) {
      const out = join.call(this, sep);
      chars += out.length;
      return out;
    });
    const { text } = extractTextWithPositions(d);
    vi.restoreAllMocks();
    return { chars, text };
  }

  test("materializes the text exactly once, so 2x the document is 2x the work", () => {
    const small = materializedChars(bigDoc(1_000));
    const large = materializedChars(bigDoc(2_000));

    expect(small.chars).toBe(small.text.length);
    expect(large.chars).toBe(large.text.length);
    // 긍정 단정 — 실제로 텍스트를 만들었고 크기가 2배 남짓으로 자랐다.
    expect(small.text.length).toBeGreaterThan(20_000);
    expect(large.chars / small.chars).toBeLessThan(2.2);
  });
});

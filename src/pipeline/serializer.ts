// serializer.ts — §3.3 mdast → Markdown string serialization
//
// Extracted from pm-to-md.ts to allow transformers to serialize sub-trees
// without circular dependency (pm-to-md → transformers → pm-to-md).
//
// §7.1 Serialization Rules:
// - Bold: ** (never __), Italic: * (never _)
// - List marker: - (never * or +)
// - Horizontal rule: ---
// - Code block: fenced (```)
// - 1 blank line between block elements
// - Single newline at file end

import type { Parents, Root, Text } from "mdast";
import type { ConstructName, Info, State } from "mdast-util-to-markdown";

import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

/** §28 Remark plugin: serialize wikiLink + §30b blockReference + custom inline marks */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function remarkWikiLink(this: any) {
  const data = this.data();
  const key = "toMarkdownExtensions";
  const list: unknown[] = data[key] || (data[key] = []);

  // All custom inline nodes return their pre-serialized value verbatim

  const verbatimHandler = (
    node: { value: string },
    _parent: Parents | undefined,
    state: State,
    info: Info,
  ) => state.createTracker(info).move(node.value);

  const verbatimTypes = [
    "blockReference",
    "highlight",
    "mention",
    "subscript",
    "superscript",
    "tagNode",
    "taskCheckbox",
    "wikiLink",
  ] as const;

  list.push({
    handlers: {
      ...Object.fromEntries(
        verbatimTypes.map((name) => [name, verbatimHandler]),
      ),
      text,
    },
  });
}

/**
 * §7.1 Body text — remark's own escaping, except for the `[` and `!` that
 * {@link rawPositions} shows start nothing; those are written as typed.
 *
 * remark escapes every `[` in phrasing (`unsafe.js` in mdast-util-to-markdown,
 * and once more in mdast-util-gfm-footnote) because `[x]` would be a shortcut
 * reference if `[x]: url` were defined anywhere in the document, which a
 * serializer cannot know. Baram's output can: the schema has no node for a
 * definition (the loader turns references into inline links and drops the
 * definitions, `reference-links.ts`), so a definition exists only if text spells
 * one — and {@link rawPositions} keeps that `[` escaped. remark separately
 * escapes a `(` right after `]` in text, which keeps an inline link from forming.
 *
 * The text is cut at each raw character and every piece goes through `safe` with
 * the raw character as its neighbour, so every other escape is decided exactly as
 * remark would decide it for the whole string.
 */
function text(
  node: Text,
  _parent: Parents | undefined,
  state: State,
  info: Info,
): string {
  const value = node.value;
  const raw = rawPositions(value, state, info);
  if (raw.length === 0) return state.safe(value, info);

  const pieces: string[] = [];
  let start = 0;
  let before = info.before;
  for (const index of raw) {
    if (index > start) {
      pieces.push(
        state.safe(value.slice(start, index), {
          ...info,
          after: value[index],
          before,
        }),
      );
    }
    pieces.push(value[index]);
    before = value[index];
    start = index + 1;
  }
  if (start < value.length) {
    pieces.push(state.safe(value.slice(start), { ...info, before }));
  }
  return pieces.join("");
}

/** remark constructs inside which every `[` stays escaped, as remark escapes it:
 *  link text (`label`), a reference, and the spots inside an autolink or a
 *  link's destination or title. */
const LITERAL_CONSTRUCTS: ReadonlySet<ConstructName> = new Set([
  "autolink",
  "destinationLiteral",
  "destinationRaw",
  "label",
  "reference",
  "titleApostrophe",
  "titleQuote",
]);

/** A GFM autolink literal can take a `]` into its URL (`trail` in
 *  micromark-extension-gfm-autolink-literal): one followed by anything but
 *  whitespace, `(` or `[`. Then the `]` this handler paired a `[` with is not the
 *  one the parser closes it with, so a text that can hold such a URL keeps every
 *  `[` escaped. The literal starts with a protocol or `www.`; an e-mail literal
 *  cannot hold a `]`. */
const AUTOLINK_LITERAL_START = /https?:\/\/|www\./i;

/** The characters a GFM task list check can hold between its brackets. */
const TASK_CHECK = new Set(["\t", "\n", "\r", " ", "X", "x"]);

/** After `]`: an inline link `(`, a full or collapsed reference `[`, a
 *  definition `:`, and Pandoc's bracketed span `{` (the Pandoc export keeps that
 *  extension on for underline, `convertUnderlineForPandoc`). Only `:` could
 *  change what Baram reads — the rest keep files saved before byte-identical. */
const LABEL_FOLLOWERS = new Set(["(", ":", "[", "{"]);

/**
 * Indices of the characters in `value` to write raw, ascending.
 *
 * Where a `[` stops being literal: the parser stack is `markdown-parser.ts`, and
 * the micromark constructs it triggers on `[` or `]` (the code-91/93 entries of
 * micromark's `constructs.js` and of the GFM extensions) are a link or image
 * label and its end, a link reference definition, a GFM footnote call and
 * definition, and a GFM task list check. Of the constructs that could swallow a
 * `]` before it closes anything, code, math, HTML and `<…>` autolinks start with
 * a character remark escapes in text (every backtick and `$`, a `<` before a
 * letter, `!`, `/` or `?`); the GFM autolink literal is the exception
 * ({@link AUTOLINK_LITERAL_START}). Wikilinks,
 * mentions, callouts, `[TOC]` and the `[/]` · `[-]` task states are read from
 * the text AFTER the parser has removed escapes, so a backslash never kept any
 * of them literal.
 *
 * A `[` is raw unless one of these holds — then remark escapes it as it always
 * did:
 * - it sits inside one of {@link LITERAL_CONSTRUCTS}, or the text could hold an
 *   autolink literal ({@link AUTOLINK_LITERAL_START});
 * - `^` follows it — a footnote call, or a definition at a line start;
 * - `]` comes right before it — the second label of a reference shape;
 * - at a line start, it is a task check: `[`, one of {@link TASK_CHECK}, `]`;
 * - the `]` it pairs with inside this text is followed by one of
 *   {@link LABEL_FOLLOWERS}, or it pairs with none. A `]` outside this text could
 *   close it on anything, so only a pair closed here is known. Escaping one `[`
 *   lets that same `]` reach the next one down, which meets the same follower —
 *   so every `[` still waiting goes with it;
 * - the text ends in `]` and a `(` follows: that is a block reference, written
 *   verbatim, so remark's `(` escape does not reach it, and a `[` left open by
 *   another verbatim node (the highlight shorthand writes its text unescaped)
 *   would close there into a link. The whole text keeps its escapes.
 *
 * A `!` right before a raw `[` is raw too: the image it would start has the same
 * label.
 */
function rawPositions(value: string, state: State, info: Info): number[] {
  // `info.after` can be longer than one character; the next one is its first.
  const following = (index: number): string =>
    index + 1 < value.length ? value[index + 1] : info.after.charAt(0);
  const raw: number[] = [];

  const bracketsMayBeRaw =
    !state.stack.some((name) => LITERAL_CONSTRUCTS.has(name)) &&
    !AUTOLINK_LITERAL_START.test(value) &&
    !(value.endsWith("]") && following(value.length - 1) === "(");

  const waiting: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "[" && bracketsMayBeRaw) {
      if (following(index) === "^") continue;
      // The second label of `[a][b]` — the first one stays escaped (`[` follows
      // its `]`), and so did this one before.
      if ((index > 0 ? value[index - 1] : info.before.slice(-1)) === "]") {
        continue;
      }
      if (
        atLineStart(value, index, info.before) &&
        TASK_CHECK.has(value[index + 1]) &&
        value[index + 2] === "]"
      ) {
        continue;
      }
      waiting.push(index);
    } else if (character === "]" && waiting.length > 0) {
      if (LABEL_FOLLOWERS.has(following(index))) {
        waiting.length = 0;
      } else {
        const opener = waiting.pop() as number;
        if (opener > 0 && value[opener - 1] === "!") raw.push(opener - 1);
        raw.push(opener);
      }
    }
  }
  return raw.sort((a, b) => a - b);
}

/** remark's `atBreak`: only spaces or tabs between `index` and a line ending,
 *  looking back through `before` (the text written just ahead of `value`). An
 *  empty `before` counts as a line start, the cautious reading for a `[`. */
function atLineStart(value: string, index: number, before: string): boolean {
  for (const [text, end] of [
    [value, index],
    [before, before.length],
  ] as const) {
    for (let at = end - 1; at >= 0; at--) {
      const character = text[at];
      if (character === "\n" || character === "\r") return true;
      if (character !== " " && character !== "\t") return false;
    }
  }
  return true;
}

/** remark serializer — mdast → markdown string */
const serializer = unified()
  .use(remarkStringify, {
    bullet: "-", // §7.1: 항상 -
    strong: "*", // §7.1: 항상 ** (remark uses strong char doubled)
    emphasis: "*", // §7.1: 항상 *
    rule: "-", // §7.1: 항상 ---
    fences: true, // §7.1: fenced code block
    listItemIndent: "one", // compact indent
    tightDefinitions: true,
  } as Parameters<typeof remarkStringify>[0])
  // tablePipeAlign:false — do NOT pad table cells out to the column width.
  // Padding rewrote every row of every table on save: a 25,095-byte file with
  // four tables came back 43,158 bytes, so one edit anywhere in the document
  // produced a diff touching every table line. Unpadded output leaves the cells
  // byte-identical to what the user wrote; the only remaining difference is the
  // delimiter row (`| --- |` → `| - |`), which mdast cannot preserve because it
  // does not record the original dash count.
  .use(remarkGfm, { singleTilde: false, tablePipeAlign: false })
  .use(remarkMath)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkWikiLink);

/** Serialize mdast tree to markdown string */
export function mdastToMarkdown(root: Root): string {
  let result = serializer.stringify(root);
  // §56l: remark-stringify escapes # at line start (atBreak), but #tag (no space)
  // is never heading syntax — unescape when followed by word characters.
  result = result.replace(/\\#(?=[\w가-힣])/g, "#");
  // §56m: remark-stringify encodes trailing spaces as &#x20; when the last inline
  // node is a tagNode followed by a whitespace-only text node.  Strip at end of lines.
  result = result.replace(/&#x20;(?=\n|$)/g, "");
  return result;
}

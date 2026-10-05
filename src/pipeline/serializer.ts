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
 * §7.1 Body text — remark's own escaping, except for the characters
 * {@link writtenPositions} decides itself — the `[`, `!` and `#` that start
 * nothing are written as typed, and every `$` is written `\$` — and a space
 * remark encoded before a line ending is dropped ({@link dropLineEndSpaces}).
 *
 * remark escapes every `[` in phrasing (`unsafe.js` in mdast-util-to-markdown,
 * and once more in mdast-util-gfm-footnote) because `[x]` would be a shortcut
 * reference if `[x]: url` were defined anywhere in the document, which a
 * serializer cannot know. Baram's mostly can: the schema has no node for a
 * definition (the loader turns references into inline links and drops the
 * definitions, `reference-links.ts`), and text that spells one keeps its `[`
 * escaped ({@link writtenPositions}). What it cannot see is content written
 * verbatim — an HTML block, front matter. A definition line there loads as a
 * definition, and a raw `[x]` in text then reads as its reference; such a block
 * already does not survive the reload whole. remark separately escapes a `(`
 * right after `]` in text, which keeps an inline link from forming.
 *
 * The text is cut at each of those characters and every piece goes through
 * `safe` with that character as its neighbour, so remark decides every other
 * escape with the same neighbours it would see in the whole string.
 */
function text(
  node: Text,
  _parent: Parents | undefined,
  state: State,
  info: Info,
): string {
  const value = node.value;
  const written = writtenPositions(value, state, info);
  if (written.length === 0) {
    return dropLineEndSpaces(state.safe(value, info), info);
  }

  const pieces: string[] = [];
  let start = 0;
  let before = info.before;
  for (const [index, output] of written) {
    if (index > start) {
      pieces.push(
        state.safe(value.slice(start, index), {
          ...info,
          after: value[index],
          before,
        }),
      );
    }
    pieces.push(output);
    before = value[index];
    start = index + 1;
  }
  if (start < value.length) {
    pieces.push(state.safe(value.slice(start), { ...info, before }));
  }
  return dropLineEndSpaces(pieces.join(""), info);
}

const ENCODED_SPACE = "&#x20;";

/**
 * §56m — a space remark encoded as `&#x20;` right before a line ending, dropped
 * from this text's own output. remark encodes a space next to a line ending so
 * the line keeps it; a tag followed by a space was saved as `#tag&#x20;`. A pass
 * over the whole saved string used to take out every `&#x20;` before a line
 * ending — in code, math and HTML blocks too, and the `&#x20;` of an escaped
 * `\&#x20;`. This keeps that pass to what the text wrote:
 * - a literal `&#x20;` comes out of `safe` with its `&` escaped, behind an odd
 *   run of backslashes, and stays;
 * - the line ending has to be one the saved string keeps: inside this output
 *   but not its last character — a container can still rewrite that one (an
 *   emphasis writes a line ending at its edge as `&#xA;`) — or, at the end of
 *   the output, the first character of `after`. Where remark writes the line
 *   ending itself as `&#xA;` (a table cell, an ATX heading) it writes the space
 *   before it raw, and there is nothing to drop;
 * - a space alone on its line stays. Dropping it here would empty the line
 *   before its container writes it, and an empty first line changes what a
 *   list item writes (`-` on a line of its own, the task check after it).
 */
function dropLineEndSpaces(output: string, { after, before }: Info): string {
  if (!output.includes(ENCODED_SPACE)) return output;
  let result = "";
  let start = 0;
  for (
    let at = output.indexOf(ENCODED_SPACE);
    at !== -1;
    at = output.indexOf(ENCODED_SPACE, at + ENCODED_SPACE.length)
  ) {
    let backslashes = 0;
    while (output[at - 1 - backslashes] === "\\") backslashes++;
    const end = at + ENCODED_SPACE.length;
    const lineEnding =
      end === output.length
        ? after.charAt(0) === "\n"
        : output[end] === "\n" && end < output.length - 1;
    const aloneOnLine =
      (at === 0 ? before.slice(-1) : output[at - 1]) === "\n" ||
      (at === 0 && before === "");
    if (backslashes % 2 === 0 && lineEnding && !aloneOnLine) {
      result += output.slice(start, at);
      start = end;
    }
  }
  return result + output.slice(start);
}

/** remark's `fullPhrasingSpans` (`unsafe.js`): an autolink, a reference, and
 *  the spots inside a link's destination or title. remark keeps its own escapes
 *  there, and so does this handler. */
const FULL_PHRASING_SPANS: ReadonlySet<ConstructName> = new Set([
  "autolink",
  "destinationLiteral",
  "destinationRaw",
  "reference",
  "titleApostrophe",
  "titleQuote",
]);

/** Inside these every `[` stays escaped, as remark escapes it — the spans
 *  above and link text (`label`). */
const LITERAL_CONSTRUCTS: ReadonlySet<ConstructName> = new Set([
  ...FULL_PHRASING_SPANS,
  "label",
]);

/** The characters a GFM task list check can hold between its brackets. */
const TASK_CHECK = new Set(["\t", "\n", "\r", " ", "X", "x"]);

/** After `]`: an inline link `(`, a full or collapsed reference `[`, a
 *  definition `:`, Pandoc's bracketed span `{` (the Pandoc export keeps that
 *  extension on for underline), and `<` — the Pandoc export turns an underline
 *  tag there into a span's `[` (`convertUnderlineForPandoc`), which would make
 *  the reference shape `][`. Only `:` could change what Baram reads; the rest
 *  keep such text in the bytes it was saved with and the meaning the export
 *  gave it. */
const LABEL_FOLLOWERS = new Set(["(", ":", "<", "[", "{"]);

/** §56l — a `#` before one of these neither opens an ATX heading (its `#`s are
 *  followed by a space, a tab or the line end) nor closes one (the closing `#`s
 *  end the line), the two spots remark escapes a `#` for. */
const TAG_CHARACTER = /[\w가-힣]/;

/**
 * The characters of `value` this handler writes itself, as `[index, output]`
 * in ascending index order.
 *
 * Every `$` outside {@link FULL_PHRASING_SPANS} is written `\$`. remark means
 * to escape every `$` in text (mdast-util-math's pattern for single-dollar
 * math), but its `safe` skips the escape on a character whose pattern has an
 * `after` key when the next character is escaped anyway — and that pattern has
 * the key even when its value is undefined. So `$_GET … $_POST` was written
 * `$\_GET … $\_POST` and read back as inline math, and math opened that way
 * could hide the `]` a raw `[` was paired with below.
 *
 * Where a `[` stops being literal: the parser stack is `markdown-parser.ts`. The
 * micromark constructs it starts on `[` (code 91 in micromark's `constructs.js`
 * and in the GFM extensions) are a link label, a link reference definition, a
 * GFM footnote call and definition, and a GFM task list check; an image label
 * starts on `!` (code 33) and goes on with the same `[`; a label ends on `]`
 * (code 93). The constructs that could swallow a `]` before it closes anything —
 * code, math, HTML and `<…>` autolinks — start with a character escaped in text:
 * every backtick (remark), every `$` (above), a `<` before a letter, `!`, `/` or
 * `?` (remark). A GFM autolink literal does not start while a `[` is open
 * (`previousUnbalanced` in micromark-extension-gfm-autolink-literal), so it
 * cannot take the `]` either. Wikilinks, mentions, callouts, `[TOC]` and the
 * `[/]` · `[-]` task states are read from the text AFTER the parser has removed
 * escapes, so in the editor a backslash never kept any of them literal.
 *
 * A `[` is raw unless one of these holds — then remark escapes it as it always
 * did:
 * - it sits inside one of {@link LITERAL_CONSTRUCTS};
 * - `^` follows it — a footnote call, or a definition at a line start;
 * - `]` comes right before it — the second label of a reference shape;
 * - at a line start, it is a task check (`[`, one of {@link TASK_CHECK}, `]`),
 *   or it starts `[!` or `[toc]` in any case — the Pandoc and Notion exports'
 *   callout and table-of-contents regexes (`convertCalloutsForPandoc`,
 *   `stripTocForPandoc` and their Notion twins) read such a line from the saved
 *   string;
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
 * label. A `#` before a {@link TAG_CHARACTER} is raw (§56l).
 */
function writtenPositions(
  value: string,
  state: State,
  info: Info,
): [number, string][] {
  // `info.after` can be longer than one character; the next one is its first.
  const following = (index: number): string =>
    index + 1 < value.length ? value[index + 1] : info.after.charAt(0);
  const written: [number, string][] = [];
  const inSpan = state.stack.some((name) => FULL_PHRASING_SPANS.has(name));

  const bracketsMayBeRaw =
    !state.stack.some((name) => LITERAL_CONSTRUCTS.has(name)) &&
    !(value.endsWith("]") && following(value.length - 1) === "(");

  const waiting: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "$") {
      if (!inSpan) written.push([index, "\\$"]);
    } else if (character === "#") {
      if (TAG_CHARACTER.test(following(index))) written.push([index, "#"]);
    } else if (character === "[" && bracketsMayBeRaw) {
      if (following(index) === "^") continue;
      // The second label of `[a][b]` — the first one stays escaped (`[` follows
      // its `]`), and so did this one before.
      if ((index > 0 ? value[index - 1] : info.before.slice(-1)) === "]") {
        continue;
      }
      if (
        atLineStart(value, index, info.before) &&
        ((TASK_CHECK.has(value[index + 1]) && value[index + 2] === "]") ||
          value[index + 1] === "!" ||
          value.slice(index, index + 5).toLowerCase() === "[toc]")
      ) {
        continue;
      }
      waiting.push(index);
    } else if (character === "]" && waiting.length > 0) {
      if (LABEL_FOLLOWERS.has(following(index))) {
        waiting.length = 0;
      } else {
        const opener = waiting.pop() as number;
        if (opener > 0 && value[opener - 1] === "!") {
          written.push([opener - 1, "!"]);
        }
        written.push([opener, "["]);
      }
    }
  }
  return written.sort((a, b) => a[0] - b[0]);
}

/** remark's `atBreak`: only spaces or tabs between `index` and a line ending,
 *  looking back through `before` (the text written just ahead of `value`). With
 *  no line ending in sight it is not a line start — the reading remark's own
 *  `atBreak` patterns make. A block's first text sees one: `containerFlow` hands
 *  every flow child `before: "\n"`. */
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
  return false;
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
  return serializer.stringify(root);
}

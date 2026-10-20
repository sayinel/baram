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

import type { HighlightNode, SubscriptNode, SuperscriptNode } from "./types";
import type { Delete, Parents, Root, Text } from "mdast";
import type {
  Attention,
  ConstructName,
  Info,
  State,
} from "mdast-util-to-markdown";

import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

import { markdownParser } from "./markdown-parser";

/** §28 Remark plugin: serialize wikiLink + §30b blockReference + custom inline marks */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function remarkWikiLink(this: any) {
  const data = this.data();
  const key = "toMarkdownExtensions";
  const list: unknown[] = data[key] || (data[key] = []);

  // These custom inline nodes return their pre-serialized value verbatim

  const verbatimHandler = (
    node: { value: string },
    _parent: Parents | undefined,
    state: State,
    info: Info,
  ) => state.createTracker(info).move(node.value);

  const verbatimTypes = [
    "blockReference",
    "mention",
    "tagNode",
    "taskCheckbox",
    "wikiLink",
  ] as const;

  list.push({
    handlers: {
      ...Object.fromEntries(
        verbatimTypes.map((name) => [name, verbatimHandler]),
      ),
      delete: strikethrough,
      highlight: customMark,
      subscript: customMark,
      superscript: customMark,
      text,
    },
  });
}

/**
 * §5.1 Each custom inline mark's shorthand delimiter and tag, and the sides on
 * which the delimiter's own character written next to the shorthand changes
 * how the loader reads it (`CUSTOM_MARK_PATTERNS` in
 * `convert-inline-custom-marks.ts`):
 * - `==` before only — its text may start with one `=` (`=[^=]`), so `a=`
 *   then `==b==` (`a===b==`) opens a character early; after it, `==b===`
 *   still reads `==b==` first.
 * - `~` on both sides — the pattern refuses a `~` on either side, and
 *   `~~a~~` then `~b~` puts three tildes in one run, which closes no
 *   strikethrough.
 * - `^` on neither — its text can neither start nor end with `^`, so `a^^b^`
 *   and `^b^^` both read `^b^`.
 */
const CUSTOM_MARKS = {
  highlight: { after: false, before: true, delimiter: "==", tag: "mark" },
  subscript: { after: true, before: true, delimiter: "~", tag: "sub" },
  superscript: { after: false, before: false, delimiter: "^", tag: "sup" },
} as const;

/**
 * §7.1 A highlight, subscript or superscript over plain text — `pm-to-md.ts`
 * makes these nodes only where the text itself allows the shorthand.
 *
 * The text goes through {@link text} like any other, so it is escaped as body
 * text is. The shorthand is written unless the character written just outside
 * it is the delimiter's own on a side {@link CUSTOM_MARKS} names, or it would
 * not read back as its text ({@link readsBackAsText}) — then the tags are
 * written, which is what `pm-to-md.ts` writes for the runs it does not
 * collapse. A following text that starts with `~` is written `\~` and shows
 * only its backslash here; `pm-to-md.ts` judges that one before the text is
 * escaped.
 *
 * Tags are not a neutral fallback: the text after `<mark>` is read as
 * markdown again, so one that starts with a tag's spelling (`#todo`) reads
 * back as a tag. They are written only where the shorthand would not read
 * back either: beside a neighbour {@link CUSTOM_MARKS} names, or where it
 * fails judged on its own between two letters.
 */
function customMark(
  node: HighlightNode | SubscriptNode | SuperscriptNode,
  _parent: Parents | undefined,
  state: State,
  info: Info,
): string {
  const { after, before, delimiter, tag } = CUSTOM_MARKS[node.type];
  const write = (open: string, close: string): string => {
    const tracker = state.createTracker(info);
    let value = tracker.move(open);
    value += tracker.move(
      state.containerPhrasing(node, {
        ...tracker.current(),
        after: close,
        before: open,
      }),
    );
    return value + tracker.move(close);
  };
  if (
    !(before && info.before.slice(-1) === delimiter[0]) &&
    !(after && info.after.charAt(0) === delimiter[0])
  ) {
    const shorthand = write(delimiter, delimiter);
    const text = node.children.map((child) => (child as Text).value).join("");
    if (readsBackAsText(shorthand, `${delimiter}${text}${delimiter}`)) {
      return shorthand;
    }
  }
  return write(`<${tag}>`, `</${tag}>`);
}
// `containerPhrasing` asks the next sibling's handler for its first character;
// without a peek it ran this whole handler a second time. The shorthand starts
// with its delimiter's character; where the tags are written instead, the
// text before is told that character rather than `<`, which differs in two
// places, each reading back the same: the backslash `keepBackslashBeforeRun`
// adds before a subscript's `~`, and a `[` left raw because the `]` that
// closes it at the end of the text is followed by the delimiter rather than
// `<`, a label follower (`see [x]<mark>…`). Only time is at stake (the parse
// is remembered either way), so no test counts it.
customMark.peek = (
  node: HighlightNode | SubscriptNode | SuperscriptNode,
): string => CUSTOM_MARKS[node.type].delimiter[0];
/** {@link readsBackAsText} answers, by the string parsed. A file holds the
 *  same shorthands save after save, and each parse costs tens of
 *  microseconds. The map is emptied when it reaches this many entries. */
const READ_BACK_LIMIT = 4096;
const readBackAnswers = new Map<string, boolean>();

/**
 * §7.1 Whether `written` reads back as the plain `text` and nothing else,
 * parsed by the stack the app reads files with (`markdown-parser.ts`) between
 * two letters, so its first line starts no block (later lines keep the
 * line-start escapes remark wrote).
 *
 * What this is for is a web address at the end of the text. A GFM autolink
 * takes the closing delimiter into the link: `==https://example.com==` read
 * back as a link to `https://example.com==` and lost the highlight. micromark
 * starts no link in the shorthand's text — the `.` of `www.` and the `:` of
 * `http(s)://` are written escaped ({@link startsWebAddress}) — but
 * mdast-util-gfm-autolink-literal's text transform, which reads the text after
 * escapes are taken out, still does, by its own rules (the character before
 * the address, `isCorrectDomain`, trailing punctuation). Asking the parser
 * follows them without copying them. The check also turns down a text in
 * which a link forms elsewhere (`see https://example.com now`), though that
 * shorthand reads back with its mark; the tags it is written as reload the
 * same. The transform starts a web link only at `http://`, `https://` or
 * `www.` (any case), so a text spelling none of them is not parsed.
 */
function readsBackAsText(written: string, text: string): boolean {
  if (!/https?:\/\/|www\./i.test(text)) return true;
  const key = `${written}\u0000${text}`;
  const known = readBackAnswers.get(key);
  if (known !== undefined) return known;
  const [paragraph, ...others] = markdownParser.parse(`x${written}x`).children;
  const [only, ...rest] =
    others.length === 0 && paragraph?.type === "paragraph"
      ? paragraph.children
      : [];
  const answer =
    only !== undefined &&
    rest.length === 0 &&
    only.type === "text" &&
    only.value === `x${text}x`;
  if (readBackAnswers.size >= READ_BACK_LIMIT) readBackAnswers.clear();
  readBackAnswers.set(key, answer);
  return answer;
}

/**
 * §7.1 Strikethrough, written the way mdast-util-to-markdown writes emphasis
 * and strong: as attention, which `containerPhrasing` checks the way micromark
 * reads it, encoding a character beside the run where the run would not open
 * or close otherwise.
 *
 * remark-gfm's own handler (mdast-util-gfm-strikethrough 2.0.0) writes `~~`
 * around the text without looking at its neighbours, so a strikethrough whose
 * text starts or ends with a space (`a ~~e ~~f`) did not close and was lost on
 * reload. Only `~~`: Baram reads a single `~` as subscript
 * (`singleTilde: false`).
 */
function strikethrough(
  node: Delete,
  _parent: Parents | undefined,
  state: State,
  info: Info,
): string {
  const exit = state.enter("phrasing");
  const value = state.containerPhrasing(
    { children: [node], type: "paragraph" },
    info,
  );
  exit();
  return value;
}
strikethrough.attention = (() => ({
  construct: "strikethrough",
  markers: ["~"],
  sizes: [2],
})) satisfies Attention;
strikethrough.peek = (): string => "~";

/**
 * §7.1 Body text — remark's own escaping, except for the characters
 * {@link writtenPositions} decides itself — the `[`, `!` and `#` that start
 * nothing are written as typed, and every `$` and the characters where a web
 * address starts are written escaped — and a space remark encoded before a
 * line ending is dropped ({@link dropLineEndSpaces}).
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
    return keepBackslashBeforeRun(
      dropLineEndSpaces(state.safe(value, info), info),
      info,
    );
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
  return keepBackslashBeforeRun(dropLineEndSpaces(pieces.join(""), info), info);
}

/**
 * §7.1 A text that `*`, `_` or `~` follows: when its last character comes
 * right after a backslash that escapes nothing, that backslash is written
 * `\\`.
 *
 * Beside a bold, italic or strikethrough run — after the text, or closing a
 * run the text ends — remark may write that last character as a character
 * reference so the run opens or closes (`encodeInfo` in
 * mdast-util-to-markdown), and it does not look at what comes before the
 * character: `use \n` before `**(old)**` was written `use \&#x6E;**(old)**`,
 * the backslash now escaping the reference's `&`, and read back as the text
 * `use &#x6E;` — which the next save kept. `\\` reads back as one backslash
 * whether the character after it is encoded or not. ASCII punctuation is
 * never encoded and is left alone.
 *
 * The `~` cannot tell a strikethrough from a subscript, so a text before a
 * subscript, or a subscript's own text, gains the backslash too
 * (`use \n~b~` → `use \\n~b~`), as does one beside a run whose character is
 * not encoded after all; each reads back the same. Before anything else the
 * text keeps its bytes.
 */
function keepBackslashBeforeRun(output: string, { after }: Info): string {
  if (!/^[*_~]/.test(after)) return output;
  const lastStart = output.length - (/[\uDC00-\uDFFF]$/.test(output) ? 2 : 1);
  if (lastStart < 1 || /^[!-/:-@[-`{-~]$/.test(output.slice(lastStart))) {
    return output;
  }
  let backslashes = 0;
  while (output[lastStart - 1 - backslashes] === "\\") backslashes++;
  return backslashes % 2 === 1
    ? `${output.slice(0, lastStart)}\\${output.slice(lastStart)}`
    : output;
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

/** Where mdast-util-gfm-autolink-literal does not ask for its escapes (its
 *  `notInConstruct`): no autolink forms inside these. */
const NO_AUTOLINK_CONSTRUCTS: ReadonlySet<ConstructName> = new Set([
  "autolink",
  "image",
  "label",
  "link",
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
 * The `.` of `www.` and the `:` of `http(s)://` ({@link startsWebAddress})
 * are written `\.` and `\:` outside {@link NO_AUTOLINK_CONSTRUCTS}. micromark
 * starts a link there and keeps the backslash of any escape inside it:
 * `see www._1.` was written `see www.\_1.` and read back as a link to
 * `www.\_1`. remark means to escape both (mdast-util-gfm-autolink-literal's
 * `unsafe`), but only the `.` before a `-`, `.` or word character, skipped
 * when that character is escaped anyway (the skip `$` had), and the `:` only
 * after a lowercase `p` or `s`. With both escaped, micromark starts no link,
 * and the autolink text transform — which reads the text after escapes are
 * taken out — decides whether one forms.
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
 *   another verbatim node (a wikilink's display text can hold one) would close
 *   there into a link. The whole text keeps its escapes, so a `]` of its own
 *   before the last closes that `[` first.
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
  const inLink = state.stack.some((name) => NO_AUTOLINK_CONSTRUCTS.has(name));

  const bracketsMayBeRaw =
    !state.stack.some((name) => LITERAL_CONSTRUCTS.has(name)) &&
    !(value.endsWith("]") && following(value.length - 1) === "(");

  const waiting: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "$") {
      if (!inSpan) written.push([index, "\\$"]);
    } else if (character === "." || character === ":") {
      if (!inLink && startsWebAddress(value, index, info.before, following)) {
        written.push([index, `\\${character}`]);
      }
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

/**
 * Whether the `.` or `:` at `index` is where micromark's GFM autolink literal
 * starts a web address: the `.` of `www.` (any case) before a character that
 * is not whitespace — micromark starts a link at `www.` whatever follows,
 * and before whitespace the link it can make is `www` alone, which no escape
 * can join — or the `:` of `http` or `https` (any case) before a `/`.
 * `before` is the text written just ahead of `value`.
 */
function startsWebAddress(
  value: string,
  index: number,
  before: string,
  following: (index: number) => string,
): boolean {
  const ahead = (before + value.slice(0, index)).slice(-5).toLowerCase();
  return value[index] === "."
    ? ahead.endsWith("www") && /\S/.test(following(index))
    : /https?$/.test(ahead) && following(index) === "/";
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

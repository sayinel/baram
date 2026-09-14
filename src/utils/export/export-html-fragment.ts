// issue 631 — what the pandoc export's image policy reads out of an html node.
//
// The policy (export-markdown-images.ts) judges every image pandoc will read;
// an `<img …>` tag in raw HTML is one of them only if pandoc reads the tag as
// a TAG. Inside an HTML block pandoc keeps parsing markdown
// (`markdown_in_html_blocks`), so a tag inside a code fence, a code span,
// `$…$` math, an indented line, a link destination or a raw-text element is
// code, math, text or a target to pandoc, and turning it into a markdown
// image would corrupt the document or stage a file nothing shows. Telling
// those apart for every shape means re-implementing pandoc's reader piece by
// piece — each piece with its own edge — which the vault-boundary layer in
// Rust already refused to do for its side.
//
// This module takes the other road: a POSITIVE grammar. A node is SUPPORTED
// when its text is nothing but well-formed tags, comments and caption text
// that pandoc can only read as words; the policy edits the `<img>` tags of a
// supported node and leaves every other node alone whole, telling the user
// that block could not be read. The rules are the shapes pandoc 3.11 was
// measured on (`--from markdown`, default extensions). Inside a paragraph
// the parser has already separated an inline tag from code spans, escapes
// and math, so such a node is a single tag and trivially supported; the
// grammar is what an HTML BLOCK gets — and its caption text never holds a
// blank line (a blank line ends the block; only a comment or a verbatim
// body may span one, and neither is caption text), which is why no rule
// here needs to know where a paragraph ends.
//
// Supported items:
// - an `<img …>` start tag, well formed (CommonMark's open-tag grammar, in
//   the name and attribute-name alphabets pandoc was measured to accept);
// - a WRAPPER: any other well-formed open, close or self-closing tag whose
//   name is not one of `OPAQUE` — `div`, `p`, `a`, `figure`, `td`, `br`, Word's
//   `o:p` … Attribute values are opaque: a backtick or an `<img` in a
//   `title="…"` is nothing (measured: pandoc consumes the tag whole);
// - a COMMENT `<!-- … -->` that is not abrupt (`<!-->`, `<!--->`: HTML closes
//   those at once, pandoc does not) and holds no `--!>` (HTML ends there);
// - CAPTION TEXT between items — words, and only words. No backtick (code),
//   `$` (math), `\` (an escape, raw TeX), `<` that is not an item, bracket
//   of any kind (`[` `]` `{` `}`: a link or reference definition takes a tag
//   as its destination or title, a bracketed span takes one as an attribute,
//   `{width=1%}` right after a rewritten image would become its attribute —
//   all measured), or `|` (a pipe table inside the block splits a cell on a
//   `|` in a rewritten alt — measured). And no line, after the node's first,
//   indented four columns or by a tab (an indented code block — measured:
//   pandoc reads `<div>\n    <img>` as one inside the div, and so a 4-space
//   line after `</p>` or after a heading), nor beginning with `~~~`, `>`, a
//   definition marker or any list marker pandoc's markdown knows — bullet,
//   number, letter, roman numeral, `#`, example label (`- ~~~` and `> ~~~`
//   open a fence inside a container, `>     <img>` and `(@x)     <img>` are
//   indented code — measured); right
//   after a tag the same run of tildes or marker is refused too (`<div> ~~~`
//   opens a fence; `<img>~~~` does not, and the grammar does not know block
//   tags from inline ones). `<img a>\n    <img b>` is a paragraph
//   continuation pandoc allows, refused here on purpose.
//
// Anything else — an unclosed tag, an attribute shape outside the grammar
// (a leading `=`, a quote inside an unquoted value, an empty `src=`), a
// raw-text element, a fence, code, math, an escaped `<`, an indented line —
// makes the whole node unsupported. What stands OUTSIDE the node is the
// walk's to judge (export-markdown-image-walk.ts): a region pandoc reads
// through — a comment, a verbatim body or a raw TeX environment an earlier
// node opened and did not close (export-raw-regions.ts) — and braces an earlier
// sibling left open around an inline tag (`\texttt{…}`, `[x]{title="…"}`).
import {
  CLOSE_TAG,
  COMMENT,
  OPAQUE,
  OPEN_TAG,
  type TagSpan,
} from "./export-html-grammar";
import { LINE_END } from "./export-html-node-offsets";
import { rawRegions, type RawRegions } from "./export-raw-regions";

export type { TagSpan } from "./export-html-grammar";

/** A bullet (`-` `*` `+`) or a definition marker (`:` `~`). */
const BULLET = "[-*+:~]";
/** What an ordered marker counts with: a number, a lowercase letter, a
 *  roman numeral, `#`, or an example label `@x`. */
const ORDINAL =
  "(?:\\d{1,9}|[a-z]|[ivxlcdm]{1,9}|[IVXLCDM]{2,9}|#|@[A-Za-z0-9_-]*)";
/** An ordered marker: the ordinal with `.` or `)`, or in parentheses. */
const ORDERED = `(?:\\(${ORDINAL}\\)|${ORDINAL}[.)])`;
/** A single capital letter as an ordinal — with `)` or in parentheses like
 *  any other, but with a period only before TWO spaces: pandoc's own rule,
 *  so that `B. Smith` and `I. Newton` are text. */
const CAPITAL = "[A-Z]";
const CAPITAL_MARKER = `(?:\\(${CAPITAL}\\)|${CAPITAL}\\))`;
const CAPITAL_PERIOD = `${CAPITAL}\\.(?:  |\\t|$)`;
/** A marker needs its space (or the line's end) after it. */
const MARKER = `(?:(?:${BULLET}|${ORDERED}|${CAPITAL_MARKER})(?:[ \\t]|$)|${CAPITAL_PERIOD})`;
/** What may not begin a line of supported text (after up to three spaces),
 *  nor follow a tag (after any spaces): a tilde fence, a blockquote marker,
 *  or a list marker. Each puts a following tag inside a block pandoc reads
 *  as code (`(@x)     <img>` is a code block in an example list — measured),
 *  or opens a container the indentation rule cannot see into. A marker
 *  needs its space, so `Fig. 1` and `well-known` are text. */
const BLOCK_START = `(?:~~~|>|${MARKER})`;
const AFTER_TAG = new RegExp(`^ *${BLOCK_START}`);
const LINE_START = new RegExp(`^ {0,3}${BLOCK_START}`);
/** A line, after the first, indented four columns or by a tab. */
const INDENTED = /^(?: {4}| {0,3}\t)/;
/** The characters caption text may not hold (a `<` never reaches it: the
 *  text ends where the next item begins). */
const NOT_CAPTION = /[`$\\[\]{}|]/;

/**
 * The `<img …>` start tags of a supported html node, as offsets in its
 * text, or null when the node is not the policy's to read.
 */
export function readHtmlFragment(value: string): null | TagSpan[] {
  const spans: TagSpan[] = [];
  let i = 0;
  while (i < value.length) {
    const lt = value.indexOf("<", i);
    const text = value.slice(i, lt === -1 ? value.length : lt);
    if (!isSupportedText(text)) return null;
    if (lt === -1) break;
    const rest = value.slice(lt);
    const comment = COMMENT.exec(rest);
    if (comment !== null) {
      i = lt + comment[0].length;
      continue;
    }
    const close = CLOSE_TAG.exec(rest);
    if (close !== null) {
      if (OPAQUE.has(close[1].toLowerCase())) return null;
      i = lt + close[0].length;
      continue;
    }
    const open = OPEN_TAG.exec(rest);
    if (open === null) return null;
    const name = open[1].toLowerCase();
    if (OPAQUE.has(name)) return null;
    i = lt + open[0].length;
    if (name === "img") spans.push({ end: i, start: lt });
  }
  return spans;
}

/** Is `text` — what stands between two items, or before the first or after
 *  the last — text pandoc reads as inline prose (words, emphasis, a heading
 *  line) and never as code, math, a fence, a container or a link target? */
function isSupportedText(text: string): boolean {
  if (NOT_CAPTION.test(text)) return false;
  const [first, ...rest] = text.split(LINE_END);
  if (AFTER_TAG.test(first)) return false;
  return rest.every((line) => !INDENTED.test(line) && !LINE_START.test(line));
}

/** Fenced code, for the candidate estimate: an opener line of three or more
 *  backticks or tildes, closed by a line of three or more of the same
 *  character (a longer opener is not held to its length — an estimate) or
 *  running to the end. */
const FENCED_CODE =
  /(^|[\r\n])[ \t]*(?<fence>`|~)\k<fence>{2,}[^\r\n]*(?:[\r\n][^]*?(?:[\r\n][ \t]*\k<fence>{3,}[ \t]*(?=[\r\n]|$)|$)|$)/g;
/** A code span, for the candidate estimate. */
const CODE_SPAN = /`[^`]*`/g;
/** Code pandoc cannot read an image in. */
const CODE = [FENCED_CODE, CODE_SPAN];

/**
 * Might this text hold an image pandoc would read? An estimate for the
 * "may be missing" notice about a node this module did not read: an `<img`
 * start or a markdown image outside code, comments, verbatim bodies and raw
 * TeX — never a count of images, and a code sample of a tag is not one.
 *
 * A region the text opens and does not close hides what follows it only
 * when the opener is real (`rawRegions` with the walk's oracle): pandoc
 * reads an opener whose closer never comes as text (a `\\begin{}`) or as
 * the tag alone (a `<script>`, a `<!--`), and shows the images after it;
 * the browser's reading, in which an unclosed comment swallows the rest of
 * the page, is not pandoc's.
 */
export function mayHoldImage(
  value: string,
  { closed, open }: RawRegions = rawRegions(value),
): boolean {
  // The closed regions are blanked in one pass over the text — rebuilding
  // the string per region made a block of thousands of comments quadratic
  // (344 KiB: 1.8 s). Their widths are kept so nothing shifts.
  const upto = open === null ? value.length : open.at;
  const parts: string[] = [];
  let cursor = 0;
  for (const { end, start } of closed) {
    if (start >= upto) break;
    parts.push(
      value.slice(cursor, start),
      " ".repeat(Math.min(end, upto) - start),
    );
    cursor = Math.min(end, upto);
  }
  parts.push(value.slice(cursor, upto));
  let text = parts.join("");
  for (const region of CODE) text = text.replace(region, " ");
  return /<img(?=[\s/>])/i.test(text) || text.includes("![");
}

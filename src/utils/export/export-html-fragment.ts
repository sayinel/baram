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
// makes the whole node unsupported. A region pandoc reads through — a
// comment, a verbatim body or a raw TeX environment an earlier node opened
// and did not close — is carried across the nodes that follow by the policy
// walk (`rawOpenedBy`), since the parser splits such a region into several
// nodes. Not emulated and left to pandoc: a `\texttt{…}` or a `[x]{title="…"}`
// around an inline tag hides it from pandoc while the parser hands it over
// on its own; the tag is then rewritten and its file staged for nothing,
// and the filter drops the construct as it always did.
import { LINE_END } from "./export-html-node-offsets";

/** One `<img …>` tag's offsets in the text it was read from. */
export interface TagSpan {
  end: number;
  start: number;
}

/** Elements whose body pandoc keeps verbatim (the manual's four exceptions
 *  to markdown inside HTML — measured: `noscript`, `title`, `iframe` bodies
 *  are markup to it): an `<img` in there is not a tag. The one list every
 *  rule about verbatim bodies is built from. */
const OPAQUE = new Set(["pre", "script", "style", "textarea"]);
/** A comment's end as HTML reads it, and pandoc too (measured: `--!>`). */
const COMMENT_END = "--!?>";

/** ASCII whitespace — what may separate a tag's attributes, lines included. */
const WS = "[ \\t\\n\\r\\f]";
/** A tag name, and an attribute name: a letter, then letters, digits, `_`,
 *  `:` (Word's `<o:p>`, `xml:lang`) or `-`. No `.`, no leading `_` or `:` —
 *  measured: pandoc reads `<a.b>`, `<img a.b="x">` and `<img _x="v">` as
 *  text, not as tags. */
const NAME = "[A-Za-z][A-Za-z0-9_:-]*";
/** An attribute: a name, and a value that is quoted or plain. Any Unicode
 *  space (`\s`) ends a plain value's grammar — HTML and pandoc do not agree
 *  on a no-break space there. */
const ATTRIBUTE = `${NAME}(?:${WS}*=${WS}*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\`]+))?`;
/** A well-formed open or self-closing tag, at the start of the text. */
const OPEN_TAG = new RegExp(`^<(${NAME})(?:${WS}+${ATTRIBUTE})*${WS}*/?>`);
/** A well-formed closing tag (no attributes), at the start of the text. */
const CLOSE_TAG = new RegExp(`^</(${NAME})${WS}*>`);
/** A comment as HTML and pandoc both end it: not abrupt, no `--!>`. */
const COMMENT = /^<!--(?!-?>)(?:(?!--!>)[^])*?-->/;
/** What may not begin a line of caption text (after up to three spaces),
 *  nor follow a tag (after any spaces): a tilde fence, a blockquote marker,
 *  a bullet, a definition marker (`:` or `~`), or any ordered-list marker
 *  pandoc's markdown knows — a number, a letter, a roman numeral, `#` or an
 *  example label `@x`, with `.` or `)` and optionally in parentheses. Each
 *  puts a following tag inside a block pandoc reads as code (`(@x)     <img>`
 *  is a code block in an example list — measured), or opens a container the
 *  indentation rule cannot see into. A marker needs its space, so `Fig. 1`
 *  and `well-known` are caption text. */
const ORDERED =
  "(?:\\d{1,9}|[a-z]|[ivxlcdm]{1,9}|[IVXLCDM]{2,9}|#|@[A-Za-z0-9_-]*)";
/** A single capital letter and a period is a marker only before two spaces
 *  — pandoc's own rule, so that `B. Smith` and `I. Newton` are text. */
const CAPITAL = "[A-Z]";
const MARKER = `(?:(?:[-*+:~]|\\(${ORDERED}\\)|\\(${CAPITAL}\\)|${ORDERED}[.)]|${CAPITAL}\\))(?:[ \\t]|$)|${CAPITAL}\\.(?:  |\\t|$))`;
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
    if (!isCaption(text)) return null;
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
 *  the last — caption text pandoc cannot read as anything but words? */
function isCaption(text: string): boolean {
  if (NOT_CAPTION.test(text)) return false;
  const [first, ...rest] = text.split(LINE_END);
  if (AFTER_TAG.test(first)) return false;
  return rest.every((line) => !INDENTED.test(line) && !LINE_START.test(line));
}

/** Code pandoc cannot read an image in: fenced code (closed by three or
 *  more of its own character — a longer opener is not held to its length,
 *  an estimate) and a code span. */
const CODE = [
  /(^|[\r\n])[ \t]*(`|~)\2{2,}[^\r\n]*(?:[\r\n][^]*?(?:[\r\n][ \t]*\2{3,}[ \t]*(?=[\r\n]|$)|$)|$)/g,
  /`[^`]*`/g,
];

/** The raw TeX environment opener pandoc's `raw_tex` reads, at the text's start. */
const TEX_BEGIN = /^\\begin\{([^{}]+)\}/;

/** What a text opens and does not close: the pattern that closes it, and
 *  where the region began. */
interface OpenRegion {
  at: number;
  until: RegExp;
}

/**
 * The regions of `value` pandoc reads through — a comment, a verbatim
 * element with its body, a raw TeX environment — found by the tag grammar,
 * so that an opener inside an attribute value (`title="<script>"`) opens
 * nothing. `closed` are the regions that end inside the text; `open` is the
 * one that does not, if any. An abrupt comment (`<!-->`, `<!--->`) is
 * closed at once.
 */
function rawRegions(value: string): {
  closed: TagSpan[];
  open: null | OpenRegion;
} {
  const closed: TagSpan[] = [];
  let i = 0;
  while (i < value.length) {
    const lt = value.indexOf("<", i);
    const begin = value.indexOf("\\begin{", i);
    if (lt === -1 && begin === -1) break;
    if (begin !== -1 && (lt === -1 || begin < lt)) {
      const env = TEX_BEGIN.exec(value.slice(begin));
      if (env === null) {
        i = begin + 1;
        continue;
      }
      const name = env[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const end = new RegExp(`\\\\end\\{${name}\\}`, "g");
      end.lastIndex = begin + env[0].length;
      const closer = end.exec(value);
      if (closer === null) {
        return { closed, open: { at: begin, until: new RegExp(end.source) } };
      }
      closed.push({ end: closer.index + closer[0].length, start: begin });
      i = closer.index + closer[0].length;
      continue;
    }
    const rest = value.slice(lt);
    if (rest.startsWith("<!--")) {
      const abrupt = /^<!---?>/.exec(rest);
      if (abrupt !== null) {
        closed.push({ end: lt + abrupt[0].length, start: lt });
        i = lt + abrupt[0].length;
        continue;
      }
      const end = new RegExp(COMMENT_END, "g");
      end.lastIndex = lt + 4;
      const closer = end.exec(value);
      if (closer === null) {
        return { closed, open: { at: lt, until: new RegExp(COMMENT_END) } };
      }
      closed.push({ end: closer.index + closer[0].length, start: lt });
      i = closer.index + closer[0].length;
      continue;
    }
    const close = CLOSE_TAG.exec(rest);
    if (close !== null) {
      i = lt + close[0].length;
      continue;
    }
    const open = OPEN_TAG.exec(rest);
    if (open === null) {
      i = lt + 1;
      continue;
    }
    i = lt + open[0].length;
    const name = open[1].toLowerCase();
    if (!OPAQUE.has(name)) continue;
    const end = new RegExp(`</${name}(?=[\\s/>])`, "gi");
    end.lastIndex = i;
    const closer = end.exec(value);
    if (closer === null) {
      return { closed, open: { at: lt, until: new RegExp(end.source, "i") } };
    }
    closed.push({ end: closer.index + closer[0].length, start: lt });
    i = closer.index + closer[0].length;
  }
  return { closed, open: null };
}

/**
 * Might this text hold an image pandoc would read? An estimate for the
 * "may be missing" notice about a node this module did not read: an `<img`
 * start or a markdown image outside code, comments, verbatim bodies and raw
 * TeX — never a count of images, and a code sample of a tag is not one.
 */
export function mayHoldImage(value: string): boolean {
  const { closed, open } = rawRegions(value);
  let text = open === null ? value : value.slice(0, open.at);
  for (const { end, start } of closed) {
    text = text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
  }
  for (const region of CODE) text = text.replace(region, " ");
  return /<img(?=[\s/>])/i.test(text) || text.includes("![");
}

/**
 * The closer of the comment, verbatim element or raw TeX environment
 * `value` opens without closing, or null — for a node the policy did not
 * read (or a text node), whose region pandoc carries into the nodes that
 * follow. A plain (non-global) pattern to test the following nodes' text
 * with.
 */
export function rawOpenedBy(value: string): null | RegExp {
  return rawRegions(value).open?.until ?? null;
}

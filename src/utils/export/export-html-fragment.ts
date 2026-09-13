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
// grammar is what an HTML BLOCK gets — and an HTML block never holds a blank
// line, which is why no rule here needs to know where a paragraph ends.
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
//   line after `</p>` or after a heading), nor beginning with `~~~`, `>` or
//   a list, definition or number marker (`- ~~~` and `> ~~~` open a fence
//   inside a container, `>     <img>` is indented code — measured); right
//   after a tag the same run of tildes or marker is refused too (`<div> ~~~`
//   opens a fence; `<img>~~~` does not, and the grammar does not know block
//   tags from inline ones). `<img a>\n    <img b>` is a paragraph
//   continuation pandoc allows, refused here on purpose.
//
// Anything else — an unclosed tag, an attribute shape outside the grammar
// (a leading `=`, a quote inside an unquoted value, an empty `src=`), a
// raw-text element, a fence, code, math, an escaped `<`, an indented line —
// makes the whole node unsupported. Not emulated and left to pandoc: what
// stands OUTSIDE the node. A raw TeX environment spanning blank lines, a
// comment spanning them, a `\texttt{…}` or a `[x]{title="…"}` around an
// inline tag all hide it from pandoc while the parser hands it over on its
// own; the tag is then rewritten and its file staged for nothing, and the
// filter drops the construct as it always did.
import { parseImgHtml } from "../../pipeline/transformers/image-transformer";

/** One `<img …>` tag's offsets in the text it was read from. */
export interface TagSpan {
  end: number;
  start: number;
}

/** What an `<img>` tag says as HTML reads it. `src` null: absent or empty. */
export interface LooseImg {
  alt: null | string;
  /** Every attribute as HTML read it, untrimmed; null when the tag did not parse. */
  attrs: Map<string, string> | null;
  src: null | string;
}

/** The size and title the editor's own tag carries. */
export interface EditorSize {
  title?: null | string;
  widthPercent?: number;
  widthPixel?: number;
}

/** Elements whose body pandoc keeps verbatim (the manual's four exceptions
 *  to markdown inside HTML — measured: `noscript`, `title`, `iframe` bodies
 *  are markup to it): an `<img` in there is not a tag. */
const OPAQUE = new Set(["pre", "script", "style", "textarea"]);

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
  "(?:\\d{1,9}|[A-Za-z]|[ivxlcdm]{1,9}|[IVXLCDM]{1,9}|#|@[A-Za-z0-9_-]*)";
const BLOCK_START = `(?:~~~|>|(?:[-*+:~]|\\(${ORDERED}\\)|${ORDERED}[.)])(?:[ \\t]|$))`;
const AFTER_TAG = new RegExp(`^ *${BLOCK_START}`);
const LINE_START = new RegExp(`^ {0,3}${BLOCK_START}`);
/** A line, after the first, indented four columns or by a tab. */
const INDENTED = /^(?: {4}| {0,3}\t)/;
/** The characters caption text may not hold. `<` is only ever an item. */
const NOT_CAPTION = /[`$\\<[\]{}|]/;

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
  const [first, ...rest] = text.split(/\r\n|\r|\n/);
  if (AFTER_TAG.test(first)) return false;
  return rest.every((line) => !INDENTED.test(line) && !LINE_START.test(line));
}

/** Where pandoc cannot read an image even in a node this module does not
 *  read: fenced code, a code span, a comment (abrupt ones close at once, an
 *  unclosed one runs to the end) and the body of a verbatim element. */
const NOT_A_CANDIDATE = [
  /(^|[\r\n])[ \t]*(`{3,}|~{3,})[^\r\n]*(?:[\r\n][^]*?(?:[\r\n][ \t]*\2[ \t]*(?=[\r\n]|$)|$)|$)/g,
  /`[^`]*`/g,
  /<!--(?:-?>|(?:(?!--!?>)[^])*(?:--!?>|$))/g,
  /<(pre|script|style|textarea)(?=[\s/>])[^]*?(?:<\/\1(?=[\s/>])|$)/gi,
];

/**
 * Might this text hold an image pandoc would read? An estimate for the
 * "may be missing" notice about a node this module did not read: an `<img`
 * start or a markdown image outside code, comments and verbatim bodies —
 * never a count of images, and a code sample of a tag is not one.
 */
export function mayHoldImage(value: string): boolean {
  let text = value;
  for (const region of NOT_A_CANDIDATE) text = text.replace(region, " ");
  return /<img(?=[\s/>])/i.test(text) || text.includes("![");
}

/** One `<template>` kept for parsing. Its contents live in an inert document
 *  with no browsing context: nothing in there loads or runs. */
let host: HTMLTemplateElement | null = null;

/**
 * The tag's attributes as HTML reads them, by parsing it inside the template
 * as `<baram-img …>` — an inert custom element, never an `<img>`, whose
 * element would fetch its source, the very thing still to be judged. The
 * parser gives attribute-value decoding (references by attribute rules, a
 * legacy `&copy` staying literal before a letter), the first of a duplicate,
 * lowercased names and line endings normalised to LF. Null when there is no
 * document, or when the parse did not yield exactly one empty element — the
 * grammar promised one complete start tag, so anything else is refused.
 */
function parseTag(raw: string): Map<string, string> | null {
  if (typeof document === "undefined") return null;
  host ??= document.createElement("template");
  try {
    host.innerHTML = `<baram-img${raw.slice(4)}`; // `raw` begins with `<img`
    const { content } = host;
    const el = content.firstElementChild;
    if (
      el === null ||
      content.childNodes.length !== 1 ||
      el.childNodes.length !== 0 ||
      el.tagName.toLowerCase() !== "baram-img"
    ) {
      return null;
    }
    const attrs = new Map<string, string>();
    for (const { name, value } of Array.from(el.attributes)) {
      attrs.set(name, value);
    }
    return attrs;
  } finally {
    host.innerHTML = "";
  }
}

/** One attribute value decoded once, by attribute rules — for comparing the
 *  strict parser's raw capture with what HTML read. `text` holds no `"`. */
function decodeAttributeValue(text: string): null | string {
  if (typeof document === "undefined") return null;
  host ??= document.createElement("template");
  try {
    host.innerHTML = `<baram-x a="${text}">`;
    return host.content.firstElementChild?.getAttribute("a") ?? null;
  } finally {
    host.innerHTML = "";
  }
}

/**
 * The tag's `src` and `alt` as HTML reads them. The strict parser
 * (`parseImgHtml`) exists for the MD→PM round-trip and refuses anything it
 * could not write back byte for byte; the export only has to know where the
 * image points and what to say if it cannot embed it.
 */
export function readImgTag(raw: string): LooseImg {
  const attrs = parseTag(raw);
  const src = attrs?.get("src")?.trim() ?? "";
  const alt = attrs?.get("alt");
  return { alt: alt ?? null, attrs, src: src === "" ? null : src };
}

/** The attributes the strict parser reads and would write back. */
const STRICT_ATTRS = ["src", "alt", "title", "width"] as const;

/**
 * Title and size for a tag the editor itself wrote — the strict parser
 * accepts exactly that spelling — and only when it and HTML agree on every
 * attribute it copies. The strict parser's name scan can be fooled by a
 * quoted value that spells another attribute (`alt='width="640"'`); HTML's
 * tokenizer cannot, so each of the parser's raw captures is decoded once by
 * attribute rules and compared, untrimmed, with what HTML read. Any
 * disagreement keeps no size and no title: the image is still judged by
 * HTML's reading. Any other tag keeps no size either — pandoc's `{width=…}`
 * is only written for a width the editor would have round-tripped.
 */
export function editorSize(raw: string, loose: LooseImg): EditorSize {
  const strict = parseImgHtml(raw);
  if (strict === null || loose.attrs === null) return {};
  for (const name of STRICT_ATTRS) {
    const capture = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(raw)?.[1];
    const parsed = capture === undefined ? null : decodeAttributeValue(capture);
    if (parsed !== (loose.attrs.get(name) ?? null)) return {};
  }
  return {
    title: strict.title,
    widthPercent: strict.widthPercent,
    widthPixel: strict.widthPixel,
  };
}

/** A line terminator as the parser reads it (global: searched from `lastIndex`). */
const LINE_END = /\r\n|\r|\n/g;

/**
 * Offsets in an html node's text → offsets in the source. The text is the
 * source with the container prefix of every continuation line (`> `, list
 * indentation) removed, so a middle line of the text is the tail of its
 * source line, and the last line sits after the same prefix as the line
 * before it. Returns null when the lines cannot be aligned — the caller then
 * leaves the node alone rather than guess.
 */
export function valueToSource(
  value: string,
  source: string,
  startOffset: number,
): ((offset: number) => number) | null {
  // Lines end in LF, CRLF or a lone CR — the parser reads all three, and
  // keeps each as written, so the same terminator is looked for in the source.
  const lines = value.split(/\r\n|\r|\n/);
  const valueStarts: number[] = [];
  const sourceStarts: number[] = [];
  let valueAt = 0;
  let cursor = startOffset; // where the current source line begins
  let prefix = 0; // container prefix length of the previous line
  for (let k = 0; k < lines.length; k += 1) {
    const line = lines[k];
    LINE_END.lastIndex = cursor;
    const terminator = LINE_END.exec(source);
    const lineEnd = terminator === null ? source.length : terminator.index;
    const delimiter = terminator === null ? 1 : terminator[0].length;
    // The parser expands a leading tab to spaces, so a continuation line of
    // the text may begin with more blanks than its source line: align on the
    // line's first non-blank character and let the blanks before it map to
    // that same spot (no tag starts or ends inside them).
    const lead = /^[ \t]*/.exec(line)![0].length;
    const body = line.slice(lead);
    let at: number;
    if (k === 0) {
      // The parser expands a tab that ends the container prefix into spaces
      // at the head of the text (`>\t<img` → `  <img`) while `start.offset`
      // already sits past the tab: align the first line on its first
      // non-blank character as well, and let the synthesised blanks map to
      // that same spot.
      at = cursor;
      if (!source.startsWith(line, cursor)) {
        if (!source.startsWith(body, cursor)) return null;
        valueStarts.push(lead);
        sourceStarts.push(at);
        valueAt += line.length + delimiter;
        cursor = lineEnd + delimiter;
        continue;
      }
    } else if (k < lines.length - 1) {
      at = lineEnd - body.length;
      if (at < cursor || !source.startsWith(body, at)) return null;
      prefix = at - cursor;
    } else {
      at = cursor + prefix;
      if (!source.startsWith(body, at)) {
        at = source.indexOf(body, cursor);
        if (at === -1 || at > lineEnd) return null;
      }
    }
    valueStarts.push(valueAt + (k === 0 ? 0 : lead));
    sourceStarts.push(at);
    valueAt += line.length + delimiter;
    cursor = lineEnd + delimiter;
  }
  return (offset: number): number => {
    let k = valueStarts.length - 1;
    while (k > 0 && valueStarts[k] > offset) k -= 1;
    return sourceStarts[k] + Math.max(0, offset - valueStarts[k]);
  };
}

// issue 631 — the tag grammar pandoc 3.11 was measured on, shared by the
// fragment reader (export-html-fragment.ts) and the raw-region scanner
// (export-raw-regions.ts). Regex SOURCES (strings) are composed into the
// patterns that follow them; `new RegExp` marks where a pattern is built.

/** One `<img …>` tag's offsets in the text it was read from. */
export interface TagSpan {
  end: number;
  start: number;
}

/** Elements whose body pandoc keeps verbatim (the manual's four exceptions
 *  to markdown inside HTML — measured: `noscript`, `title`, `iframe` bodies
 *  are markup to it): an `<img` in there is not a tag. The one list every
 *  rule about verbatim bodies is built from. */
export const OPAQUE = new Set(["pre", "script", "style", "textarea"]);
/** A comment's end as HTML reads it, and pandoc too (measured: `--!>`). */
export const COMMENT_END = "--!?>";

/** ASCII whitespace — what may separate a tag's attributes, lines included. */
export const WS = "[ \\t\\n\\r\\f]";
/** A tag name, and an attribute name: a letter, then letters, digits, `_`,
 *  `:` (Word's `<o:p>`, `xml:lang`) or `-`. No `.`, no leading `_` or `:` —
 *  measured: pandoc reads `<a.b>`, `<img a.b="x">` and `<img _x="v">` as
 *  text, not as tags. */
export const NAME = "[A-Za-z][A-Za-z0-9_:-]*";
/** An attribute: a name, and a value that is quoted or plain. Any Unicode
 *  space (`\s`) ends a plain value's grammar — HTML and pandoc do not agree
 *  on a no-break space there. */
export const ATTRIBUTE = `${NAME}(?:${WS}*=${WS}*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\`]+))?`;
/** A well-formed open or self-closing tag, at the start of the text. */
export const OPEN_TAG = new RegExp(
  `^<(${NAME})(?:${WS}+${ATTRIBUTE})*${WS}*/?>`,
);
/** A well-formed closing tag (no attributes), at the start of the text. */
export const CLOSE_TAG = new RegExp(`^</(${NAME})${WS}*>`);
/** A comment as HTML and pandoc both end it: not abrupt, no `--!>`. */
export const COMMENT = /^<!--(?!-?>)(?:(?!--!>)[^])*?-->/;

/** The raw TeX environment opener pandoc's `raw_tex` reads, at the text's start. */
export const TEX_BEGIN = /^\\begin\{([^{}]+)\}/;

// issue 527 — the markdown export's last word on every link.
//
// Sibling of export-html-links.ts for the routes that leave the app as a
// markdown STRING rather than a DOM clone: Pandoc (docx, epub, latex, rst,
// html5) and Notion. Issue 499 settled the rule — the document model keeps a
// destination byte-for-byte, and each consumer applies the link policy at its
// own output point — but these two consumers had none, so a
// `[click me](javascript:…)` reached pandoc verbatim and came out as a live
// hyperlink in every format (an EPUB reader is a WebKit page).
//
// Runs LAST in each route, after every converter (wikilinks become
// `[x](page.md)`, mermaid fences become `![](asset)`), so nothing downstream
// can rewrite a destination behind its back — the same ordering contract the
// HTML scrub states. It parses the string with the editor's own grammar
// (parse-mdast: gfm, math, YAML frontmatter), so code spans, fences, math and
// frontmatter are never mistaken for links and no regex ever runs over the
// text. A refused link is replaced by its label; the label is re-serialized
// with remark-stringify (configured like the pipeline's serializer — the
// serializer itself sits inside the pm-to-md closure that production code
// outside the pipeline may not import, pm-to-md-import-boundary.test.ts)
// rather than spliced from the source, because a label such as `# heading`
// or `- item` dropped raw at the start of a line would become a heading or a
// list — the serializer escapes exactly those block starters (`\#`, `\-`)
// and keeps inline formatting. Three things the serializer cannot know from
// the label alone are handled here: inside a GFM table cell the label's
// pipes are escaped (the cell ends at the next unescaped pipe, code spans
// included); a label that begins like one of pandoc's list or definition
// markers (`(@x)`, `(a)`, `a.`, `iv)`, `:`) gets the marker's punctuation
// escaped, because pandoc — not remark — would start a block there; and a
// label that ends a heading in `#` or `{…}` gets that escaped, since there it
// would read as the closing sequence or pandoc's attribute block and vanish.
// Labels are also written on ONE line — a soft or hard break inside one
// becomes the space it rendered as — so a label that spanned lines inside a
// block quote or list cannot leave the container's continuation marks behind.
// And because a splice can fuse with its neighbours into new syntax (`<` +
// label + `>` is an autolink, `&` + label + `;` a character reference), a
// left neighbour that could do so is escaped with the edit, and the pass
// repeats on its own output until nothing refused is left. A document with
// nothing to refuse comes back as the very same string.
//
// Reference-style links: every `[label][ref]` (full, collapsed or shortcut)
// whose identifier has ANY refused definition becomes its label. pandoc lets
// the last duplicate definition win where CommonMark lets the first, so the
// union is the only answer that is right for both readers. The definitions
// themselves stay: an unreferenced definition renders as nothing in pandoc
// and Notion, deleting one inside a list item or block quote would leave a
// dangling marker, and an image reference (outside this policy, see below)
// may still need it.
//
// Not covered here, deliberately, and tracked separately: raw HTML (`html`
// nodes — pandoc's markdown reader passes `<a href>`, `<script>` and event
// handlers through to html5/epub; inline raw HTML arrives as separate open
// and close tag nodes, so a per-node sanitizer would corrupt it), raw TeX
// (`\href{javascript:…}{x}` is plain text to remark and a hyperlink command
// to pandoc's latex writer — same class, same reader-profile decision) and
// image sources (499 did not scrub `<img src>` either; pandoc's own resource
// access is a different threat model from a live hyperlink).
import type { Link, LinkReference, Nodes, PhrasingContent, Root } from "mdast";

import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import { parseMdast } from "../../pipeline/parse-mdast";
import { isAllowedLinkHref } from "../link-href";

interface SourceEdit {
  end: number;
  start: number;
  text: string;
}

/** Label serializer: the pipeline serializer's inline conventions (`**`, `*`)
 *  with the same gfm/math grammar parseMdast produced the nodes with. */
const labelSerializer = unified()
  .use(remarkStringify, { emphasis: "*", strong: "*" })
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath);

/**
 * Replace every link whose destination {@link isAllowedLinkHref} refuses —
 * inline, angle autolink, or reference-style — with its label. Returns the
 * input string itself when there is nothing to refuse.
 *
 * A splice can hand its neighbours a construct that was not there before:
 * `<[javascript:x](javascript:y)>` is a literal `<`, a refused link and a
 * literal `>`, and would become the autolink `<javascript:x>`; `&[amp](…);`
 * would become the character reference `&amp;`; `[[x](…)](https://…)` would
 * become a link. Two defences. The character to the LEFT of a replaced link
 * is escaped when it is one of `<`, `&`, `[` and not already literal (an odd
 * run of backslashes before it) — a backslash before ASCII punctuation is
 * literal in both grammars — which keeps the visible text and breaks every
 * one of those constructs; on the RIGHT, a label that is only a list number
 * or letter followed by `.`/`)`, an `&` the following text completes into a
 * character reference, or an empty label at a line's content start followed
 * by a block opener, gets the same treatment. And the pass repeats on its own
 * output until a parse finds nothing refused, in case a construct was missed;
 * each round removes at least one link's syntax and writes none. Should that
 * still not settle, the export fails closed rather than ship the
 * intermediate string.
 */
export function stripDisallowedMarkdownLinks(markdown: string): string {
  let out = markdown;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const next = stripOnce(out);
    if (next === out) return out;
    out = next;
  }
  throw new Error(
    `Export link policy did not settle after ${MAX_ROUNDS} passes; refusing to export`,
  );
}

const MAX_ROUNDS = 64;

/** Left neighbours that could fuse with a label into new syntax. */
const FUSING_LEFT_NEIGHBOURS = new Set(["&", "<", "["]);

/** A label that is nothing but what precedes `.`/`)` in an ordered, fancy or
 *  example list marker (`1`, `a`, `iv`, `#`) — with the right neighbour it
 *  would become one. */
const LIST_MARKER_LABEL = /^(?:\d{1,9}|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+|#)$/;

/** `&` inside the label plus the source right after it spelling out a named
 *  or numeric character reference. */
const ENTITY_ACROSS_BOUNDARY =
  /^&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z][A-Za-z\d]{1,31});/;

/** Everything that may stand between a line start and a block's content:
 *  indentation, block-quote and list markers. */
const CONTENT_START_PREFIX =
  /^(?:[ \t]+|>[ \t]?|[-+*][ \t]+|\d{1,9}[.)][ \t]+)*$/;

/** What an EMPTY label leaves exposed at a content start: the text that
 *  followed the link now opens the line, and these open a block. */
const BLOCK_OPENER =
  /^(?:[-+*](?=[ \t])|#{1,6}(?=[ \t]|$)|>|\d{1,9}[.)](?=[ \t])|`{3}|~{3}|-{3}|\*{3}|_{3}|\|(?=[ \t])|:(?=[ \t])|\[[^\]\n]+\]:[ \t])/;

function stripOnce(markdown: string): string {
  const root = parseMdast(markdown);

  // Pass 1: which reference identifiers resolve to a refused destination.
  // (References usually precede their definitions, so this cannot share a
  // walk with the edit collection below.)
  const refusedIdentifiers = new Set<string>();
  visit(root, "definition", (node) => {
    if (!isAllowedLinkHref(node.url)) refusedIdentifiers.add(node.identifier);
  });

  // Pass 2: the links to rewrite, as edits against source offsets. A walk of
  // our own rather than `visit`: whether a label sits inside a table cell or
  // a heading is a question about its ancestry, and only the walk knows that.
  const edits: SourceEdit[] = [];
  collectEdits(
    root,
    { inHeading: false, inTableCell: false },
    refusedIdentifiers,
    edits,
  );
  if (edits.length === 0) return markdown;

  // Apply from the end so earlier offsets stay valid. Links cannot nest, so
  // edits never overlap; the guard only documents that assumption. The left
  // neighbour is still original text at this point (everything to the right
  // has been replaced already), so it can be read and, if it could fuse with
  // the label, escaped as part of the edit.
  edits.sort((a, b) => b.start - a.start);
  let out = markdown;
  let appliedFrom = Number.POSITIVE_INFINITY;
  for (const edit of edits) {
    if (edit.end > appliedFrom) continue;
    let { end, start, text } = edit;
    const left = start > 0 ? out[start - 1] : "";
    if (FUSING_LEFT_NEIGHBOURS.has(left) && !isEscaped(out, start - 1)) {
      start -= 1;
      text = `\\${left}${text}`;
    }
    // The right side can complete syntax the label began: `1` + `. item` is
    // an ordered list item, `&` + `amp;` a character reference. And an EMPTY
    // label at a line's content start hands the line to whatever followed
    // the link — `- item`, `# heading`, `---`, `[r]: url` — so that opener is
    // escaped (its first character, or the `.`/`)` after a list number).
    const suffix = out.slice(end, end + 40);
    const prefix = out.slice(out.lastIndexOf("\n", start - 1) + 1, start);
    if (
      text === "" &&
      CONTENT_START_PREFIX.test(prefix) &&
      BLOCK_OPENER.test(suffix)
    ) {
      const digits = /^\d{1,9}/.exec(suffix)?.[0] ?? "";
      text = `${digits}\\${suffix[digits.length]}`;
      end += digits.length + 1;
    } else if (LIST_MARKER_LABEL.test(text) && /^[.)](?:\s|$)/.test(suffix)) {
      text += `\\${suffix[0]}`;
      end += 1;
    }
    const amp = text.lastIndexOf("&");
    if (
      amp !== -1 &&
      !isEscaped(text, amp) &&
      ENTITY_ACROSS_BOUNDARY.test(text.slice(amp) + suffix)
    ) {
      text = `${text.slice(0, amp)}\\&${text.slice(amp + 1)}`;
    }
    out = out.slice(0, start) + text + out.slice(end);
    appliedFrom = start;
  }
  return out;
}

/** Is the character at `index` already literal — preceded by an odd run of
 *  backslashes? (An even run is escaped backslashes; the character is live.) */
function isEscaped(source: string, index: number): boolean {
  let run = 0;
  for (let i = index - 1; i >= 0 && source[i] === "\\"; i--) run++;
  return run % 2 === 1;
}

/** What the enclosing blocks demand of a label written back into them. */
interface LabelContext {
  inHeading: boolean;
  inTableCell: boolean;
}

function collectEdits(
  node: Nodes,
  ctx: LabelContext,
  refused: ReadonlySet<string>,
  edits: SourceEdit[],
): void {
  if (node.type === "link" && !isAllowedLinkHref(node.url)) {
    edits.push(labelEdit(node, ctx));
    return;
  }
  if (node.type === "linkReference" && refused.has(node.identifier)) {
    edits.push(labelEdit(node, ctx));
    return;
  }
  if (!("children" in node)) return;
  const inner: LabelContext = {
    inHeading: ctx.inHeading || node.type === "heading",
    inTableCell: ctx.inTableCell || node.type === "tableCell",
  };
  for (const child of node.children) collectEdits(child, inner, refused, edits);
}

function labelEdit(node: Link | LinkReference, ctx: LabelContext): SourceEdit {
  // The parser always attaches positions; the non-null assertions state that
  // rather than inventing a fallback that would silently skip a refused link.
  const { end, start } = node.position!;
  let text = serializeLabel(node.children)
    // pandoc's markdown reader, not remark's, starts a definition-list body
    // at `:`, an example list at `(@x)` and a fancy list at `(a)`, `a.` or
    // `iv)` (`1.`, `~` and `|` remark already escapes). A backslash before
    // the marker's punctuation is invisible in both grammars.
    .replace(/^[(:]/, "\\$&")
    .replace(/^([A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)([.)])(?=\s)/, "$1\\$2");
  if (ctx.inHeading) {
    // At the end of an ATX heading a trailing `#` run is the closing sequence
    // and a trailing `{…}` is pandoc's attribute block; both vanish from the
    // visible text.
    text = text
      .replace(/(#+)\s*$/, "\\$1")
      .replace(/\{([^{}]*)\}\s*$/, "\\{$1}");
  }
  if (ctx.inTableCell) {
    // A GFM cell ends at the next pipe that is not escaped by an odd run of
    // backslashes. Text and code came out of the cell with their pipes
    // decoded; math kept its `\|`, so only an even run gets one more.
    text = text.replace(/(\\*)\|/g, (match, run: string) =>
      run.length % 2 === 0 ? `${run}\\|` : match,
    );
  }
  return { end: end.offset!, start: start.offset!, text };
}

/** The label as context-safe markdown on one line: block starters escaped,
 *  marks kept, line breaks turned into the space they rendered as. */
function serializeLabel(children: PhrasingContent[]): string {
  if (children.length === 0) return "";
  const root: Root = {
    children: [{ children: singleLine(children), type: "paragraph" }],
    type: "root",
  };
  return labelSerializer.stringify(root).replace(/\n$/, "");
}

/** Soft breaks live inside text, math and raw-HTML values, hard breaks are
 *  `break` nodes; all of them render as a space, so all become one. */
function singleLine(nodes: PhrasingContent[]): PhrasingContent[] {
  return nodes.map((node): PhrasingContent => {
    if (node.type === "break") return { type: "text", value: " " };
    if (
      node.type === "text" ||
      node.type === "inlineMath" ||
      node.type === "html"
    ) {
      return { ...node, value: node.value.replace(/\r?\n/g, " ") };
    }
    if ("children" in node) {
      return { ...node, children: singleLine(node.children) };
    }
    return node;
  });
}

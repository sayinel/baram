// issue 527 / issue 545 — the splice machinery the markdown export's final
// passes share: how a refused construct (a link, an image) is written back
// into its source as plain text without becoming new syntax there.
//
// Two passes run on the string that leaves the app — export-markdown-links.ts
// for links, export-markdown-images.ts for images — and both face the same
// problem once they have decided what to refuse: the replacement is spliced
// into markdown SOURCE, where a label such as `# heading` at a line start is a
// heading, a pipe inside a GFM cell ends the cell, and a neighbour can fuse
// with the new text into an autolink or a character reference. The label is
// therefore re-serialized with remark-stringify (configured like the
// pipeline's serializer, which itself sits inside the pm-to-md closure that
// production code outside the pipeline may not import) rather than spliced
// from the source, and the edits are applied with the guards below. See
// export-markdown-links.ts for the full account of each guard.
import type { PhrasingContent, Root } from "mdast";

import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

export interface SourceEdit {
  end: number;
  /**
   * The construct sat inside a link's label. A `[` to its left there is the
   * link's own bracket (or literal text no link can grow from, links not
   * nesting), so it is left alone — escaping it would break the link, and
   * take the link away from the link pass that judges destinations last.
   */
  inLink?: boolean;
  start: number;
  text: string;
}

/** What the enclosing blocks demand of a label written back into them. */
export interface LabelContext {
  inHeading: boolean;
  inLink: boolean;
  inTableCell: boolean;
}

/** Rounds a pass may repeat on its own output before it fails closed. */
export const MAX_ROUNDS = 64;

/** Label serializer: the pipeline serializer's inline conventions (`**`, `*`)
 *  with the same gfm/math grammar parseMdast produced the nodes with. */
const labelSerializer = unified()
  .use(remarkStringify, {
    emphasis: "*",
    strong: "*",
    // A label's `]` is escaped along with its `[`: the link pass runs after
    // the image pass, and a label it splices back could otherwise close an
    // `![z` standing to its left — `![z` + `b]` + `(/etc/passwd)` is an
    // image the image pass never saw. Code spans keep theirs; a `]` inside
    // backticks closes nothing.
    unsafe: [{ character: "]", inConstruct: "phrasing" }],
  })
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath);

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

/**
 * Apply `edits` to `markdown`, from the end so earlier offsets stay valid, with
 * the neighbour guards: a fusing left neighbour (`<`, `&`, `[`) is escaped
 * with the edit; a label that a right neighbour would complete into a list
 * marker or a character reference gets the completing character escaped, and
 * one ending in `!` before a `[` gets the `!` escaped; an EMPTY label at a
 * line's content start escapes the block opener that would otherwise take
 * the line. Edits never overlap (links and images cannot
 * nest); the guard only documents that assumption.
 */
export function applyEdits(markdown: string, edits: SourceEdit[]): string {
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
    if (
      FUSING_LEFT_NEIGHBOURS.has(left) &&
      !(edit.inLink && left === "[") &&
      !isEscaped(out, start - 1)
    ) {
      start -= 1;
      text = `\\${left}${text}`;
    } else if (edit.inLink && left === "[" && text.startsWith("^")) {
      // The link's own bracket stays live — and `[` + `^1` is a footnote
      // reference once a definition exists, so the `^` is escaped instead.
      text = `\\${text}`;
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
    // `x!` + `[z](/etc/passwd)` is an image of that file — a link the pass
    // judged, turned into something it does not judge. The serializer escapes
    // a `!` before a `[` inside the label; this is the same `!` at its edge.
    if (
      text.endsWith("!") &&
      !isEscaped(text, text.length - 1) &&
      suffix.startsWith("[")
    ) {
      text = `${text.slice(0, -1)}\\!`;
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

/** The context of `node`'s children, given the context `node` sits in. */
export function innerContext(
  ctx: LabelContext,
  nodeType: string,
): LabelContext {
  return {
    inHeading: ctx.inHeading || nodeType === "heading",
    inLink: ctx.inLink || nodeType === "link" || nodeType === "linkReference",
    inTableCell: ctx.inTableCell || nodeType === "tableCell",
  };
}

/**
 * The replacement text for a refused construct: its label, serialized on one
 * line with block starters escaped, then escaped for what the enclosing
 * blocks demand (pandoc's list and definition markers, a heading's closing
 * sequence or attribute block, a table cell's pipes).
 */
export function labelText(
  children: PhrasingContent[],
  ctx: LabelContext,
): string {
  let text = serializeLabel(children)
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
  return text;
}

/** Inline nodes as markdown on one line, through the pipeline's conventions
 *  (an image keeps the escapes its alt and title need). */
export function serializeInline(children: PhrasingContent[]): string {
  return serializeLabel(children);
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

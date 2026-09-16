// issue 631 — the document-order walk the image policy runs.
//
// Every markdown image, reference-style image and html node, in the order
// pandoc reads them, with one piece of state carried along: the raw region
// an earlier node opened and did not close. The parser splits a
// `<script>…<img>…</script>` inside a paragraph into three html nodes, a
// comment holding a blank line into html blocks on either side of what
// stands in it, and a raw TeX environment into text and the html nodes
// between its lines, while pandoc reads each as one raw region; an html node
// inside such a region is not a tag, and is not offered to the visitor. An
// opener whose closer never comes opens nothing: pandoc (3.11) reads a
// `\\begin{}` without its `\\end{}` as text and a `<script>` or `<!--` without
// its closer as the tag alone, and shows the images after them — a region
// carried to the end of the document would swallow those images without a
// word. Such a node is left whole and, when it may hold an image, reported.
// The region's state moves on the EXACT SOURCE of each node, in document
// order — never on the parser's decoded text: `&lt;/script>` decodes to a
// closer that pandoc, reading the source, never sees, and `\<script>` to an
// opener it never sees. A closer may stand where the parser keeps no text
// node — a link's destination or title, a reference label, a definition, an
// image's alt — so those source spans move the state too, and what follows
// a closer in them may open the next region. A node that BEGAN inside a
// region is raw text to pandoc up to the closer, whatever the parser made
// of it — an image whose alt held the closer, a tag the parser saw inside
// braces, a code span or a formula: the state moves over its source, what
// follows the closer may open the next region, and the visitor never sees
// it.
//
// An html node is offered as its `<img …>` tags only when the grammar can
// read the node (export-html-fragment.ts) and its text can be aligned with
// the source (export-html-node-offsets.ts); otherwise the node is left whole
// and, when it may hold an image, reported as unread. So is an inline tag
// that stands inside braces an earlier sibling left open — `\texttt{<img>}`
// is one raw TeX inline to pandoc and `[x]{title="<img>"}` a span whose
// attribute holds the tag; neither shows an image, and a file staged for
// one could fail the export for nothing. Both passes of the policy
// (export-markdown-images.ts) walk this way; what to do with what is found
// is theirs.
import type { Html, Image, ImageReference, Nodes } from "mdast";

import {
  mayHoldImage,
  readHtmlFragment,
  type TagSpan,
} from "./export-html-fragment";
import { valueToSource } from "./export-html-node-offsets";
import {
  type ExportImageTag,
  readExportImageTag,
} from "./export-img-attributes";
import { innerContext, type LabelContext } from "./export-markdown-splice";
import {
  closerIndex,
  type CloserOracle,
  rawRegions,
} from "./export-raw-regions";

/** One `<img …>` tag of an html node: where it stands in the source and
 *  what it says. */
export interface HtmlImage {
  at: TagSpan;
  tag: ExportImageTag;
}

/** What the walk offers, in document order. */
export interface ImageWalkVisitor {
  /** An `<img …>` tag of an html node the walk could read. */
  htmlImage: (image: HtmlImage, ctx: LabelContext) => void;
  /** A markdown image. */
  image?: (node: Image, ctx: LabelContext) => void;
  /** A reference-style image. */
  imageReference?: (node: ImageReference, ctx: LabelContext) => void;
  /** An html node the walk did not read and that may hold an image. */
  unread: (node: Html) => void;
}

/** The region an earlier node opened and has not closed: the closer still
 *  to come, or null. */
interface RawRegion {
  until: null | RegExp;
}

/** The document's answers about closers for the text that starts at byte
 *  `start` of the source and ends at `end` — `rawRegions` asks them before
 *  it searches the text, and to decide whether an opener is real. */
type OracleFor = (start: number, end: number) => CloserOracle;

/** Walk `root` (parsed from `source`) in document order, offering what it
 *  finds to `visitor`. `source` is what the offsets of an `HtmlImage` index. */
export function walkImages(
  root: Nodes,
  source: string,
  visitor: ImageWalkVisitor,
): void {
  const raw: RawRegion = { until: null };
  // Every closer in the document, indexed once: whether an opener's closer
  // comes after a position is then a lookup. A note that names
  // `\begin{itemize}` — or a thousand different environments — in a
  // thousand paragraphs without closing them would otherwise scan to the
  // end of the document a thousand times.
  const closers = closerIndex(source);
  const closerAtOrAfter = (key: string, from: number): boolean => {
    const positions = closers.get(key);
    if (positions === undefined) return false;
    // Positions are in document order: the first one at or after `from`.
    let low = 0;
    let high = positions.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (positions[mid] < from) low = mid + 1;
      else high = mid;
    }
    return low < positions.length;
  };
  // The node's source start is the one sound lower bound for every opener
  // in it. An offset into the node's text is NOT: micromark expands a tab
  // that ends a container prefix into spaces, so the text can be longer
  // than its source span (two columns per such line), and `start + offset`
  // would ask past the real closer once the drift outgrew the distance to
  // it — and take a real `<script>` for a false opener.
  const oracleFor: OracleFor = (start, end) => ({
    afterNode: (key) => closerAtOrAfter(key, end),
    anyFrom: (key) => closerAtOrAfter(key, start),
  });
  // Move the region's state over `source[from, to)`: the open region may
  // close there; what follows the closer — or the whole span, when nothing
  // was open — may open the next one, unless the span is code, which opens
  // nothing to pandoc either.
  const advance = (from: number, to: number, mayOpen: boolean): void => {
    const span = source.slice(from, to);
    const rest = raw.until === null ? span : closeRawRegion(raw, span);
    if (rest === null || !mayOpen) return;
    raw.until = rawRegions(rest, oracleFor(from, to)).open?.until ?? null;
  };
  const visit = (node: Nodes, ctx: LabelContext, inBraces: boolean): void => {
    const start = node.position!.start.offset!;
    const end = node.position!.end.offset!;
    if (node.type === "image" || node.type === "imageReference") {
      // Begun inside a region, the image is text to pandoc up to the closer
      // and literal characters after it — no image at all.
      const beganRaw = raw.until !== null;
      advance(start, end, true);
      if (beganRaw) return;
      if (node.type === "image") visitor.image?.(node, ctx);
      else visitor.imageReference?.(node, ctx);
      return;
    }
    if (node.type === "definition") {
      advance(start, end, true);
      return;
    }
    if (node.type === "html") {
      // Begun inside a region, the node is raw text to pandoc whatever
      // braces the parser saw around it: readHtmlNode moves the state over
      // it (the closer may stand in it) and offers nothing. Only a tag
      // entered OUTSIDE a region is judged by the braces.
      if (inBraces && raw.until === null) {
        // Judged by the same oracle as any other node: a false opener in a
        // processing instruction must not mask the `<img` behind it.
        const regions = rawRegions(
          node.value,
          oracleFor(node.position!.start.offset!, node.position!.end.offset!),
        );
        if (mayHoldImage(node.value, regions)) visitor.unread(node);
        return;
      }
      const found = readHtmlNode(node, source, raw, oracleFor);
      if (found === null) visitor.unread(node);
      else for (const image of found) visitor.htmlImage(image, ctx);
      return;
    }
    if ("value" in node) {
      // A text node's source may close the region and open the next. Code
      // entered outside a region is code to pandoc too, so it only closes —
      // but a code span or a formula that BEGAN inside a region is raw text
      // to pandoc, and what follows its closer may open the next region.
      const beganRaw = raw.until !== null;
      advance(start, end, node.type === "text" || beganRaw);
      return;
    }
    if (!("children" in node)) return;
    const inner = innerContext(ctx, node.type);
    // Braces open and close across the siblings of one parent: text on
    // either side of an inline tag, or of the emphasis around it.
    let depth = 0;
    for (const child of node.children) {
      visit(child, inner, inBraces || depth > 0);
      if (child.type === "text") depth = braceDepth(child.value, depth);
    }
    // The destination and title, or the reference label, follow the label
    // in the source; the label's own nodes moved the state as they were
    // visited.
    if (node.type === "link" || node.type === "linkReference") {
      advance(node.children.at(-1)?.position?.end.offset ?? start, end, true);
    }
  };
  visit(root, { inHeading: false, inLink: false, inTableCell: false }, false);
}

/** `depth` after `text`: one deeper per `{`, one shallower per `}`, never
 *  below zero — a stray closer opens nothing. */
function braceDepth(text: string, depth: number): number {
  let d = depth;
  for (const ch of text) {
    if (ch === "{") d += 1;
    else if (ch === "}" && d > 0) d -= 1;
  }
  return d;
}

/**
 * The `<img …>` tags of an html node, or null when the node is not the
 * walk's to read and may hold an image. A node outside the supported
 * grammar or one whose text cannot be aligned with the source is left
 * whole: its tags stay raw and the filter drops them. A node that cannot
 * hold an image at all, or that stands inside a raw region an earlier node
 * opened, is simply nothing to offer: inside a comment, a script or a TeX
 * environment a tag is text to pandoc, not an image that could go missing.
 */
function readHtmlNode(
  node: Html,
  source: string,
  raw: RawRegion,
  oracleFor: OracleFor,
): HtmlImage[] | null {
  const start = node.position!.start.offset!;
  const end = node.position!.end.offset!;
  if (raw.until !== null) {
    // Inside the region. What follows the closer, if it stands in this
    // node, is not read either — pandoc ends its block on that line — but
    // may open the next region, and if it may hold an image the user hears
    // of it. The exact source, as everywhere the state moves: a container
    // prefix the parser stripped from the value is text pandoc read.
    const rest = closeRawRegion(raw, source.slice(start, end));
    if (rest === null) return [];
    const regions = rawRegions(rest, oracleFor(start, end));
    raw.until = regions.open?.until ?? null;
    return mayHoldImage(rest, regions) ? null : [];
  }
  const spans = readHtmlFragment(node.value);
  if (spans === null) {
    const regions = rawRegions(node.value, oracleFor(start, end));
    raw.until = regions.open?.until ?? null;
    return mayHoldImage(node.value, regions) ? null : [];
  }
  if (spans.length === 0) return [];
  const map = valueToSource(node.value, source, node.position!.start.offset!);
  if (map === null) return null;
  return spans.map((span) => ({
    at: { end: map(span.end), start: map(span.start) },
    tag: readExportImageTag(node.value.slice(span.start, span.end)),
  }));
}

/**
 * Let any node's text close the region the walk is inside; what follows the
 * closer is returned for the caller to read on, or null when the region
 * stays open (or there was none to close).
 */
function closeRawRegion(raw: RawRegion, value: string): null | string {
  if (raw.until === null) return null;
  const closer = raw.until.exec(value);
  if (closer === null) return null;
  raw.until = null;
  return value.slice(closer.index + closer[0].length);
}

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
  rawOpenedBy,
  readHtmlFragment,
  type TagSpan,
} from "./export-html-fragment";
import { valueToSource } from "./export-html-node-offsets";
import {
  type ExportImageTag,
  readExportImageTag,
} from "./export-img-attributes";
import { innerContext, type LabelContext } from "./export-markdown-splice";

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

/** Does `until` — the closer of a region a node opens — come after byte
 *  `from` of the source? Only then is the opener real to pandoc. */
type Opens = (until: RegExp, from: number) => boolean;

/** Walk `root` (parsed from `source`) in document order, offering what it
 *  finds to `visitor`. `source` is what the offsets of an `HtmlImage` index. */
export function walkImages(
  root: Nodes,
  source: string,
  visitor: ImageWalkVisitor,
): void {
  const raw: RawRegion = { until: null };
  const opens: Opens = (until, from) => {
    const flags = until.flags.includes("g") ? until.flags : `${until.flags}g`;
    const later = new RegExp(until.source, flags);
    later.lastIndex = from;
    return later.test(source);
  };
  const visit = (node: Nodes, ctx: LabelContext, inBraces: boolean): void => {
    if (node.type === "image") {
      visitor.image?.(node, ctx);
      return;
    }
    if (node.type === "imageReference") {
      visitor.imageReference?.(node, ctx);
      return;
    }
    if (node.type === "html") {
      if (inBraces) {
        if (mayHoldImage(node.value)) visitor.unread(node);
        return;
      }
      const found = readHtmlNode(node, source, raw, opens);
      if (found === null) visitor.unread(node);
      else for (const image of found) visitor.htmlImage(image, ctx);
      return;
    }
    if ("value" in node) {
      trackRawRegion(raw, node, opens);
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
  opens: Opens,
): HtmlImage[] | null {
  const after = (until: RegExp): boolean =>
    opens(until, node.position!.end.offset!);
  if (raw.until !== null) {
    // Inside the region. What follows the closer, if it stands in this
    // node, is not read either — pandoc ends its block on that line — but
    // may open the next region, and if it may hold an image the user hears
    // of it.
    const rest = closeRawRegion(raw, node.value);
    if (rest === null) return [];
    raw.until = openedRegion(rest, after);
    return mayHoldImage(rest, after) ? null : [];
  }
  const spans = readHtmlFragment(node.value);
  if (spans === null) {
    raw.until = openedRegion(node.value, after);
    return mayHoldImage(node.value, after) ? null : [];
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

/** The region `text` opens, when its closer comes later in the document. */
function openedRegion(
  text: string,
  opens: (until: RegExp) => boolean,
): null | RegExp {
  const until = rawOpenedBy(text);
  return until !== null && opens(until) ? until : null;
}

/**
 * A value node's part in the raw region: it may close the one the walk is
 * inside, and a text node may open one — pandoc's raw TeX environment
 * (`\begin{verbatim}` … `\end{verbatim}`) is text to the parser and spans
 * any html node between its lines. Code is code to pandoc too, so a code
 * node opens nothing.
 */
function trackRawRegion(
  raw: RawRegion,
  node: Nodes & { value: string },
  opens: Opens,
): void {
  const rest =
    raw.until === null ? node.value : closeRawRegion(raw, node.value);
  if (rest !== null && node.type === "text") {
    raw.until = openedRegion(rest, (until) =>
      opens(until, node.position!.end.offset!),
    );
  }
}

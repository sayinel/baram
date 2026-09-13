// issue 631 — the document-order walk the image policy runs.
//
// Every markdown image, reference-style image and html node, in the order
// pandoc reads them, with one piece of state carried along: the raw region
// an earlier node opened and did not close. The parser splits a
// `<script>…<img>…</script>` inside a paragraph into three html nodes, a
// comment holding a blank line into html blocks on either side of what
// stands in it, and a raw TeX environment into text and the html nodes
// between its lines, while pandoc reads each as one raw region; an html node
// inside such a region is not a tag, and is not offered to the visitor.
//
// An html node is offered as its `<img …>` tags only when the grammar can
// read the node (export-html-fragment.ts) and its text can be aligned with
// the source (export-html-node-offsets.ts); otherwise the node is left whole
// and, when it may hold an image, reported as unread. Both passes of the
// policy (export-markdown-images.ts) walk this way; what to do with what is
// found is theirs.
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

/** Walk `root` (parsed from `source`) in document order, offering what it
 *  finds to `visitor`. `source` is what the offsets of an `HtmlImage` index. */
export function walkImages(
  root: Nodes,
  source: string,
  visitor: ImageWalkVisitor,
): void {
  const raw: RawRegion = { until: null };
  const visit = (node: Nodes, ctx: LabelContext): void => {
    if (node.type === "image") {
      visitor.image?.(node, ctx);
      return;
    }
    if (node.type === "imageReference") {
      visitor.imageReference?.(node, ctx);
      return;
    }
    if (node.type === "html") {
      const found = readHtmlNode(node, source, raw);
      if (found === null) visitor.unread(node);
      else for (const image of found) visitor.htmlImage(image, ctx);
      return;
    }
    if ("value" in node) {
      trackRawRegion(raw, node);
      return;
    }
    if (!("children" in node)) return;
    const inner = innerContext(ctx, node.type);
    for (const child of node.children) visit(child, inner);
  };
  visit(root, { inHeading: false, inLink: false, inTableCell: false });
}

/**
 * The `<img …>` tags of an html node, or null when the node is not the
 * walk's to read and may hold an image. A node outside the supported
 * grammar or one whose text cannot be aligned with the source is left
 * whole: its tags stay raw and the filter drops them. A node that cannot
 * hold an image at all, or that stands inside a raw region an earlier node
 * opened, is simply nothing to offer.
 */
function readHtmlNode(
  node: Html,
  source: string,
  raw: RawRegion,
): HtmlImage[] | null {
  if (raw.until !== null) {
    // Inside the region: not a tag to pandoc. What follows the closer, if
    // it stands in this node, is left unread as well (conservative) but may
    // open the next region.
    const rest = closeRawRegion(raw, node.value);
    if (rest !== null) raw.until = rawOpenedBy(rest);
    return [];
  }
  const spans = readHtmlFragment(node.value);
  if (spans === null) {
    raw.until = rawOpenedBy(node.value);
    return mayHoldImage(node.value) ? null : [];
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

/**
 * A value node's part in the raw region: it may close the one the walk is
 * inside, and a text node may open one — pandoc's raw TeX environment
 * (`\begin{verbatim}` … `\end{verbatim}`) is text to the parser and spans
 * any html node between its lines. Code is code to pandoc too, so a code
 * node opens nothing.
 */
function trackRawRegion(raw: RawRegion, node: Nodes & { value: string }): void {
  const rest =
    raw.until === null ? node.value : closeRawRegion(raw, node.value);
  if (rest !== null && node.type === "text") raw.until = rawOpenedBy(rest);
}

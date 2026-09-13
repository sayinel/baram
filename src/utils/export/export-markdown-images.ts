// issue 545 — the Pandoc export's last word on every image.
//
// pandoc treats an image as a FILE, not a link: for docx and epub it opens the
// destination and embeds the bytes, for `http(s):` it downloads them. The
// route used to hand the document's markdown over verbatim, so a note that
// said `![](/Users/me/.ssh/id_rsa)` — a shared file, a cloned repository —
// made the export read that file into the output, and a remote image made a
// network request at export time. Nothing checked the destination, and pandoc
// ran without `--sandbox`.
//
// This pass walks the document and gives every image its verdict
// (export-image-source-policy.ts: kept, staged as an asset request the
// backend resolves inside the document's context, or refused), then writes
// the edits (export-image-edits.ts): a staged image points at its
// `baram-asset:image-N.ext` placeholder, a refused one becomes its alt text,
// and the user is told how many were refused. It runs until nothing changes
// (a later round reads its own placeholders back and keeps them), after every
// converter and the mermaid rewrite, and BEFORE the link pass
// (export-markdown-links.ts), so that pass stays the final gate for links and
// re-parses whatever this one wrote. Nothing re-parses what the LINK pass
// writes, so its splice must not be able to complete an image: the shared
// serializer escapes a label's `]` and a `!` at its edge before a `[`. A
// reference-style image (`![alt][ref]`) whose definition is anything but a
// kept asset becomes its alt text rather than a staged request: the editor
// resolves references when it loads a document, so one reaches this pass only
// from strings built by other means, and a definition is also what its links
// use.
//
// An `<img …>` tag in raw HTML is an image to pandoc too (issue 631): the
// editor writes one for a resized image, a note pasted from elsewhere may
// hold any spelling. Such a tag is judged like a markdown image — its
// source as HTML reads it (export-img-attributes.ts) — and written back as
// one, only when its html node is one this pass can read at all: nothing but
// tags, comments and caption text (export-html-fragment.ts, a positive
// grammar). Any other node — a fence, code, math or an indented line beside
// the tag, a shape pandoc and HTML read differently — is left whole, and the
// user is told that block could not be read, apart from the count of images
// refused.
//
// Not covered here — judged one layer later, on pandoc's own parse, by the
// Lua policy filter `src-tauri/src/export/pandoc.rs` writes for each export
// (issues 545 and 544): raw HTML of any kind, including an `<img src>` in a
// node this pass did not read, is dropped there; an epub `cover-image` in
// YAML metadata is removed from the metadata; every Image the writers would
// embed is held to the staged-asset allowlist. Raw TeX `\includegraphics` is
// dropped with the rest of raw TeX. A document with nothing to change comes
// back as the very same string.
import type { PandocImageRequest } from "../../ipc/types";
import type { Html, Nodes } from "mdast";

import { visit } from "unist-util-visit";

import { parseMdast } from "../../pipeline/parse-mdast";
import { decodePercent } from "../path-utils";
import {
  mayHoldImage,
  rawOpenedBy,
  readHtmlFragment,
  type TagSpan,
} from "./export-html-fragment";
import { valueToSource } from "./export-html-node-offsets";
import {
  altEdit,
  altEditAt,
  assetEdit,
  imageEditAt,
} from "./export-image-edits";
import {
  ASSET_SCHEME,
  classifyImageSource,
  type RelativeScope,
  relativeScope,
} from "./export-image-source-policy";
import {
  editorImageMetadata,
  type LooseImg,
  readImgTag,
} from "./export-img-attributes";
import {
  applyEdits,
  innerContext,
  type LabelContext,
  MAX_ROUNDS,
  type SourceEdit,
} from "./export-markdown-splice";

export interface ImagePolicyOptions {
  /**
   * The root of the vault or folder context the document's tab belongs to, or
   * null for a document opened on its own (or no context at all).
   */
  contextRoot: null | string;
  /** The document's absolute path, or null when it has never been saved. */
  documentPath: null | string;
  /**
   * The `baram-asset:` names this export produced (the rasterized diagrams).
   * Only these are kept: a document-written `![](baram-asset:x)` would reach
   * pandoc as a bare name it looks up in its working directory.
   */
  knownAssets: ReadonlySet<string>;
}

export interface ImagePolicyResult {
  /** The images to stage, in document order; the backend reads them. */
  images: PandocImageRequest[];
  markdown: string;
  /** How many images became their alt text — what the user should hear about. */
  refused: number;
  /** Whether the document had a context to be relative to at all. */
  scoped: boolean;
  /**
   * How many html nodes this pass could not read and that may hold an image
   * (export-html-fragment.ts): left whole, their raw tags dropped by the
   * filter. An estimate of blocks, never a count of images.
   */
  unsupportedHtml: number;
}

/** An extension worth keeping on a staged image's name — pandoc picks the media type from it. */
const EXTENSION = /\.([A-Za-z0-9]{1,8})$/;

/** What one pass counts for the user, shared across rounds. */
interface Counters {
  refused: number;
  unsupportedHtml: number;
}

/**
 * A comment or verbatim element an earlier node opened and has not closed,
 * carried in document order. The parser splits `<script>…<img>…</script>`
 * inside a paragraph into three html nodes, and a comment holding a blank
 * line into html blocks on either side of what stands in it; pandoc reads
 * each as one raw region, so an html node inside it is not a tag. `until`
 * is the closer still to come, or null.
 */
interface RawRegion {
  until: null | RegExp;
}

/**
 * Stage the images pandoc may read and reduce every other image to its alt
 * text. Returns the input string itself when there is nothing to change.
 */
export function stageMarkdownImages(
  markdown: string,
  { contextRoot, documentPath, knownAssets }: ImagePolicyOptions,
): ImagePolicyResult {
  const scope = relativeScope(documentPath, contextRoot);
  const images: PandocImageRequest[] = [];
  // The names this pass stages join the known ones only between rounds: a
  // later round reads its own `baram-asset:image-N` back and must keep it,
  // but within a round a document-written placeholder wearing a name staged
  // earlier in the same walk is still the forgery it was.
  const known = new Set(knownAssets);
  const counters: Counters = { refused: 0, unsupportedHtml: 0 };
  let out = markdown;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const staged: string[] = [];
    const next = stageOnce(
      out,
      scope,
      known,
      images,
      staged,
      counters,
      round === 0,
    );
    for (const name of staged) known.add(name);
    if (next === out) {
      return {
        images,
        markdown: out,
        refused: counters.refused,
        scoped: scope !== null,
        unsupportedHtml: counters.unsupportedHtml,
      };
    }
    out = next;
  }
  throw new Error(
    `Export image policy did not settle after ${MAX_ROUNDS} passes; refusing to export`,
  );
}

/** What one pass carries while it walks the tree. */
interface Walk {
  counters: Counters;
  /** Only the first round counts a node it cannot read — it survives every
   *  round unchanged and would be counted again each time. */
  firstRound: boolean;
  images: PandocImageRequest[];
  knownAssets: ReadonlySet<string>;
  /** The raw region the walk is inside, if any (document order). */
  raw: RawRegion;
  refusedIdentifiers: ReadonlySet<string>;
  scope: null | RelativeScope;
  /** The markdown being walked — `<img>` tags are located in it by offset. */
  source: string;
  /** The names this walk staged — known from the next round on. */
  staged: string[];
}

function collectEdits(
  node: Nodes,
  ctx: LabelContext,
  walk: Walk,
  edits: SourceEdit[],
): void {
  if (node.type === "image") {
    const verdict = classifyImageSource(node.url, walk.scope, walk.knownAssets);
    if (verdict.kind === "refuse") {
      walk.counters.refused += 1;
      edits.push(altEdit(node, node.alt, ctx));
    }
    if (verdict.kind === "stage") {
      const name = stageRequest(walk, verdict.source);
      edits.push(assetEdit(node, `${ASSET_SCHEME}${name}`, ctx));
    }
    return;
  }
  if (node.type === "imageReference") {
    if (walk.refusedIdentifiers.has(node.identifier)) {
      walk.counters.refused += 1;
      edits.push(altEdit(node, node.alt, ctx));
    }
    return;
  }
  if (node.type === "html") {
    imgTagEdits(node, ctx, walk, edits);
    return;
  }
  if ("value" in node) {
    trackRawRegion(walk.raw, node);
    return;
  }
  if (!("children" in node)) return;
  const inner = innerContext(ctx, node.type);
  for (const child of node.children) collectEdits(child, inner, walk, edits);
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

/** Record a request for `source` and return the name its placeholder gets. */
function stageRequest(walk: Walk, source: string): string {
  const name = stagedName(walk.images.length, source);
  walk.images.push({ name, source });
  walk.staged.push(name);
  return name;
}

/** One `<img …>` tag of an html node: where it stands in the source and
 *  what it says. */
interface HtmlImage {
  at: TagSpan;
  loose: LooseImg;
  raw: string;
}

/**
 * The `<img …>` tags of an html node, or null when the node is not this
 * pass's to read and may hold an image — the caller counts that for the
 * user. A node outside the supported grammar (export-html-fragment.ts) or
 * one whose text cannot be aligned with the source is left whole: its tags
 * stay raw and the filter drops them. A node that cannot hold an image at
 * all, or that stands inside a raw region an earlier node opened, is simply
 * nothing to do.
 */
function htmlNodeImages(
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
  return spans.map((span) => {
    const raw = node.value.slice(span.start, span.end);
    return {
      at: { end: map(span.end), start: map(span.start) },
      loose: readImgTag(raw),
      raw,
    };
  });
}

/**
 * Edits for the `<img …>` tags in an html node: each source is judged like
 * any other image — staged, kept, or reduced to its alt text and counted — and
 * a tag with no usable source becomes its alt text and is counted too, since
 * the backend's filter would drop the raw tag with no word to the user.
 */
function imgTagEdits(
  node: Html,
  ctx: LabelContext,
  walk: Walk,
  edits: SourceEdit[],
): void {
  const found = htmlNodeImages(node, walk.source, walk.raw);
  if (found === null) {
    if (walk.firstRound) walk.counters.unsupportedHtml += 1;
    return;
  }
  for (const { at, loose, raw } of found) {
    if (loose.src === null) {
      walk.counters.refused += 1;
      edits.push(altEditAt(at, loose.alt, ctx));
      continue;
    }
    const verdict = classifyImageSource(
      loose.src,
      walk.scope,
      walk.knownAssets,
    );
    if (verdict.kind === "refuse") {
      walk.counters.refused += 1;
      edits.push(altEditAt(at, loose.alt, ctx));
      continue;
    }
    const url =
      verdict.kind === "keep"
        ? verdict.source
        : `${ASSET_SCHEME}${stageRequest(walk, verdict.source)}`;
    const attrs = { alt: loose.alt, ...editorImageMetadata(raw, loose) };
    edits.push(imageEditAt(at, attrs, url, ctx));
  }
}

/**
 * For the writers that embed nothing (latex, rst): every `<img …>` tag
 * becomes a markdown image with its source as HTML reads it — no staging, no
 * verdict, exactly as every other image reference passes through to those
 * writers — and a tag with no usable source becomes its alt text. Without
 * this, the raw tag reaches the backend, the policy filter drops it (raw
 * HTML is never written into any output), and the image silently vanishes
 * from a `.tex`. Returns the input itself when there is nothing to change.
 */
export function rewriteImageTagsAsMarkdown(markdown: string): {
  markdown: string;
  refused: number;
  unsupportedHtml: number;
} {
  const edits: SourceEdit[] = [];
  const counters: Counters = { refused: 0, unsupportedHtml: 0 };
  const raw: RawRegion = { until: null };
  const collect = (node: Nodes, ctx: LabelContext): void => {
    if (node.type === "html") {
      const found = htmlNodeImages(node, markdown, raw);
      if (found === null) {
        counters.unsupportedHtml += 1;
        return;
      }
      for (const { at, loose, raw } of found) {
        if (loose.src === null) {
          counters.refused += 1;
          edits.push(altEditAt(at, loose.alt, ctx));
          continue;
        }
        edits.push(
          imageEditAt(
            at,
            { alt: loose.alt, ...editorImageMetadata(raw, loose) },
            loose.src,
            ctx,
          ),
        );
      }
      return;
    }
    if ("value" in node) {
      trackRawRegion(raw, node);
      return;
    }
    if (!("children" in node)) return;
    const inner = innerContext(ctx, node.type);
    for (const child of node.children) collect(child, inner);
  };
  collect(parseMdast(markdown), {
    inHeading: false,
    inLink: false,
    inTableCell: false,
  });
  return {
    markdown: edits.length === 0 ? markdown : applyEdits(markdown, edits),
    ...counters,
  };
}

function stageOnce(
  markdown: string,
  scope: null | RelativeScope,
  knownAssets: ReadonlySet<string>,
  images: PandocImageRequest[],
  staged: string[],
  counters: Counters,
  firstRound: boolean,
): string {
  const root = parseMdast(markdown);

  // Reference images resolve through definitions; one that is anything but a
  // kept asset makes every image reference of that identifier alt text.
  const refusedIdentifiers = new Set<string>();
  visit(root, "definition", (node) => {
    if (classifyImageSource(node.url, scope, knownAssets).kind !== "keep") {
      refusedIdentifiers.add(node.identifier);
    }
  });

  const edits: SourceEdit[] = [];
  collectEdits(
    root,
    { inHeading: false, inLink: false, inTableCell: false },
    {
      counters,
      firstRound,
      images,
      knownAssets,
      raw: { until: null },
      refusedIdentifiers,
      scope,
      source: markdown,
      staged,
    },
    edits,
  );
  if (edits.length === 0) return markdown;
  return applyEdits(markdown, edits);
}

/** `image-N.ext`: the index keeps names unique, the extension (when the
 *  source has a plain one) lets pandoc pick the media type. */
function stagedName(index: number, source: string): string {
  // `source` has already lost its query and fragment; what a `%23` decodes
  // to is part of the file name (`a#b.png`), not a fragment to strip again.
  const ext = EXTENSION.exec(decodePercent(source))?.[1];
  return ext ? `image-${index}.${ext.toLowerCase()}` : `image-${index}`;
}

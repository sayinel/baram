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
// This pass walks the document (export-markdown-image-walk.ts) and gives
// every image its verdict
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
// The backend accepts at most `MAX_STAGED_IMAGES` requests and fails the
// export past that — a boundary, not a courtesy. Staging stops at the same
// number here and every image after it becomes its alt text, counted apart,
// so a note with a gallery of hundreds still exports (issue 631).
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

import { visit } from "unist-util-visit";

import { parseMdast } from "../../pipeline/parse-mdast";
import { parserView } from "../link-href";
import { decodePercent } from "../path-utils";
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
import { type HtmlImage, walkImages } from "./export-markdown-image-walk";
import {
  applyEdits,
  type LabelContext,
  MAX_ROUNDS,
  type SourceEdit,
} from "./export-markdown-splice";

export interface ImagePolicyOptions {
  /**
   * The root of the deepest vault or folder context that holds the document
   * (pandoc-image-policy.ts chooses it — never the tab's own context, never a
   * `File` context), or null when no directory context holds it.
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
  /** How many images past `MAX_STAGED_IMAGES` became their alt text. */
  overCap: number;
  /** How many images became their alt text — what the user should hear about. */
  refused: number;
  /** Whether the document had a context to be relative to at all. */
  scoped: boolean;
  /**
   * How many html fragments this pass could not read and that may hold an
   * image (export-html-fragment.ts): left whole, their raw tags dropped by
   * the filter. An estimate of fragments, never a count of images.
   */
  unsupportedHtml: number;
}

/** An extension worth keeping on a staged image's name — pandoc picks the media type from it. */
const EXTENSION = /\.([A-Za-z0-9]{1,8})$/;

/**
 * How many images one export may stage: the backend's `MAX_IMAGE_COUNT`
 * (`src-tauri/src/export/pandoc_images.rs`), which refuses a longer list and
 * fails the export. The two numbers are pinned equal by a test that reads
 * the Rust source.
 */
export const MAX_STAGED_IMAGES = 256;

/** What one pass counts for the user, shared across rounds. */
interface Counters {
  overCap: number;
  refused: number;
  unsupportedHtml: number;
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
  const counters: Counters = { overCap: 0, refused: 0, unsupportedHtml: 0 };
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
        overCap: counters.overCap,
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

/** What one round stages into, shared by every edit of the round. */
interface Staging {
  counters: Counters;
  images: PandocImageRequest[];
  knownAssets: ReadonlySet<string>;
  scope: null | RelativeScope;
  /** The names this round staged — known from the next round on. */
  staged: string[];
}

/** Record a request for `source` and return the name its placeholder gets —
 *  or null, counted, when the export already stages as many images as the
 *  backend accepts. */
function stageRequest(staging: Staging, source: string): null | string {
  if (staging.images.length >= MAX_STAGED_IMAGES) {
    staging.counters.overCap += 1;
    return null;
  }
  const name = stagedName(staging.images.length, source);
  staging.images.push({ name, source });
  staging.staged.push(name);
  return name;
}

/**
 * The edit for one `<img …>` tag the walk read: its source is judged like
 * any other image — staged, kept, or reduced to its alt text and counted —
 * and a tag with no usable source becomes its alt text and is counted too,
 * since the backend's filter would drop the raw tag with no word to the user.
 */
function htmlImageEdit(
  { at, tag }: HtmlImage,
  ctx: LabelContext,
  staging: Staging,
): SourceEdit {
  if (tag.src === null) {
    staging.counters.refused += 1;
    return altEditAt(at, tag.alt, ctx);
  }
  const verdict = classifyImageSource(
    tag.src,
    staging.scope,
    staging.knownAssets,
  );
  if (verdict.kind === "refuse") {
    staging.counters.refused += 1;
    return altEditAt(at, tag.alt, ctx);
  }
  if (verdict.kind === "keep") return imageEditAt(at, tag, verdict.source, ctx);
  const name = stageRequest(staging, verdict.source);
  if (name === null) return altEditAt(at, tag.alt, ctx);
  return imageEditAt(at, tag, `${ASSET_SCHEME}${name}`, ctx);
}

/**
 * For the writers that embed nothing (latex, rst): every `<img …>` tag
 * becomes a markdown image with its source as HTML reads it — the parser's
 * view, as the embedding route writes it, so a blank or a tab inside the
 * attribute value never reaches pandoc — no staging, no verdict, exactly as
 * every other image reference passes through to those writers — and a tag
 * with no usable source becomes its alt text. Without
 * this, the raw tag reaches the backend, the policy filter drops it (raw
 * HTML is never written into any output), and the image silently vanishes
 * from a `.tex`. Returns the input itself when there is nothing to change.
 */
export function rewriteImageTagsAsMarkdown(markdown: string): {
  markdown: string;
  overCap: number;
  refused: number;
  unsupportedHtml: number;
} {
  const edits: SourceEdit[] = [];
  const counters: Counters = { overCap: 0, refused: 0, unsupportedHtml: 0 };
  walkImages(parseMdast(markdown), markdown, {
    htmlImage: ({ at, tag }, ctx) => {
      if (tag.src === null) {
        counters.refused += 1;
        edits.push(altEditAt(at, tag.alt, ctx));
        return;
      }
      edits.push(imageEditAt(at, tag, parserView(tag.src), ctx));
    },
    unread: () => {
      counters.unsupportedHtml += 1;
    },
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

  const staging: Staging = { counters, images, knownAssets, scope, staged };
  const edits: SourceEdit[] = [];
  walkImages(root, markdown, {
    htmlImage: (image, ctx) => {
      edits.push(htmlImageEdit(image, ctx, staging));
    },
    image: (node, ctx) => {
      const verdict = classifyImageSource(node.url, scope, knownAssets);
      if (verdict.kind === "refuse") {
        counters.refused += 1;
        edits.push(altEdit(node, node.alt, ctx));
      }
      if (verdict.kind === "stage") {
        const name = stageRequest(staging, verdict.source);
        edits.push(
          name === null
            ? altEdit(node, node.alt, ctx)
            : assetEdit(node, `${ASSET_SCHEME}${name}`, ctx),
        );
      }
    },
    imageReference: (node, ctx) => {
      if (refusedIdentifiers.has(node.identifier)) {
        counters.refused += 1;
        edits.push(altEdit(node, node.alt, ctx));
      }
    },
    // Only the first round counts a node the walk cannot read: it survives
    // every round unchanged and would be counted again each time.
    unread: () => {
      if (firstRound) counters.unsupportedHtml += 1;
    },
  });
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

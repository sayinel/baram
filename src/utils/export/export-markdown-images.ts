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
// This pass decides what pandoc may read, and it decides it so that pandoc
// never sees a filesystem path the document wrote:
//
// - `baram-asset:NAME` (a mermaid diagram the export rasterized) is kept; the
//   backend swaps it for the staged file.
// - A RELATIVE path that stays inside the document's own context — judged
//   here on the normalized string, against the context root the tab names —
//   is turned into an asset request: the destination becomes
//   `baram-asset:image-N.ext` and `{ name, source }` goes to the backend, which
//   resolves `source` against the document's directory, canonicalizes it, and
//   reads it only if the result lies under that same root. The string check
//   here is what lets a plain `../../secret.png` degrade to its alt text and
//   the export still succeed; the canonical check there is the boundary — a
//   symlink out of the vault, a spelling the URL parser and the filesystem
//   read differently, a path this file never imagined, all fail the export
//   there, naming the source. A relative path in a document that has never
//   been saved, or in a file opened on its own (a `File` context authorizes
//   exactly that file), has nothing it may be relative to, and is refused.
// - Everything else is refused and replaced by its alt text: an absolute path
//   (`/…`, `C:\…`, `\\server\…`), `file:`, `data:`, `http(s):` and every other
//   scheme, a protocol-relative `//host/x`, an empty or fragment-only
//   destination. Remote images are refused deliberately — an export must not
//   make a request the user did not see coming (a tracking pixel in a shared
//   note) — and an "include remote images" option is a separate decision.
//
// Runs after every converter and the mermaid rewrite, and BEFORE the link pass
// (export-markdown-links.ts), so that pass stays the final gate for links and
// re-parses whatever this one wrote. Nothing re-parses what the LINK pass
// writes, so its splice must not be able to complete an image: the shared
// serializer escapes a label's `]` and a `!` at its edge before a `[`. Alt text is spliced in with the shared machinery
// (export-markdown-splice.ts): serialized as literal text with block starters
// escaped, then escaped for its table cell or heading, with the neighbour
// guards — an alt of `# x` at a line start must not become a heading. A
// reference-style image (`![alt][ref]`) whose definition is anything but a
// kept asset becomes its alt text rather than a staged request: the editor
// resolves references when it loads a document, so one reaches this pass only
// from strings built by other means, and a definition is also what its links
// use.
//
// An `<img …>` tag in raw HTML is an image to pandoc too (issue 631): the
// editor writes one for a resized image, a note pasted from elsewhere may
// hold any spelling. Such a tag is judged like a markdown image — its
// source as HTML reads it — and written back as one, only when its html
// node is one this pass can read at all: nothing but tags, comments and
// caption text (export-html-fragment.ts, a positive grammar). Any other
// node — a fence, code, math or an indented line beside the tag, a shape
// pandoc and HTML read differently — is left whole, and the user is told
// that block could not be read, apart from the count of images refused.
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
import type { Html, Image, ImageReference, Nodes } from "mdast";

import { visit } from "unist-util-visit";

import { parseMdast } from "../../pipeline/parse-mdast";
import { parserView, RELATIVE_BASE } from "../link-href";
import {
  dirname,
  foldAsciiCase,
  hasDriveLetter,
  isUnderRoot,
  stripTrailingSeparators,
  toPosixPath,
} from "../path-utils";
import {
  mayHoldImage,
  rawOpenedBy,
  readHtmlFragment,
  type TagSpan,
} from "./export-html-fragment";
import { valueToSource } from "./export-html-node-offsets";
import {
  type EditorImageMetadata,
  editorImageMetadata,
  type LooseImg,
  readImgTag,
} from "./export-img-attributes";
import {
  applyEdits,
  innerContext,
  type LabelContext,
  labelText,
  MAX_ROUNDS,
  serializeInline,
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

/** Where an image may point, resolved once per document. */
export interface RelativeScope {
  /**
   * Windows paths (a drive letter) are compared case-insensitively: the
   * filesystem is, and `c:\vault` and `C:\Vault` are one directory.
   */
  caseInsensitive: boolean;
  /** The document's directory, POSIX-separated. */
  documentDir: string;
  /** The context root, POSIX-separated, without a trailing separator. */
  root: string;
}

/** The scheme the mermaid export uses for staged assets (see mermaid-export-assets.ts). */
const ASSET_SCHEME = "baram-asset:";
/** An extension worth keeping on a staged image's name — pandoc picks the media type from it. */
const EXTENSION = /\.([A-Za-z0-9]{1,8})$/;
type Verdict =
  | { kind: "keep"; source: string }
  | { kind: "refuse" }
  | { kind: "stage"; source: string };

/** What an image edit carries besides its destination. */
interface ImgAttrs extends EditorImageMetadata {
  alt: null | string;
}

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

/** The scope relative images resolve in, or null when there is none. */
export function relativeScope(
  documentPath: null | string,
  contextRoot: null | string,
): null | RelativeScope {
  if (documentPath === null || contextRoot === null) return null;
  // Judged on the inputs as given: a drive root `C:/` would lose its
  // separator to the normalisation below and stop looking like a drive.
  const caseInsensitive =
    hasDriveLetter(documentPath) || hasDriveLetter(contextRoot);
  const root = stripTrailingSeparators(toPosixPath(contextRoot));
  if (root === "") return null;
  return {
    caseInsensitive,
    documentDir: dirname(toPosixPath(documentPath)),
    root,
  };
}

/** A path that starts at a root: POSIX `/…`, Windows `C:\…` or `C:/…`. */
function isAbsolutePath(path: string): boolean {
  return /^[/\\]/.test(path) || /^[A-Za-z]:[\\/]/.test(path);
}

/** Is `target` the scope's root or inside it, by the scope's own case rule? */
function inScope(target: string, scope: RelativeScope): boolean {
  const same = scope.caseInsensitive
    ? foldAsciiCase(target) === foldAsciiCase(scope.root)
    : target === scope.root;
  return same || isUnderRoot(target, scope.root, scope.caseInsensitive);
}

/**
 * Whether pandoc may read `url`, and how. `scope` null: no path image may.
 * Judged on the parser's view of the destination (leading controls and
 * spaces dropped, tabs and newlines removed — `parserView`), as the link
 * policy does, so a tab before an absolute path is still an absolute path.
 * An absolute path is judged like a relative one — where it leads: inside
 * the document's context it is staged (before this change it was the only
 * form that ever embedded), outside it becomes alt text.
 */
export function classifyImageSource(
  url: string,
  scope: null | RelativeScope,
  knownAssets: ReadonlySet<string>,
): Verdict {
  const view = parserView(url);
  if (view.startsWith(ASSET_SCHEME)) {
    // Kept by the parser's view of it: that is the destination written out,
    // so a stray leading tab never reaches the markdown handed to pandoc.
    return knownAssets.has(view.slice(ASSET_SCHEME.length))
      ? { kind: "keep", source: view }
      : { kind: "refuse" };
  }
  if (view === "" || /^[#?]/.test(view)) return { kind: "refuse" };
  // Protocol-relative (`//host/x`) and UNC (`\\server\share`) name a host,
  // never a file of this context.
  if (/^[/\\]{2}/.test(view)) return { kind: "refuse" };
  const absolute = isAbsolutePath(view);
  if (!absolute) {
    // The WHATWG parser is what decides whether a destination carries its
    // own scheme (`java\tscript:`, ` HTTP:`); anything that does not resolve
    // under the placeholder base is not a path.
    let parsed: URL;
    try {
      parsed = new URL(view, RELATIVE_BASE);
    } catch {
      return { kind: "refuse" };
    }
    if (parsed.protocol !== "https:" || parsed.host !== "baram.invalid") {
      return { kind: "refuse" };
    }
  }
  if (scope === null) return { kind: "refuse" };
  // A query or fragment is not part of a file name (`img/a.png?raw=1`,
  // `icons.svg#home`): the file is what comes before it.
  const source = view.replace(/[?#].*$/, "");
  if (source === "") return { kind: "refuse" };
  // Where the path leads, on the string: `..` collapsed, percent-escapes
  // decoded as pandoc would decode them, backslashes read as separators. A
  // path that leaves the context root has no business being staged — the
  // backend would refuse it and fail the whole export, where alt text lets
  // the export go through without it.
  let decoded = source;
  try {
    decoded = decodeURIComponent(source);
  } catch {
    // A malformed escape is still a path; the backend decides what it opens.
  }
  // What the escapes hid is judged too: `%2Fetc%2Fpasswd` is `/etc/passwd`,
  // an absolute path, and the backend decodes it the same way.
  if (/^[/\\]{2}/.test(decoded)) return { kind: "refuse" };
  const target = toPosixPath(
    absolute || isAbsolutePath(decoded)
      ? decoded
      : `${scope.documentDir}/${decoded}`,
  );
  if (!inScope(target, scope)) return { kind: "refuse" };
  return { kind: "stage", source };
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
    closeRawRegion(walk.raw, node.value);
    return;
  }
  if (!("children" in node)) return;
  const inner = innerContext(ctx, node.type);
  for (const child of node.children) collectEdits(child, inner, walk, edits);
}

/** Let any node's text close the region the walk is inside. */
function closeRawRegion(raw: RawRegion, value: string): void {
  if (raw.until !== null && raw.until.test(value)) raw.until = null;
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
    closeRawRegion(raw, node.value);
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

/** Replace the tag by a markdown image with `url`, keeping alt and title and
 *  writing the width as pandoc's `{width=…}` attribute. */
function imageEditAt(
  span: TagSpan,
  attrs: ImgAttrs,
  url: string,
  ctx: LabelContext,
): SourceEdit {
  const image: Image = {
    alt: attrs.alt ?? undefined,
    title: attrs.title ?? null,
    type: "image",
    url,
  };
  const width = attrs.widthPixel
    ? `${attrs.widthPixel}px`
    : attrs.widthPercent !== undefined && attrs.widthPercent !== 100
      ? `${attrs.widthPercent}%`
      : null;
  return {
    end: span.end,
    inLink: ctx.inLink,
    start: span.start,
    text:
      inlineImageText(image, ctx) + (width === null ? "" : `{width=${width}}`),
  };
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
      closeRawRegion(raw, node.value);
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
  let decoded = source;
  try {
    decoded = decodeURIComponent(source);
  } catch {
    // A malformed escape is still a path; the backend decides what it opens.
  }
  const ext = EXTENSION.exec(decoded)?.[1];
  return ext ? `image-${index}.${ext.toLowerCase()}` : `image-${index}`;
}

/** Replace the image by its alt text, spliced as literal text. */
function altEdit(
  node: Image | ImageReference,
  alt: null | string | undefined,
  ctx: LabelContext,
): SourceEdit {
  const { end, start } = node.position!;
  return altEditAt({ end: end.offset!, start: start.offset! }, alt, ctx);
}

/** The alt text for `[start, end)`, spliced as literal text. */
function altEditAt(
  span: TagSpan,
  alt: null | string | undefined,
  ctx: LabelContext,
): SourceEdit {
  const children = alt ? [{ type: "text" as const, value: alt }] : [];
  return {
    end: span.end,
    inLink: ctx.inLink,
    start: span.start,
    text: labelText(children, ctx),
  };
}

/** Rewrite the image's destination to the staged asset, re-serializing the
 *  whole image so the alt and title keep their escapes. */
function assetEdit(node: Image, url: string, ctx: LabelContext): SourceEdit {
  const { end, start } = node.position!;
  const image: Image = { ...node, position: undefined, url };
  return {
    end: end.offset!,
    inLink: ctx.inLink,
    start: start.offset!,
    text: inlineImageText(image, ctx),
  };
}

/** One image, serialized for where it stands: inside a GFM cell a pipe in
 *  the alt (decoded by the parser) must be escaped again or it ends the cell. */
function inlineImageText(image: Image, ctx: LabelContext): string {
  const text = serializeInline([image]);
  if (!ctx.inTableCell) return text;
  return text.replace(/(\\*)\|/g, (match, run: string) =>
    run.length % 2 === 0 ? `${run}\\|` : match,
  );
}

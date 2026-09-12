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
// Not covered here — judged one layer later, on pandoc's own parse, by the
// Lua policy filter `src-tauri/src/export/pandoc.rs` writes for each export
// (issues 545 and 544): raw HTML of any kind, including an `<img src>` this
// pass did not recognise as the editor's own tag, is dropped there; an epub
// `cover-image` in YAML metadata is removed from the metadata; every Image
// the writers would embed is held to the staged-asset allowlist. Raw TeX
// `\includegraphics` is dropped with the rest of raw TeX. A document with
// nothing to change comes back as the very same string.
import type { PandocImageRequest } from "../../ipc/types";
import type { MediaHtmlAttrs } from "../../pipeline/transformers/media-html-tag";
import type { Html, Image, ImageReference, Nodes } from "mdast";

import { visit } from "unist-util-visit";

import { parseMdast } from "../../pipeline/parse-mdast";
import { parseImgHtml } from "../../pipeline/transformers/image-transformer";
import { parserView, RELATIVE_BASE } from "../link-href";
import {
  dirname,
  isUnderRoot,
  stripTrailingSeparators,
  toPosixPath,
} from "../path-utils";
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
/** A POSIX-separated path that begins with a Windows drive letter. */
const DRIVE_LETTER = /^[A-Za-z]:\//;

type Verdict =
  { kind: "keep" } | { kind: "refuse" } | { kind: "stage"; source: string };

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
  const counters = { refused: 0 };
  let out = markdown;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const staged: string[] = [];
    const next = stageOnce(out, scope, known, images, staged, counters);
    for (const name of staged) known.add(name);
    if (next === out) {
      return {
        images,
        markdown: out,
        refused: counters.refused,
        scoped: scope !== null,
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
  /** Shared across rounds: how many images became alt text. */
  counters: { refused: number };
  images: PandocImageRequest[];
  knownAssets: ReadonlySet<string>;
  refusedIdentifiers: ReadonlySet<string>;
  scope: null | RelativeScope;
  /** The names this walk staged — known from the next round on. */
  staged: string[];
}

/** The scope relative images resolve in, or null when there is none. */
export function relativeScope(
  documentPath: null | string,
  contextRoot: null | string,
): null | RelativeScope {
  if (documentPath === null || contextRoot === null) return null;
  const root = stripTrailingSeparators(toPosixPath(contextRoot));
  if (root === "") return null;
  const documentDir = dirname(toPosixPath(documentPath));
  return {
    caseInsensitive: DRIVE_LETTER.test(root) || DRIVE_LETTER.test(documentDir),
    documentDir,
    root,
  };
}

/** A path that starts at a root: POSIX `/…`, Windows `C:\…` or `C:/…`. */
function isAbsolutePath(path: string): boolean {
  return /^[/\\]/.test(path) || /^[A-Za-z]:[\\/]/.test(path);
}

/** Is `target` the scope's root or inside it, by the scope's own case rule? */
function inScope(target: string, scope: RelativeScope): boolean {
  const [t, root] = scope.caseInsensitive
    ? [target.toLowerCase(), scope.root.toLowerCase()]
    : [target, scope.root];
  return t === root || isUnderRoot(t, root);
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
    return knownAssets.has(view.slice(ASSET_SCHEME.length))
      ? { kind: "keep" }
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
    const edit = imgTagEdit(node, ctx, walk);
    if (edit !== null) edits.push(edit);
    return;
  }
  if (!("children" in node)) return;
  const inner = innerContext(ctx, node.type);
  for (const child of node.children) collectEdits(child, inner, walk, edits);
}

/** Record a request for `source` and return the name its placeholder gets. */
function stageRequest(walk: Walk, source: string): string {
  const name = stagedName(walk.images.length, source);
  walk.images.push({ name, source });
  walk.staged.push(name);
  return name;
}

/**
 * An `<img …>` tag as the editor itself writes one for a resized image
 * (image-transformer.ts: width is kept as HTML because markdown has no
 * syntax for it). Judged like a markdown image and written back as one, its
 * width as pandoc's `{width=…}` attribute, so Word and EPUB keep the size —
 * Word never rendered the tag at all, and the backend's filter now drops raw
 * HTML for EPUB too. A tag the editor could not represent is left alone.
 */
function imgTagEdit(
  node: Html,
  ctx: LabelContext,
  walk: Walk,
): null | SourceEdit {
  const attrs = editorImgTag(node);
  if (attrs === null) return null;
  const verdict = classifyImageSource(attrs.src, walk.scope, walk.knownAssets);
  if (verdict.kind === "refuse") {
    walk.counters.refused += 1;
    return altEdit(node, attrs.alt, ctx);
  }
  const url =
    verdict.kind === "keep"
      ? attrs.src
      : `${ASSET_SCHEME}${stageRequest(walk, verdict.source)}`;
  return imageEdit(node, attrs, url, ctx);
}

/** The attrs of an `<img …>` tag the editor's own parser accepts, or null. */
function editorImgTag(node: Html): MediaHtmlAttrs | null {
  const value = node.value.trim();
  if (!/^<img\s/i.test(value)) return null;
  return parseImgHtml(value);
}

/** Replace the tag by a markdown image with `url`, keeping alt, title and
 *  the width as pandoc's `{width=…}` attribute. */
function imageEdit(
  node: Html,
  attrs: MediaHtmlAttrs,
  url: string,
  ctx: LabelContext,
): SourceEdit {
  const image: Image = {
    alt: attrs.alt ?? undefined,
    title: attrs.title,
    type: "image",
    url,
  };
  const width = attrs.widthPixel
    ? `${attrs.widthPixel}px`
    : attrs.widthPercent !== 100
      ? `${attrs.widthPercent}%`
      : null;
  const { end, start } = node.position!;
  return {
    end: end.offset!,
    inLink: ctx.inLink,
    start: start.offset!,
    text: serializeInline([image]) + (width === null ? "" : `{width=${width}}`),
  };
}

/**
 * For the writers that embed nothing (latex, rst): the editor's `<img …>`
 * tags become markdown images with their source AS WRITTEN — no staging, no
 * verdict, exactly as every other image reference passes through to those
 * writers. Without this, the raw tag reaches the backend, the policy filter
 * drops it (raw HTML is never written into any output), and a resized image
 * silently vanishes from a `.tex`. Returns the input itself when there is
 * nothing to change.
 */
export function rewriteImageTagsAsMarkdown(markdown: string): string {
  const edits: SourceEdit[] = [];
  const collect = (node: Nodes, ctx: LabelContext): void => {
    if (node.type === "html") {
      const attrs = editorImgTag(node);
      if (attrs !== null) edits.push(imageEdit(node, attrs, attrs.src, ctx));
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
  return edits.length === 0 ? markdown : applyEdits(markdown, edits);
}

function stageOnce(
  markdown: string,
  scope: null | RelativeScope,
  knownAssets: ReadonlySet<string>,
  images: PandocImageRequest[],
  staged: string[],
  counters: { refused: number },
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
    { counters, images, knownAssets, refusedIdentifiers, scope, staged },
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
  node: Html | Image | ImageReference,
  alt: null | string | undefined,
  ctx: LabelContext,
): SourceEdit {
  const { end, start } = node.position!;
  const children = alt ? [{ type: "text" as const, value: alt }] : [];
  return {
    end: end.offset!,
    inLink: ctx.inLink,
    start: start.offset!,
    text: labelText(children, ctx),
  };
}

/** Rewrite the image's destination to the staged asset, re-serializing the
 *  whole image so the alt and title keep their escapes. */
function assetEdit(node: Image, url: string, ctx: LabelContext): SourceEdit {
  const { end, start } = node.position!;
  const image: Image = { ...node, position: undefined, url };
  let text = serializeInline([image]);
  if (ctx.inTableCell) {
    // A GFM cell ends at the next unescaped pipe; the alt came out with its
    // pipes decoded.
    text = text.replace(/(\\*)\|/g, (match, run: string) =>
      run.length % 2 === 0 ? `${run}\\|` : match,
    );
  }
  return { end: end.offset!, inLink: ctx.inLink, start: start.offset!, text };
}

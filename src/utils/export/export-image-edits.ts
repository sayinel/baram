// issue 545 — how the image policy writes its edits into the markdown.
//
// Every decision of the policy (export-markdown-images.ts) ends in one of
// three splices: an image whose destination changed, re-serialized whole so
// its alt and title keep their escapes; an `<img …>` tag rewritten as a
// markdown image, its width as pandoc's `{width=…}` attribute; or an image
// reduced to its alt text, spliced as literal text with block starters
// escaped, then escaped for its table cell or heading, with the neighbour
// guards of the shared splice machinery (export-markdown-splice.ts) — an alt
// of `# x` at a line start must not become a heading, and a pipe in an alt
// must not end a table cell.
import type { TagSpan } from "./export-html-fragment";
import type { EditorImageMetadata } from "./export-img-attributes";
import type { Image, ImageReference } from "mdast";

import {
  type LabelContext,
  labelText,
  serializeInline,
  type SourceEdit,
} from "./export-markdown-splice";

/** What an image edit carries besides its destination. */
export interface ImgAttrs extends EditorImageMetadata {
  alt: null | string;
}

/** Replace the tag by a markdown image with `url`, keeping alt and title and
 *  writing the width as pandoc's `{width=…}` attribute. */
export function imageEditAt(
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

/** Replace the image by its alt text, spliced as literal text. */
export function altEdit(
  node: Image | ImageReference,
  alt: null | string | undefined,
  ctx: LabelContext,
): SourceEdit {
  const { end, start } = node.position!;
  return altEditAt({ end: end.offset!, start: start.offset! }, alt, ctx);
}

/** The alt text for `[start, end)`, spliced as literal text. */
export function altEditAt(
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
export function assetEdit(
  node: Image,
  url: string,
  ctx: LabelContext,
): SourceEdit {
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

// issue 631 — what an `<img …>` tag says, as HTML reads it.
//
// Two readers look at a tag the export found (export-html-fragment.ts). The
// platform's HTML parser gives the attributes as a browser would read them:
// references decoded by attribute rules, the first of a duplicate kept,
// names lowercased, quoted or unquoted values alike. That reading decides
// where the image points and what to say if it cannot be embedded. The
// editor's own strict parser (`parseImgHtml`, the MD→PM round-trip) is asked
// one thing only: is this the tag the editor itself wrote, so that its width
// and title may be kept — and only when both readers agree on every
// attribute it copies, since the strict parser's name scan can be fooled by
// a quoted value that spells another attribute.
//
// No `<img>` element is ever created: the tag is parsed inside a `<template>`
// as an inert custom element, because an `<img>` element — even in a
// `DOMParser` document — may fetch its source, the very thing still to be
// judged (the app's CSP allows `img-src https:`). One call reads one tag and
// returns everything the export needs of it.
import { parseImgHtml } from "../../pipeline/transformers/image-transformer";

/** The title and size the editor's own tag carries. */
export interface EditorImageMetadata {
  title?: null | string;
  widthPercent?: number;
  widthPixel?: number;
}

/**
 * What an `<img …>` tag says to the export: its source and alt text as HTML
 * reads them (`src` null when absent or empty), and the editor's title and
 * size when the tag is the editor's own. Nothing at all without a document
 * to parse in.
 */
export interface ExportImageTag extends EditorImageMetadata {
  alt: null | string;
  src: null | string;
}

/**
 * Read one `<img …>` tag the grammar found (export-html-fragment.ts). The
 * template the reading parses in lives for this call only: nothing is kept
 * between tags, and nothing in it loads or runs.
 */
export function readExportImageTag(raw: string): ExportImageTag {
  if (typeof document === "undefined") return { alt: null, src: null };
  const host = document.createElement("template");
  const attrs = parseTag(host, raw);
  if (attrs === null) return { alt: null, src: null };
  const src = attrs.get("src")?.trim() ?? "";
  return {
    alt: attrs.get("alt") ?? null,
    src: src === "" ? null : src,
    ...editorImageMetadata(host, raw, attrs),
  };
}

/**
 * The tag's attributes as HTML reads them, by parsing it inside the template
 * as `<baram-img …>` — an inert custom element, never an `<img>`, whose
 * element would fetch its source, the very thing still to be judged. The
 * parser gives attribute-value decoding (references by attribute rules, a
 * legacy `&copy` staying literal before a letter), the first of a duplicate,
 * lowercased names and line endings normalised to LF. Null when the parse
 * did not yield exactly one empty element — the grammar promised one
 * complete start tag, so anything else is refused.
 */
function parseTag(
  host: HTMLTemplateElement,
  raw: string,
): Map<string, string> | null {
  try {
    host.innerHTML = `<baram-img${raw.slice(4)}`; // `raw` begins with `<img`
    const { content } = host;
    const el = content.firstElementChild;
    if (
      el === null ||
      content.childNodes.length !== 1 ||
      el.childNodes.length !== 0 ||
      el.tagName.toLowerCase() !== "baram-img"
    ) {
      return null;
    }
    const attrs = new Map<string, string>();
    for (const { name, value } of Array.from(el.attributes)) {
      attrs.set(name, value);
    }
    return attrs;
  } finally {
    host.innerHTML = "";
  }
}

/** One attribute value decoded once, by attribute rules — for comparing the
 *  strict parser's raw capture with what HTML read. `text` holds no `"`. */
function decodeAttributeValue(
  host: HTMLTemplateElement,
  text: string,
): null | string {
  try {
    host.innerHTML = `<baram-x a="${text}">`;
    return host.content.firstElementChild?.getAttribute("a") ?? null;
  } finally {
    host.innerHTML = "";
  }
}

/** The attributes the strict parser reads and would write back, each with
 *  the pattern that lifts its raw capture from the tag — compiled once, not
 *  once per tag. */
const STRICT_ATTRS: ReadonlyArray<readonly [string, RegExp]> = [
  "src",
  "alt",
  "title",
  "width",
].map((name) => [name, new RegExp(`\\b${name}="([^"]*)"`, "i")] as const);

/**
 * Title and size for a tag the editor itself wrote — the strict parser
 * (`parseImgHtml`, the MD→PM round-trip) accepts exactly that spelling — and
 * only when it and HTML agree on every attribute it copies. The strict
 * parser's name scan can be fooled by a quoted value that spells another
 * attribute (`alt='width="640"'`); HTML's tokenizer cannot, so each of the
 * parser's raw captures is decoded once by attribute rules and compared,
 * untrimmed, with what HTML read (`attrs`). Any disagreement keeps no size
 * and no title: the image is still judged by HTML's reading. Any other tag
 * keeps no size either — pandoc's `{width=…}` is only written for a width
 * the editor would have round-tripped.
 */
function editorImageMetadata(
  host: HTMLTemplateElement,
  raw: string,
  attrs: ReadonlyMap<string, string>,
): EditorImageMetadata {
  const strict = parseImgHtml(raw);
  if (strict === null) return {};
  for (const [name, pattern] of STRICT_ATTRS) {
    const capture = pattern.exec(raw)?.[1];
    const parsed =
      capture === undefined ? null : decodeAttributeValue(host, capture);
    if (parsed !== (attrs.get(name) ?? null)) return {};
  }
  return {
    title: strict.title,
    widthPercent: strict.widthPercent,
    widthPixel: strict.widthPixel,
  };
}

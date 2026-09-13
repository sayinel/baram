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
// judged (the app's CSP allows `img-src https:`).
import { parseImgHtml } from "../../pipeline/transformers/image-transformer";

/** What an `<img>` tag says as HTML reads it. `src` null: absent or empty. */
export interface LooseImg {
  alt: null | string;
  /** Every attribute as HTML read it, untrimmed; null when the tag did not parse. */
  attrs: Map<string, string> | null;
  src: null | string;
}

/** The title and size the editor's own tag carries. */
export interface EditorImageMetadata {
  title?: null | string;
  widthPercent?: number;
  widthPixel?: number;
}

/** One `<template>` kept for parsing. Its contents live in an inert document
 *  with no browsing context: nothing in there loads or runs. */
let host: HTMLTemplateElement | null = null;

/**
 * The tag's attributes as HTML reads them, by parsing it inside the template
 * as `<baram-img …>` — an inert custom element, never an `<img>`, whose
 * element would fetch its source, the very thing still to be judged. The
 * parser gives attribute-value decoding (references by attribute rules, a
 * legacy `&copy` staying literal before a letter), the first of a duplicate,
 * lowercased names and line endings normalised to LF. Null when there is no
 * document, or when the parse did not yield exactly one empty element — the
 * grammar promised one complete start tag, so anything else is refused.
 */
function parseTag(raw: string): Map<string, string> | null {
  if (typeof document === "undefined") return null;
  host ??= document.createElement("template");
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
function decodeAttributeValue(text: string): null | string {
  if (typeof document === "undefined") return null;
  host ??= document.createElement("template");
  try {
    host.innerHTML = `<baram-x a="${text}">`;
    return host.content.firstElementChild?.getAttribute("a") ?? null;
  } finally {
    host.innerHTML = "";
  }
}

/**
 * The tag's `src` and `alt` as HTML reads them. The strict parser
 * (`parseImgHtml`) exists for the MD→PM round-trip and refuses anything it
 * could not write back byte for byte; the export only has to know where the
 * image points and what to say if it cannot embed it.
 */
export function readImgTag(raw: string): LooseImg {
  const attrs = parseTag(raw);
  const src = attrs?.get("src")?.trim() ?? "";
  const alt = attrs?.get("alt");
  return { alt: alt ?? null, attrs, src: src === "" ? null : src };
}

/** The attributes the strict parser reads and would write back. */
const STRICT_ATTRS = ["src", "alt", "title", "width"] as const;

/**
 * Title and size for a tag the editor itself wrote — the strict parser
 * accepts exactly that spelling — and only when it and HTML agree on every
 * attribute it copies. The strict parser's name scan can be fooled by a
 * quoted value that spells another attribute (`alt='width="640"'`); HTML's
 * tokenizer cannot, so each of the parser's raw captures is decoded once by
 * attribute rules and compared, untrimmed, with what HTML read. Any
 * disagreement keeps no size and no title: the image is still judged by
 * HTML's reading. Any other tag keeps no size either — pandoc's `{width=…}`
 * is only written for a width the editor would have round-tripped.
 */
export function editorImageMetadata(
  raw: string,
  loose: LooseImg,
): EditorImageMetadata {
  const strict = parseImgHtml(raw);
  if (strict === null || loose.attrs === null) return {};
  for (const name of STRICT_ATTRS) {
    const capture = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(raw)?.[1];
    const parsed = capture === undefined ? null : decodeAttributeValue(capture);
    if (parsed !== (loose.attrs.get(name) ?? null)) return {};
  }
  return {
    title: strict.title,
    widthPercent: strict.widthPercent,
    widthPixel: strict.widthPixel,
  };
}

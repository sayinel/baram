// §30a Block ID — Obsidian-compatible `^block-id` suffix parsing/serialization
// §30b Block Reference + Block Embed — inline/block atom node utilities
//
// Block IDs appear at the end of block-level content as ` ^some-id`.
// They are stored as a `blockId` attribute on paragraph/heading PM nodes.
//
// Block references: ((target#^blockId)) or ((target#^blockId|display)) or ((#^blockId))
// Block embeds: {{embed ((target#^blockId))}}

/** Matches ` ^{id}` at end of string. ID: starts with [a-zA-Z0-9], followed by [\w-]* */
export const BLOCK_ID_SUFFIX_RE = / \^([a-zA-Z0-9][\w-]*)$/;

/** Append ` ^{id}` suffix to text */
export function appendBlockId(text: string, blockId: string): string {
  return `${text} ^${blockId}`;
}

/** Extract block ID from text, returning stripped text + id, or null if not found */
export function extractBlockId(
  text: string,
): null | { blockId: string; strippedText: string } {
  const match = BLOCK_ID_SUFFIX_RE.exec(text);
  if (!match) return null;
  return {
    blockId: match[1],
    strippedText: text.slice(0, match.index),
  };
}

// --- §30b: Auto-generation ---

/** Generate an 8-character hex block ID using Web Crypto API */
export function generateBlockId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

// --- §30b: Block Reference ---

/** Matches ((target#^blockId)) or ((target#^blockId|display)) or ((#^blockId)).
 * No `g` flag — use as `.source` to create stateful regex instances per call site. */
export const BLOCK_REF_RE =
  /\(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)(?:\|([^)]+))?\)\)/;

// §275.4 Target escaping — BLOCK_REF_RE's target capture is `[^)#|]*?`: it
// cannot contain `)`, `#`, or `|`. Most targets are user-typed note paths that
// never need those characters, but targets derived mechanically from a
// filename (pdf-highlight-sidecar.ts's pdfRelPathForHighlightTarget and its
// callers) can carry any of the three verbatim — "Attention Is All You Need
// (2017).pdf" is the canonical example. Percent-escape just those three
// characters (plus `%` itself, so the escape round-trips losslessly even if
// the original text already contains a literal `%`) at the point a target is
// built for serializeBlockRef, and reverse it wherever a target is
// interpreted as a real path again: pdfRelPathForHighlightTarget
// (pdf-highlight-sidecar.ts) and resolveWikilinkTarget (wikilink-nav.ts).
// Order matters both ways: `%` is escaped FIRST so the `%29`/`%23`/`%7C`
// introduced by the later steps aren't themselves re-escaped, and unescaped
// LAST so a decoded `)`/`#`/`|` can't be mistaken for part of a `%25`.
const TARGET_ESCAPE_PAIRS: readonly [raw: string, escaped: string][] = [
  ["%", "%25"],
  [")", "%29"],
  ["#", "%23"],
  ["|", "%7C"],
];

/** Percent-escape `)`, `#`, `|`, and `%` so the result is safe to embed as a
 * BLOCK_REF_RE/BLOCK_EMBED_RE target. Inverse: unescapeBlockRefTarget. */
export function escapeBlockRefTarget(target: string): string {
  let out = target;
  for (const [raw, escaped] of TARGET_ESCAPE_PAIRS) {
    out = out.split(raw).join(escaped);
  }
  return out;
}

// §276.6 Per-reference width — `((target#^id|display|w=60))` / `((target#^id|w=60))`.
// BLOCK_REF_RE's display capture is `([^)]+)`, which already accepts `|`, so the
// width field is separated *after* the regex match rather than by the regex: making
// the pattern itself width-aware would ripple into the InputRule, the pasteRule and
// convert-inline-text.ts. Only the segment after the LAST `|` is a candidate, and
// only when it is exactly `w=<integer 10..100>` — anything else stays part of the
// display text, so a reference whose label genuinely reads `w=200` is left alone.
const REF_WIDTH_MIN = 10;
const REF_WIDTH_MAX = 100;
// Leading zeros are rejected on purpose: `w=060` parses to 60 but would come back
// out of serializeBlockRef as `w=60`, breaking byte-identical markdown round-trip.
const REF_WIDTH_DIGITS_RE = /^[1-9]\d{0,2}$/;
const REF_WIDTH_PREFIX = "w=";

/** Parse block reference attributes from a regex match */
export function parseBlockRefMatch(match: RegExpMatchArray): {
  blockId: string;
  display: null | string;
  target: string;
  width: null | number;
} {
  const raw = match[3];
  const { display, width } = raw
    ? splitRefWidth(raw)
    : { display: null, width: null };
  return {
    target: match[1],
    blockId: match[2],
    display,
    width,
  };
}

/** Parse a bare width value ("60"), returning null unless it is an integer
 * percentage in [10, 100] written without a leading zero. */
export function parseRefWidth(raw: null | string | undefined): null | number {
  if (!raw || !REF_WIDTH_DIGITS_RE.test(raw)) return null;
  const width = Number(raw);
  if (width < REF_WIDTH_MIN || width > REF_WIDTH_MAX) return null;
  return width;
}

/** Serialize block reference attrs back to ((...)) string */
export function serializeBlockRef(attrs: {
  blockId: string;
  display?: null | string;
  target: string;
  width?: null | number;
}): string {
  const ref = `${attrs.target}#^${attrs.blockId}`;
  const width = attrs.width ? `|${REF_WIDTH_PREFIX}${attrs.width}` : "";
  if (attrs.display) {
    return `((${ref}|${attrs.display}${width}))`;
  }
  // Width without display still needs its own `|` — `((target#^id|w=60))`.
  return `((${ref}${width}))`;
}

/** Split a raw display capture into its display text and trailing `|w=NN` width.
 * Pure counterpart of serializeBlockRef's width branch — `splitRefWidth` of a
 * serialized display must reproduce the inputs it was serialized from. */
export function splitRefWidth(display: string): {
  display: null | string;
  width: null | number;
} {
  const lastPipe = display.lastIndexOf("|");
  const field = display.slice(lastPipe + 1); // whole string when there is no `|`
  const width = field.startsWith(REF_WIDTH_PREFIX)
    ? parseRefWidth(field.slice(REF_WIDTH_PREFIX.length))
    : null;

  // `|w=60` (empty display before the pipe) is NOT split: serializing back would
  // drop the leading pipe and change the markdown on disk.
  if (width === null || lastPipe === 0) {
    return { display: display || null, width: null };
  }
  return {
    display: lastPipe > 0 ? display.slice(0, lastPipe) : null,
    width,
  };
}

/** Inverse of escapeBlockRefTarget. */
export function unescapeBlockRefTarget(target: string): string {
  let out = target;
  for (let i = TARGET_ESCAPE_PAIRS.length - 1; i >= 0; i--) {
    const [raw, escaped] = TARGET_ESCAPE_PAIRS[i];
    out = out.split(escaped).join(raw);
  }
  return out;
}

// --- §30b: Block Embed ---

/** Matches {{embed ((target#^blockId))}} — must be the entire paragraph text */
export const BLOCK_EMBED_RE =
  /^\{\{embed \(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)\)\)\}\}$/;

/** Parse block embed attributes from a regex match */
export function parseBlockEmbedMatch(match: RegExpMatchArray): {
  blockId: string;
  target: string;
} {
  return {
    target: match[1],
    blockId: match[2],
  };
}

/** Serialize block embed attrs back to {{embed ((...))}} string */
export function serializeBlockEmbed(attrs: {
  blockId: string;
  target: string;
}): string {
  return `{{embed ((${attrs.target}#^${attrs.blockId}))}}`;
}

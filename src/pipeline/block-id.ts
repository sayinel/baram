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

/** Parse block reference attributes from a regex match */
export function parseBlockRefMatch(match: RegExpMatchArray): {
  blockId: string;
  display: null | string;
  target: string;
} {
  return {
    target: match[1],
    blockId: match[2],
    display: match[3] || null,
  };
}

/** Serialize block reference attrs back to ((...)) string */
export function serializeBlockRef(attrs: {
  blockId: string;
  display?: null | string;
  target: string;
}): string {
  const ref = `${attrs.target}#^${attrs.blockId}`;
  if (attrs.display) {
    return `((${ref}|${attrs.display}))`;
  }
  return `((${ref}))`;
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

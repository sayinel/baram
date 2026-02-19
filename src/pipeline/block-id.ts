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

/** Extract block ID from text, returning stripped text + id, or null if not found */
export function extractBlockId(
  text: string,
): { blockId: string; strippedText: string } | null {
  const match = BLOCK_ID_SUFFIX_RE.exec(text);
  if (!match) return null;
  return {
    blockId: match[1],
    strippedText: text.slice(0, match.index),
  };
}

/** Append ` ^{id}` suffix to text */
export function appendBlockId(text: string, blockId: string): string {
  return `${text} ^${blockId}`;
}

// --- §30b: Auto-generation ---

/** Generate an 8-character hex block ID using Web Crypto API */
export function generateBlockId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

// --- §30b: Block Reference ---

/** Matches ((target#^blockId)) or ((target#^blockId|display)) or ((#^blockId)) */
export const BLOCK_REF_RE =
  /\(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)(?:\|([^)]+))?\)\)/g;

/** Parse block reference attributes from a regex match */
export function parseBlockRefMatch(match: RegExpMatchArray): {
  target: string;
  blockId: string;
  display: string | null;
} {
  return {
    target: match[1],
    blockId: match[2],
    display: match[3] || null,
  };
}

/** Serialize block reference attrs back to ((...)) string */
export function serializeBlockRef(attrs: {
  target: string;
  blockId: string;
  display?: string | null;
}): string {
  const ref = `${attrs.target}#^${attrs.blockId}`;
  if (attrs.display) {
    return `((${ref}|${attrs.display}))`;
  }
  return `((${ref}))`;
}

// --- §30b: Block Embed ---

/** Matches {{embed ((target#^blockId))}} — must be the entire paragraph text */
export const BLOCK_EMBED_RE =
  /^\{\{embed \(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)\)\)\}\}$/;

/** Parse block embed attributes from a regex match */
export function parseBlockEmbedMatch(match: RegExpMatchArray): {
  target: string;
  blockId: string;
} {
  return {
    target: match[1],
    blockId: match[2],
  };
}

/** Serialize block embed attrs back to {{embed ((...))}} string */
export function serializeBlockEmbed(attrs: {
  target: string;
  blockId: string;
}): string {
  return `{{embed ((${attrs.target}#^${attrs.blockId}))}}`;
}

// wikilink-transformer.ts — §28 Wikilink mdast ↔ ProseMirror
/** Regex to detect [[...]] patterns in text (§87: optional alias:: prefix) */
export const WIKILINK_RE =
  /\[\[(?:([a-zA-Z][\w-]*)::)?([^\]|#^]+)(?:#([^\]|^]+))?(?:\^([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

/** Parse wikilink attributes from a regex match */
export function parseWikilinkMatch(match: RegExpMatchArray): {
  blockId: null | string;
  display: null | string;
  heading: null | string;
  target: string;
  vaultAlias: null | string;
} {
  return {
    vaultAlias: match[1] || null,
    target: match[2],
    heading: match[3] || null,
    blockId: match[4] || null,
    display: match[5] || null,
  };
}

/** Serialize wikilink attrs back to [[...]] string */
export function serializeWikilink(attrs: {
  blockId?: null | string;
  display?: null | string;
  heading?: null | string;
  target: string;
  vaultAlias?: null | string;
}): string {
  let result = "";
  if (attrs.vaultAlias) result += `${attrs.vaultAlias}::`;
  result += attrs.target;
  if (attrs.heading) result += `#${attrs.heading}`;
  if (attrs.blockId) result += `^${attrs.blockId}`;
  if (attrs.display) result += `|${attrs.display}`;
  return `[[${result}]]`;
}

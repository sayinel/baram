// wikilink-transformer.ts — §28 Wikilink mdast ↔ ProseMirror
/** Regex to detect [[...]] patterns in text */
export const WIKILINK_RE =
  /\[\[([^\]|#^]+)(?:#([^\]|^]+))?(?:\^([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

/** Parse wikilink attributes from a regex match */
export function parseWikilinkMatch(match: RegExpMatchArray): {
  blockId: null | string;
  display: null | string;
  heading: null | string;
  target: string;
} {
  return {
    target: match[1],
    heading: match[2] || null,
    blockId: match[3] || null,
    display: match[4] || null,
  };
}

/** Serialize wikilink attrs back to [[...]] string */
export function serializeWikilink(attrs: {
  blockId?: null | string;
  display?: null | string;
  heading?: null | string;
  target: string;
}): string {
  let result = attrs.target;
  if (attrs.heading) result += `#${attrs.heading}`;
  if (attrs.blockId) result += `^${attrs.blockId}`;
  if (attrs.display) result += `|${attrs.display}`;
  return `[[${result}]]`;
}

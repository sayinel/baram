/**
 * Extract the YAML frontmatter block from markdown content.
 *
 * Returns the raw YAML string and the rest of the document body.
 * Returns null if no valid frontmatter block is found.
 *
 * @known-issue The three original callers each parsed the frontmatter
 * differently (PropertiesPanel: raw split only; journal-stats-cache: full
 * key/value parse; journal-search: field-specific extraction). This function
 * provides the minimal common contract. A richer `parseFrontmatter()` API
 * that returns structured fields should be introduced when a third caller
 * needs parsed values — at that point the callers can be migrated.
 */
export function extractFrontmatter(
  content: string,
): null | { rest: string; yaml: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return null;
  return {
    yaml: match[1],
    rest: content.slice(match[0].length),
  };
}

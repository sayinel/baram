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

/**
 * §72 `content` with the YAML of its frontmatter block (what `extractFrontmatter` returns as
 * `yaml`) replaced by `yaml`, and every other character — both `---` fences, their line breaks,
 * the body — as it was. `content` unchanged when it has no frontmatter block.
 */
export function withFrontmatterYaml(content: string, yaml: string): string {
  const found = extractFrontmatter(content);
  if (!found) return content;
  const start = /^---\r?\n/.exec(content)![0].length;
  return (
    content.slice(0, start) + yaml + content.slice(start + found.yaml.length)
  );
}

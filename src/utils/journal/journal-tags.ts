/**
 * §56l — Tag index and autocomplete utilities for journal captures
 */
import { frontmatterListItems } from "../markdown/frontmatter-list";
import { tagName } from "../tags/tag-name";

/** Pattern matching #tag with word chars, Korean characters, and nested paths (#parent/child) */
const TAG_PATTERN = /#([\w가-힣]+(?:\/[\w가-힣]+)*)/g;

/**
 * Build a frequency map of tag → count from multiple files.
 */
export function buildTagIndex(
  files: { content: string; path: string }[],
): Map<string, number> {
  const index = new Map<string, number>();
  for (const file of files) {
    const fileTags = extractTagsFromContent(file.content);
    for (const tag of fileTags) {
      index.set(tag, (index.get(tag) ?? 0) + 1);
    }
  }
  return index;
}

/**
 * Extract all unique tags from markdown content.
 * Sources: frontmatter `tags: [a, b]` array AND inline `#tagname` in the body — the text after
 * the frontmatter, as the backend's index reads it: a `#x` in another frontmatter field is not
 * a tag. Skips tags inside fenced code blocks.
 */
export function extractTagsFromContent(content: string): string[] {
  const tags = new Set<string>();
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const body = frontmatterMatch
    ? content.slice(frontmatterMatch[0].length)
    : content;

  // Strip fenced code blocks before scanning inline tags
  const withoutCodeBlocks = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "");

  // Extract frontmatter tags: `tags: [a, b, c]` or `tags:\n  - a`, each by its name — an
  // item spelled `"#solo"` is the tag `solo`.
  if (frontmatterMatch) {
    for (const { value } of frontmatterListItems(frontmatterMatch[1], "tags")) {
      const name = tagName(value).toLowerCase();
      if (name) tags.add(name);
    }
  }

  // Extract inline #tags from body (code blocks already stripped)
  let match: null | RegExpExecArray;
  TAG_PATTERN.lastIndex = 0;
  while ((match = TAG_PATTERN.exec(withoutCodeBlocks)) !== null) {
    tags.add(match[1].toLowerCase());
  }

  return Array.from(tags).sort();
}

/**
 * Filter tags by prefix query, sorted by frequency (most used first).
 * Case-insensitive matching. Supports nested tag path matching:
 * - "proj" matches "project", "project/baram"
 * - "bar" matches "baram", "project/baram" (segment prefix)
 * Returns at most 10 results, prefix matches first.
 */
export function filterTags(
  query: string,
  tagIndex: Map<string, number>,
): string[] {
  const q = query.toLowerCase().replace(/^#/, "");
  if (!q) {
    // Return top 10 by frequency
    return Array.from(tagIndex.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);
  }

  // Split into prefix matches (tag starts with query) and segment matches
  const prefixMatches: [string, number][] = [];
  const segmentMatches: [string, number][] = [];

  for (const [tag, count] of tagIndex) {
    if (tag.startsWith(q)) {
      prefixMatches.push([tag, count]);
    } else if (
      tag.includes("/" + q) ||
      tag.split("/").some((seg) => seg.startsWith(q))
    ) {
      segmentMatches.push([tag, count]);
    }
  }

  // Prefix matches first, then segment matches — both sorted by frequency
  prefixMatches.sort((a, b) => b[1] - a[1]);
  segmentMatches.sort((a, b) => b[1] - a[1]);

  return [...prefixMatches, ...segmentMatches].slice(0, 10).map(([tag]) => tag);
}

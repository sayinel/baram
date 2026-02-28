/**
 * §56l — Tag index and autocomplete utilities for journal captures
 */

/** Pattern matching #tag with word chars and Korean characters */
const TAG_PATTERN = /#([\w가-힣]+)/g;

/**
 * Extract all unique tags from markdown content.
 * Sources: frontmatter `tags: [a, b]` array AND inline `#tagname` in body text.
 * Skips tags inside fenced code blocks.
 */
export function extractTagsFromContent(content: string): string[] {
  const tags = new Set<string>();

  // Strip fenced code blocks before scanning inline tags
  const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");

  // Extract frontmatter tags: `tags: [a, b, c]` or `tags:\n  - a`
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const fm = frontmatterMatch[1];

    // Inline array: tags: [tag1, tag2]
    const inlineArrayMatch = fm.match(/^tags:\s*\[([^\]]*)\]/m);
    if (inlineArrayMatch) {
      inlineArrayMatch[1]
        .split(",")
        .map((t) => t.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
        .forEach((t) => tags.add(t.toLowerCase()));
    } else {
      // Block list: tags:\n  - tag1\n  - tag2
      const blockListMatch = fm.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/m);
      if (blockListMatch) {
        blockListMatch[1]
          .split("\n")
          .map((line) => line.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean)
          .forEach((t) => tags.add(t.toLowerCase()));
      }
    }
  }

  // Extract inline #tags from body (code blocks already stripped)
  let match: RegExpExecArray | null;
  TAG_PATTERN.lastIndex = 0;
  while ((match = TAG_PATTERN.exec(withoutCodeBlocks)) !== null) {
    tags.add(match[1].toLowerCase());
  }

  return Array.from(tags).sort();
}

/**
 * Build a frequency map of tag → count from multiple files.
 */
export function buildTagIndex(
  files: { path: string; content: string }[],
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
 * Filter tags by prefix query, sorted by frequency (most used first).
 * Case-insensitive matching. Returns at most 10 results.
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

  return Array.from(tagIndex.entries())
    .filter(([tag]) => tag.startsWith(q))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);
}

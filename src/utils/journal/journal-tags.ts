/**
 * §56l — Tag index and autocomplete utilities for journal captures
 */

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
 * §56m P2 AI Tag Suggestions — build prompt for tag recommendation.
 */
export function buildTagSuggestionPrompt(
  content: string,
  existingTags: string[],
  vaultTags: string[],
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt =
    "노트 내용을 분석하여 태그 3~5개를 추천합니다. 볼트의 기존 태그를 참고하세요. 쉼표로 구분하여 태그만 출력하세요. # 접두사는 붙이지 마세요.";

  const trimmed = content.trim();
  if (!trimmed) {
    return { systemPrompt, userPrompt: "(내용이 비어 있습니다.)" };
  }

  const existingStr =
    existingTags.length > 0 ? `\n\n기존 태그: ${existingTags.join(", ")}` : "";
  const vaultStr =
    vaultTags.length > 0
      ? `\n\n볼트 태그 (상위 ${Math.min(vaultTags.length, 50)}개): ${vaultTags.slice(0, 50).join(", ")}`
      : "";

  const userPrompt = `다음 노트에 적합한 태그를 추천해주세요.${existingStr}${vaultStr}\n\n---\n\n${trimmed}`;
  return { systemPrompt, userPrompt };
}

/**
 * Extract all unique tags from markdown content.
 * Sources: frontmatter `tags: [a, b]` array AND inline `#tagname` in body text.
 * Skips tags inside fenced code blocks.
 */
export function extractTagsFromContent(content: string): string[] {
  const tags = new Set<string>();

  // Strip fenced code blocks before scanning inline tags
  const withoutCodeBlocks = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "");

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
          .map((line) =>
            line
              .replace(/^\s+-\s+/, "")
              .trim()
              .replace(/^["']|["']$/g, ""),
          )
          .filter(Boolean)
          .forEach((t) => tags.add(t.toLowerCase()));
      }
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

/**
 * §56m P2 AI Tag Suggestions — parse LLM response into tag array.
 * Splits by comma/newline, strips # prefix, deduplicates, excludes existing tags.
 */
export function parseTagSuggestions(
  response: string,
  existingTags: string[],
): string[] {
  const existingSet = new Set(existingTags.map((t) => t.toLowerCase()));

  const tags = response
    .split(/[,\n]+/)
    .map((t) => t.trim().replace(/^#+/, "").trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  // Deduplicate and exclude existing
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    if (!seen.has(tag) && !existingSet.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }

  return result.slice(0, 5);
}

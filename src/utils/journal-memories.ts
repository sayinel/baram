/**
 * §56c — Memories View utility: One Line extraction + Memories data grouping
 */

/** Extract a one-line summary from journal markdown content */
export function extractOneLine(content: string): string {
  if (!content.trim()) return "";

  // 1. Check frontmatter `oneline` field first
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const onelineMatch = fmMatch[1].match(/^oneline:\s*"?([^"\n]+)"?\s*$/m);
    if (onelineMatch) return onelineMatch[1].trim();
  }

  // 2. Strip frontmatter
  const body = fmMatch ? content.slice(fmMatch[0].length).trim() : content.trim();
  if (!body) return "";

  // 3. Try to extract from ## Diary section only (skip Captures)
  const diaryMatch = body.match(/^## Diary\s*$/m);
  let textBlock: string;

  if (diaryMatch) {
    const diaryStart = diaryMatch.index! + diaryMatch[0].length;
    const nextSectionMatch = body.slice(diaryStart).match(/^## /m);
    textBlock = nextSectionMatch
      ? body.slice(diaryStart, diaryStart + nextSectionMatch.index!)
      : body.slice(diaryStart);
  } else {
    // Fallback: full body excluding Captures section
    const capturesMatch = body.match(/^## Captures\s*$/m);
    if (capturesMatch) {
      // Find next section after Captures
      const afterCaptures = body.slice(capturesMatch.index! + capturesMatch[0].length);
      const nextSection = afterCaptures.match(/^## /m);
      if (nextSection) {
        // Use content before Captures + content after Captures section
        const beforeCaptures = body.slice(0, capturesMatch.index!);
        const afterCapturesContent = afterCaptures.slice(nextSection.index!);
        textBlock = beforeCaptures + afterCapturesContent;
      } else {
        textBlock = body.slice(0, capturesMatch.index!);
      }
    } else {
      textBlock = body;
    }
  }

  // 4. Find first meaningful text line (skip headings, empty lines, blockquotes, list items starting with icons)
  const lines = textBlock.split("\n");
  const textLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith(">")) continue;
    if (trimmed.startsWith("- ✦") || trimmed.startsWith("- ↗") || trimmed.startsWith("- ❝") || trimmed.startsWith("- ☰")) continue;
    textLines.push(trimmed);
  }

  if (textLines.length === 0) return "";

  const firstLine = textLines[0];

  // If this is the only text line and contains multiple sentences, extract first sentence
  if (textLines.length === 1) {
    const sentenceMatch = firstLine.match(/^(.+?[.。])\s/);
    if (sentenceMatch) {
      const result = sentenceMatch[1];
      if (result.length > 100) return result.slice(0, 100) + "…";
      return result;
    }
  }

  // Truncate at 100 characters
  if (firstLine.length > 100) {
    return firstLine.slice(0, 100) + "…";
  }
  return firstLine;
}

/** Extract image references from journal markdown content */
export function extractImages(content: string): { alt: string; src: string }[] {
  if (!content.trim()) return [];

  const images: { alt: string; src: string }[] = [];
  // Match ![alt](src) pattern
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    images.push({ alt: match[1], src: match[2] });
  }
  return images;
}

/** Update or insert the `oneline` field in frontmatter */
export function updateOneLineFrontmatter(content: string, newOneLine: string): string {
  const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/);
  if (fmMatch) {
    const fmBody = fmMatch[2];
    const onelineRegex = /^oneline:\s*.*$/m;
    if (onelineRegex.test(fmBody)) {
      // Replace existing oneline
      const updatedBody = fmBody.replace(onelineRegex, `oneline: "${newOneLine}"`);
      return fmMatch[1] + updatedBody + fmMatch[3] + content.slice(fmMatch[0].length);
    } else {
      // Append oneline to existing frontmatter
      return fmMatch[1] + fmBody + `\noneline: "${newOneLine}"` + fmMatch[3] + content.slice(fmMatch[0].length);
    }
  } else {
    // No frontmatter — prepend one
    return `---\noneline: "${newOneLine}"\n---\n${content}`;
  }
}

/** Memory entry for grouping */
export interface MemoryEntry {
  year: number;
  path: string;
  content: string;
}

/** Group memory entries by year in reverse chronological order */
export function groupMemoriesByYear(entries: MemoryEntry[]): MemoryEntry[] {
  if (entries.length === 0) return [];

  return [...entries].sort((a, b) => b.year - a.year);
}

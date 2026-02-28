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

  // 4. Find first meaningful text line (skip headings, empty lines, list items starting with icons)
  const lines = textBlock.split("\n");
  const textLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
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

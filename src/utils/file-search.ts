// §35 Quick Switcher — file search utilities
import type { FileEntry } from "../stores/file-store";

export interface FlatFile {
  name: string;
  path: string;
  /** Relative path from root (e.g. "docs/guide.md") */
  relativePath: string;
}

export interface HeadingEntry {
  level: number;
  text: string;
  /** 1-based line number */
  line: number;
}

/** Directories to exclude from file search results. */
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".svn",
  ".hg",
  ".DS_Store",
]);

/** Flatten nested FileEntry tree into a flat list of files (no directories). */
export function flattenFileTree(
  tree: FileEntry[],
  rootPath: string,
): FlatFile[] {
  const result: FlatFile[] = [];
  const prefix = rootPath.endsWith("/") ? rootPath : rootPath + "/";

  function walk(entries: FileEntry[]) {
    for (const entry of entries) {
      if (entry.isDir) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          walk(entry.children ?? []);
        }
        continue;
      }
      const relativePath = entry.path.startsWith(prefix)
        ? entry.path.slice(prefix.length)
        : entry.name;
      result.push({ name: entry.name, path: entry.path, relativePath });
    }
  }

  walk(tree);
  return result;
}

/** Fuzzy match query against text. Returns true if all characters match in order. */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Score a fuzzy match — lower is better. Returns Infinity if no match.
 * Rewards: consecutive matches, start-of-string, start-of-word (after separator).
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  let qi = 0;
  let score = 0;
  let prevMatchIdx = -2; // -2 so first match at 0 isn't counted as consecutive

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Penalty for gap between matches
      const gap = ti - prevMatchIdx - 1;
      if (gap > 0) score += gap;

      // Bonus for start-of-string or start-of-word
      if (ti === 0) {
        score -= 5;
      } else {
        const prev = t[ti - 1];
        if (prev === "/" || prev === "\\" || prev === "." || prev === "-" || prev === "_" || prev === " ") {
          score -= 3;
        }
      }

      prevMatchIdx = ti;
      qi++;
    }
  }

  if (qi < q.length) return Infinity;
  return score;
}

/** Extract markdown headings from content string. */
export function extractHeadings(markdown: string): HeadingEntry[] {
  if (!markdown) return [];

  const lines = markdown.split("\n");
  const headings: HeadingEntry[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Toggle code fence
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Match ATX headings: # ... ######
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trimEnd(),
        line: i + 1,
      });
    }
  }

  return headings;
}

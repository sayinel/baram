// §35 Quick Switcher — file search utilities
import type { FileEntry } from "../stores/file/file";

import { foldName } from "./name-fold";
import { relativeToRoot } from "./path-utils";

export interface FlatFile {
  name: string;
  path: string;
  /** Relative path from root (e.g. "docs/guide.md") */
  relativePath: string;
}

export interface HeadingEntry {
  level: number;
  /** 1-based line number */
  line: number;
  text: string;
}

/** Directories to exclude from file search results. */
const EXCLUDED_DIRS = new Set([
  ".DS_Store",
  ".git",
  ".hg",
  ".svn",
  "node_modules",
]);

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

/** Flatten nested FileEntry tree into a flat list of files (no directories). */
export function flattenFileTree(
  tree: FileEntry[],
  rootPath: string,
): FlatFile[] {
  const result: FlatFile[] = [];

  function walk(entries: FileEntry[]) {
    for (const entry of entries) {
      if (entry.isDir) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          walk(entry.children ?? []);
        }
        continue;
      }
      // #306: the prefix used to be built by appending "/", so on Windows nothing matched and
      // EVERY result fell back to `entry.name` — losing the directory part of every relative
      // path in file search and the Quick Switcher.
      const relativePath = relativeToRoot(entry.path, rootPath) ?? entry.name;
      result.push({ name: entry.name, path: entry.path, relativePath });
    }
  }

  walk(tree);
  return result;
}

/**
 * Fuzzy match query against text. Returns true if all characters match in order.
 * Both are folded first (`foldName`, §390): matching walks code units, and a
 * name some tool stored decomposed (NFD) spells a syllable in two or three
 * where the query typed composed (NFC) has one.
 */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = foldName(query);
  const t = foldName(text);
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Score a fuzzy match — lower is better. Returns Infinity if no match.
 * Rewards: consecutive matches, start-of-string, start-of-word (after separator).
 * Both are folded first, as in `fuzzyMatch` (§390) — so score each candidate
 * once and sort on the scores; a sort comparator that scores calls this twice
 * per comparison, and each call folds both strings.
 */
export function fuzzyScore(query: string, text: string): number {
  return fuzzyScoreLower(foldName(query), foldName(text));
}

/**
 * `fuzzyScore` for a query and text the caller has ALREADY folded — lowercased
 * (§385 spec 0061 §7), or `foldName`d as `fuzzyScore` does (§390) — so a list
 * of thousands can be folded once when it opens rather than on every keystroke.
 */
export function fuzzyScoreLower(q: string, t: string): number {
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
        if (
          prev === "/" ||
          prev === "\\" ||
          prev === "." ||
          prev === "-" ||
          prev === "_" ||
          prev === " "
        ) {
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

/** Match text against a glob pattern. * matches any characters, ? matches one character. */
export function globMatch(pattern: string, text: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(text);
}

/** Check if query looks like a glob pattern (contains * or ?). */
export function isGlobPattern(query: string): boolean {
  return query.includes("*") || query.includes("?");
}

// §31 Wikilink autocomplete — utility functions
import { fuzzyScore, extractHeadings } from "../../utils/file-search";
import { useFileStore } from "../../stores/file-store";
import { readFile } from "../../ipc/invoke";
import type { HeadingEntry } from "../../utils/file-search";

export interface WikilinkSuggestionItem {
  id: string;
  target: string;
  label: string;
  path: string;
  kind?: "file" | "heading" | "create";
  heading?: string;
  headingLevel?: number;
}

/** Filter and rank files by fuzzy query. Returns sorted results. */
export function filterFiles(
  files: WikilinkSuggestionItem[],
  query: string,
  limit: number = 20,
): WikilinkSuggestionItem[] {
  if (!query) {
    return files.slice(0, limit);
  }

  const scored = files
    .map((file) => ({
      file,
      score: fuzzyScore(query, file.target),
    }))
    .filter(({ score }) => score < Infinity)
    .sort((a, b) => a.score - b.score);

  return scored.slice(0, limit).map(({ file }) => file);
}

/**
 * Load headings from a file. Uses in-memory cache if available, falls back to readFile IPC.
 */
export async function loadFileHeadings(
  filePath: string,
): Promise<HeadingEntry[]> {
  // Check if file content is already cached in openFiles
  const cached = useFileStore.getState().openFiles.get(filePath);
  if (cached !== undefined) {
    return extractHeadings(cached);
  }

  try {
    const content = await readFile(filePath);
    return extractHeadings(content);
  } catch {
    return [];
  }
}

/** Longest common prefix of strings (case-insensitive compare, first item's casing preserved). */
export function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return "";
  if (strings.length === 1) return strings[0];

  const first = strings[0];
  const lowered = strings.map((s) => s.toLowerCase());
  let len = first.length;
  for (let i = 1; i < lowered.length; i++) {
    len = Math.min(len, lowered[i].length);
    for (let j = 0; j < len; j++) {
      if (lowered[0][j] !== lowered[i][j]) {
        len = j;
        break;
      }
    }
    if (len === 0) return "";
  }
  return first.slice(0, len);
}

/** Remove .md or .markdown extension from a filename */
export function fileNameWithoutExtension(name: string): string {
  if (name.endsWith(".markdown")) {
    return name.slice(0, -9);
  }
  if (name.endsWith(".md")) {
    return name.slice(0, -3);
  }
  return name;
}

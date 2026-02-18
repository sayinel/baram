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
export async function loadFileHeadings(filePath: string): Promise<HeadingEntry[]> {
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

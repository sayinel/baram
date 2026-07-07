import type { HeadingEntry } from "../../utils/file-search";

import { readFile } from "../../ipc/invoke";
import { useFileStore } from "../../stores/file/file";
import { titleForId } from "../../stores/zettelkasten/zettel-index";
// §31 Wikilink autocomplete — utility functions
import { extractHeadings, fuzzyScore } from "../../utils/file-search";
import {
  extractLeadingId,
  parseNoteTitle,
} from "../../utils/zettelkasten/parse-note-title";

export interface WikilinkSuggestionItem {
  /** §87 Parent folder path relative to vault root (for grouped display) */
  folder?: string;
  heading?: string;
  headingLevel?: number;
  id: string;
  kind?: "create" | "file" | "folder-header" | "heading" | "hint";
  label: string;
  path: string;
  /**
   * §95 Zettelkasten: fuzzy-search key used instead of `target`, when set.
   * Zettel-note items (id-prefixed filenames) set this to the note title, so
   * `[[` autocomplete searches by title even though `target` is the id.
   */
  searchText?: string;
  target: string;
  /** §87 Cross-vault: vault alias prefix for the inserted wikilink */
  vaultAlias?: string;
}

/**
 * §95 Zettelkasten: build a suggestion item for one file. If the filename has a
 * leading id (12-14 digit prefix), the item's `target` is the id — so the stored
 * wikilink is `[[id]]`, rendered as the title by WikilinkView — and its
 * `searchText` is the note title (from the zettel index, falling back to
 * parsing the filename), so fuzzy search matches by title. Regular
 * (non-zettel) files are unchanged: `target` is the filename, no `searchText`.
 */
export function buildFileSuggestionItem(
  file: { name: string; path: string },
  id: string,
): WikilinkSuggestionItem {
  const zettelId = extractLeadingId(file.name);
  if (zettelId) {
    const title = titleForId(zettelId) ?? parseNoteTitle(file.name, "");
    return {
      id,
      target: zettelId,
      label: title,
      path: file.path,
      searchText: title,
    };
  }
  return {
    id,
    target: fileNameWithoutExtension(file.name),
    label: file.name,
    path: file.path,
  };
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
      score: fuzzyScore(query, file.searchText ?? file.target),
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

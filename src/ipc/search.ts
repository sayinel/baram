// §5.11 Global Search IPC commands
import { invoke } from "@tauri-apps/api/core";

import type { SearchOptions, SearchReplaceTarget, SearchResult } from "./types";

/**
 * §5.11 `content` with the search's matches replaced — matched as `searchFiles` matches, by the
 * same Rust pattern and line by line: every match, or the one that starts where `target` says.
 * Reads and writes no file: the caller writes what comes back.
 */
export async function replaceSearchMatches(
  content: string,
  query: string,
  options: SearchOptions,
  replacement: string,
  target: SearchReplaceTarget,
): Promise<string> {
  return invoke<string>("replace_search_matches", {
    content,
    options,
    query,
    replacement,
    target,
  });
}

export async function searchFiles(
  rootPath: string,
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search_files", { rootPath, query, options });
}

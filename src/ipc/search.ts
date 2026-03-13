// §5.11 Global Search IPC commands
import { invoke } from "@tauri-apps/api/core";

import type { SearchOptions, SearchResult } from "./types";

export async function searchFiles(
  rootPath: string,
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search_files", { rootPath, query, options });
}

// §31 Wikilink autocomplete — utility functions (stub for TDD)

export interface WikilinkSuggestionItem {
  id: string;
  target: string;
  label: string;
  path: string;
}

/** Filter and rank files by fuzzy query. Returns sorted results. */
export function filterFiles(
  _files: WikilinkSuggestionItem[],
  _query: string,
  _limit?: number,
): WikilinkSuggestionItem[] {
  // TODO: implement
  return [];
}

/** Remove .md or .markdown extension from a filename */
export function fileNameWithoutExtension(_name: string): string {
  // TODO: implement
  return "";
}

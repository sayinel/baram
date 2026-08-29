// §35/§56l Quick Switcher — pure query parsing (journal prefix, namespace filter, heading mode)
import type { FlatFile } from "./file-search";

import { isUnderRoot, relativeToRoot } from "./path-utils";

/** §56l Journal prefix filter prefixes */
export type JournalPrefix = "d" | "j" | "n" | null;

/** Parsed Quick Switcher query: journal prefix, namespace filter, file/heading query. */
export interface ParsedQuickSwitcherQuery {
  fileQuery: string;
  headingQuery: null | string;
  nsFilter: string;
  prefix: JournalPrefix;
}

/** Filter a file list by journal prefix against resolvedDir. */
export function filterByJournalPrefix(
  files: FlatFile[],
  prefix: JournalPrefix,
  resolvedDir: string,
): FlatFile[] {
  if (!prefix || !resolvedDir) return files;
  if (prefix === "j") {
    return files.filter((f) => isUnderRoot(f.path, resolvedDir));
  }
  // #306: these were `base + "daily/"` / `base + "notes/"`, broken TWICE on Windows — the
  // appended base separator matched nothing, and even past that a literal `daily/` cannot match
  // `daily\`. Comparing against the normalised relative path removes both. The `n` case is a
  // FOURTH site of this defect, in the same function; the issue listed three.
  const inSubdirectory = (files: FlatFile[], name: string) =>
    files.filter((f) => {
      const relative = relativeToRoot(f.path, resolvedDir);
      return relative !== null && relative.startsWith(`${name}/`);
    });
  if (prefix === "d") return inSubdirectory(files, "daily");
  if (prefix === "n") return inSubdirectory(files, "notes");
  return files;
}

/** Parse a query for journal prefix (n:, d:, j:). Returns prefix and stripped query. */
export function parseJournalPrefix(query: string): {
  prefix: JournalPrefix;
  strippedQuery: string;
} {
  if (/^n:/i.test(query)) {
    return { prefix: "n", strippedQuery: query.slice(2) };
  }
  if (/^d:/i.test(query)) {
    return { prefix: "d", strippedQuery: query.slice(2) };
  }
  if (/^j:/i.test(query)) {
    return { prefix: "j", strippedQuery: query.slice(2) };
  }
  return { prefix: null, strippedQuery: query };
}

/**
 * Parse the full Quick Switcher input: §56l journal prefix first, then §61 namespace
 * filter, then heading mode (`#`).
 */
export function parseQuickSwitcherQuery(
  query: string,
): ParsedQuickSwitcherQuery {
  const { prefix, strippedQuery } = parseJournalPrefix(query);

  // §61 Namespace filter: ns:path/to/ns query
  let nsFilter = "";
  let remainingQuery = strippedQuery;
  const nsMatch = strippedQuery.match(/^ns:(\S*)\s*(.*)/i);
  if (nsMatch) {
    nsFilter = nsMatch[1]; // e.g. "notes/ai"
    remainingQuery = nsMatch[2]; // remaining file query
  }

  const hashIdx = remainingQuery.indexOf("#");
  if (hashIdx === -1) {
    return {
      prefix,
      nsFilter,
      fileQuery: remainingQuery,
      headingQuery: null,
    };
  }
  return {
    prefix,
    nsFilter,
    fileQuery: remainingQuery.slice(0, hashIdx),
    headingQuery: remainingQuery.slice(hashIdx + 1),
  };
}

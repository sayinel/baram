// §4.8 The markdown-string adapter for the canonical prose counter.
//
// Split from `word-count.ts` on purpose: that module is pure policy over a ProseMirror
// document and imports nothing at runtime, which is what lets the plugin host and the
// status bar share it cheaply. Building a Schema means pulling in the whole extension set,
// so the cost lives here, where only the callers that start from a string pay it.
import type { Schema } from "@tiptap/pm/model";

import { getSchema } from "@tiptap/core";

import { createBaramExtensions } from "../extensions";
import { markdownToProsemirror } from "../pipeline/md-to-pm";
import { countDocumentWords } from "./word-count";

/**
 * Built once, on first use.
 *
 * ‼️ This is a real cost, measured rather than assumed: ~0.9 ms per journal-sized entry, so
 * a 365-day full scan spends ~340 ms parsing where the old line-based stripper spent ~3 ms.
 * Paid deliberately — it buys ONE counting policy instead of a second implementation that
 * drifts from the first, and it lands only on `buildFullCache`, which is already an
 * IPC-per-file scan behind a refresh indicator and writes its result to disk. The per-save
 * path (`updateCacheEntry`) parses exactly one entry.
 */
let schema: null | Schema = null;

/** Words of prose in a markdown string, by the same policy the editor's status bar uses. */
export function countMarkdownWords(markdown: string): number {
  schema ??= getSchema(createBaramExtensions());
  return countDocumentWords(markdownToProsemirror(markdown, schema));
}

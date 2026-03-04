// §perf-large-file B1: Web Worker for markdown → mdast parsing
//
// Runs remark-parse + enrichWithEmptyParagraphs off the main thread
// so large files don't freeze the UI during file open.

import { parseMdast, enrichWithEmptyParagraphs } from "./parse-mdast";

interface ParseRequest {
  id: number;
  markdown: string;
}

interface ParseResponse {
  id: number;
  mdast?: unknown;
  error?: string;
}

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  const { id, markdown } = e.data;
  try {
    const mdast = parseMdast(markdown);
    const enriched = enrichWithEmptyParagraphs(mdast, markdown);
    const response: ParseResponse = { id, mdast: enriched };
    self.postMessage(response);
  } catch (err) {
    const response: ParseResponse = { id, error: String(err) };
    self.postMessage(response);
  }
};

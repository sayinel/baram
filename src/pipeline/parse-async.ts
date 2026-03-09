// §perf-large-file B1: Main-thread client for parse Worker
//
// Sends markdown to the Web Worker for parsing and returns a Promise
// that resolves with the enriched mdast tree. Falls back to synchronous
// parsing on the main thread if the Worker fails to load.

import type { Root } from "mdast";
import { parseMdast, enrichWithEmptyParagraphs } from "./parse-mdast";

// ── Worker message protocol ──────────────────────────────────────────

interface ParseResponse {
  id: number;
  mdast?: Root;
  error?: string;
}

// ── Singleton worker ─────────────────────────────────────────────────

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (r: Root) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL("./parse-worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e: MessageEvent<ParseResponse>) => {
        const { id, mdast, error } = e.data;
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        if (error) entry.reject(new Error(error));
        else entry.resolve(mdast as Root);
      };
      worker.onerror = () => {
        workerFailed = true;
        worker = null;
        for (const [, entry] of pending) {
          entry.reject(new Error("Parse worker failed"));
        }
        pending.clear();
      };
    } catch {
      workerFailed = true;
      return null;
    }
  }
  return worker;
}

// ── Synchronous fallback ─────────────────────────────────────────────

function parseMdastSync(markdown: string): Root {
  const mdast = parseMdast(markdown);
  return enrichWithEmptyParagraphs(mdast, markdown);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Parse markdown to enriched mdast tree using a Web Worker.
 * Falls back to synchronous main-thread parsing if the Worker is unavailable.
 */
export function parseMdastAsync(markdown: string): Promise<Root> {
  const w = getWorker();
  if (!w) {
    return Promise.resolve(parseMdastSync(markdown));
  }

  return new Promise<Root>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, markdown });
  }).catch(() => {
    // Per-request fallback if the worker rejects
    return parseMdastSync(markdown);
  });
}

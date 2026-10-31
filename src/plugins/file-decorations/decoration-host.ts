// §395 spec 0074 D14 · D15 · §5.3 — the one place a plugin's file tree call is judged, paced and applied,
// whichever tier made it; the trusted `ctx.ui` (`trusted/ui-api.ts`) calls these functions directly.
// Each plugin has ONE line for its three methods: first called, first applied, so calls made together
// (`Promise.all`) are applied in turn and none is refused for coming early. Two token buckets pace the
// line — `setFileDecorations` and `clearFileDecorations` take from the decoration bucket
// (`DECORATION_BURST` at once, one back per `DECORATION_INTERVAL_MS`), `defineFileIcon` from the icon
// bucket (`ICON_BURST`, one back per `ICON_INTERVAL_MS`). A head whose bucket is empty waits for its
// refill, and nothing behind it passes it. No call is refused for the number of calls: the trusted tier
// could reach the store directly anyway (D14).
//
// What is judged when (plan 0127 P26): the call's own shape when it is made — refused at once; what
// depends on the plugin's state (the path cap, an undefined icon, the icon cap, the SVG's root) when it
// reaches the head and took its token.
import type { PreparedUpdate } from "./validate";

import {
  __resetFileDecorations,
  applyDecorations,
  clearDecorations,
  releaseDecorations,
} from "./file-decoration-store";
import { __resetFileIcons, defineIcon, releaseIcons } from "./icons";
import {
  DECORATION_BURST,
  DECORATION_INTERVAL_MS,
  ICON_BURST,
  ICON_INTERVAL_MS,
} from "./limits";
import { iconCallProblem, prepareUpdates, RELEASED_MESSAGE } from "./validate";

/** One token bucket: what it holds when full, its refill interval, its pending refill, its tokens. */
interface Bucket {
  burst: number;
  interval: number;
  refill: null | ReturnType<typeof setTimeout>;
  tokens: number;
}

type BucketName = "decorations" | "icons";

/** One plugin's line: its two buckets and the calls waiting, head first. */
interface Line {
  buckets: Record<BucketName, Bucket>;
  queue: Waiting[];
}

/** A call in line: its bucket, what applying it does (the refusal's sentence, or `null`), and its promise. */
interface Waiting {
  bucket: BucketName;
  reject: (error: Error) => void;
  resolve: () => void;
  run: () => null | string;
}

const lines = new Map<string, Line>();

/** Tests only — drop every line (its waiting calls are rejected), every decoration and every icon. */
export function __resetDecorationHost(): void {
  for (const pluginId of [...lines.keys()]) dropLine(pluginId);
  __resetFileDecorations();
  __resetFileIcons();
}

/** D15 — `clearFileDecorations`: every decoration of `pluginId` goes, its icons stay. */
export function clearFileDecorationsFor(pluginId: string): Promise<void> {
  return enqueue(pluginId, "decorations", () => {
    clearDecorations(pluginId);
    return null;
  });
}

/** D6 — `defineFileIcon(name, svg)`: the name and the size are judged now, the SVG when applied. */
export function defineFileIconFor(
  pluginId: string,
  name: unknown,
  svg: unknown,
): Promise<void> {
  const problem = iconCallProblem(name, svg);
  if (problem !== null) return Promise.reject(new Error(problem));
  return enqueue(pluginId, "icons", () =>
    defineIcon(pluginId, name as string, svg as string),
  );
}

/** D15 — the plugin is unloaded: its waiting calls are rejected, its decorations, icons and rules go. */
export function releaseFileTree(pluginId: string): void {
  dropLine(pluginId);
  releaseDecorations(pluginId);
  releaseIcons(pluginId);
}

/**
 * D2 · D14 — `setFileDecorations(updates)`. `label` is the plugin's source label (`pluginSourceLabel`),
 * which the row's hover text shows; `locate` reads one update's path fields into an absolute path.
 */
export function setFileDecorationsFor(
  pluginId: string,
  label: string,
  raw: unknown,
  locate: (
    item: Readonly<Record<string, unknown>>,
  ) => string | { absolute: string },
): Promise<void> {
  const prepared: PreparedUpdate<{ absolute: string }>[] | string =
    prepareUpdates(raw, locate);
  if (typeof prepared === "string") return Promise.reject(new Error(prepared));
  return enqueue(pluginId, "decorations", () =>
    applyDecorations(pluginId, label, prepared),
  );
}

/** Forget `pluginId`'s line: stop its refills and reject what waits in it (§6). */
function dropLine(pluginId: string): void {
  const line = lines.get(pluginId);
  if (line === undefined) return;
  lines.delete(pluginId);
  for (const bucket of Object.values(line.buckets)) {
    if (bucket.refill !== null) clearTimeout(bucket.refill);
  }
  for (const waiting of line.queue.splice(0)) {
    waiting.reject(new Error(RELEASED_MESSAGE));
  }
}

/** Put a call at the end of `pluginId`'s line and move the line. */
function enqueue(
  pluginId: string,
  bucket: BucketName,
  run: () => null | string,
): Promise<void> {
  const line = lines.get(pluginId) ?? newLine(pluginId);
  return new Promise<void>((resolve, reject) => {
    line.queue.push({ bucket, reject, resolve, run });
    pump(pluginId, line);
  });
}

function newLine(pluginId: string): Line {
  const line: Line = {
    buckets: {
      decorations: {
        burst: DECORATION_BURST,
        interval: DECORATION_INTERVAL_MS,
        refill: null,
        tokens: DECORATION_BURST,
      },
      icons: {
        burst: ICON_BURST,
        interval: ICON_INTERVAL_MS,
        refill: null,
        tokens: ICON_BURST,
      },
    },
    queue: [],
  };
  lines.set(pluginId, line);
  return line;
}

/** Apply calls from the head while the head's bucket holds a token; an empty bucket stops the line. */
function pump(pluginId: string, line: Line): void {
  while (line.queue.length > 0) {
    const head = line.queue[0];
    const bucket = line.buckets[head.bucket];
    if (bucket.tokens === 0) return;
    bucket.tokens -= 1;
    startRefill(pluginId, line, bucket);
    line.queue.shift();
    // A throw (the sanitizer's, or the `URIError` of a lone surrogate) rejects this call only: it left
    // the queue and spent its token above, so the loop goes on to the call behind it.
    try {
      const problem = head.run();
      if (problem === null) head.resolve();
      else head.reject(new Error(problem));
    } catch (error) {
      head.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

/**
 * Earn `bucket` one call back per interval until it is full. This timer is a rate limit's refill (D14):
 * the call it lets through was refused nothing and kept its place in line — it waited its turn. It
 * holds no state back.
 */
function startRefill(pluginId: string, line: Line, bucket: Bucket): void {
  if (bucket.refill !== null) return;
  bucket.refill = setTimeout(() => {
    bucket.refill = null;
    if (lines.get(pluginId) !== line) return;
    bucket.tokens = Math.min(bucket.burst, bucket.tokens + 1);
    if (bucket.tokens < bucket.burst) startRefill(pluginId, line, bucket);
    pump(pluginId, line);
  }, bucket.interval);
}

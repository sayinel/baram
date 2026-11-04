// §394 spec 0073 D7 — asking a plugin to draw a block. The cache (a byte-bounded LRU keyed by plugin
// id, plugin version, language, context, note path and the source's hash), the per-plugin
// concurrency and timeout, the epochs that make an answer from before an `invalidate`, an unload or
// a disable worthless, and the coalesced redraw notice the views listen to. Both tiers come through
// here; `binding.render` is the trusted function itself or the sandboxed proxy (Task 11). Counted
// in its tests, never timed.

import type { CodeBlockInfo, CodeBlockRenderer } from "../types";
import type { DrawableContent } from "./rendered-body";

import { logger } from "../../utils/logger";
import { withTimeout } from "../../utils/with-timeout";
import { sanitizePluginText } from "../plugin-text";
import { prepareDrawable, refusedCssMessage } from "./drawable";
import {
  INVALIDATE_COALESCE_MS,
  MAX_RENDER_ERROR_CHARS,
  RENDER_CACHE_BYTES,
  RENDER_CONCURRENCY,
  RENDER_TIMEOUT_MS,
} from "./limits";
import { PluginCssError } from "./sanitize-css";

/** What one request comes to. `stale`: the plugin's epoch moved while it ran — draw nothing. */
export type RenderOutcome =
  | { content: DrawableContent; kind: "drawn" }
  | { kind: "failed"; message: string }
  | { kind: "stale" };

interface CacheEntry {
  bytes: number;
  content: DrawableContent;
  lang: string;
  pluginId: string;
}

/**
 * What the queue reads of a binding — a `RendererBinding` (`code-block-registry.ts`) is one. A type
 * of its own rather than an import: the registry calls into this module (`forgetLangRenders`), and
 * `madge --circular` counts a type import as an edge.
 */
interface RenderTarget {
  lang: string;
  pluginId: string;
  render: CodeBlockRenderer;
  version: string;
}

/** The numbers, from `limits.ts`. */
const DEFAULTS = {
  cacheBytes: RENDER_CACHE_BYTES,
  coalesceMs: INVALIDATE_COALESCE_MS,
  concurrency: RENDER_CONCURRENCY,
  timeoutMs: RENDER_TIMEOUT_MS,
};

/** What the queue runs on — `DEFAULTS` unless a test replaced some (`__configureRenderQueue`). */
const settings = { ...DEFAULTS };

const cache = new Map<string, CacheEntry>();
let cacheTotal = 0;
/** In-flight renders by cache key AND epoch, so a request after an `invalidate` starts its own. */
const inflight = new Map<string, Promise<RenderOutcome>>();
const slots = new Map<string, { active: number; waiting: Array<() => void> }>();
const pluginEpochs = new Map<string, number>();
const langEpochs = new Map<string, number>();
const notices = new Map<
  string,
  { langs: null | Set<string>; timer: ReturnType<typeof setTimeout> }
>();
const invalidationListeners = new Set<
  (pluginId: string, langs: null | ReadonlySet<string>) => void
>();

/** Test-only: replace numbers from `limits.ts`. */
export function __configureRenderQueue(
  overrides: Partial<typeof DEFAULTS>,
): void {
  Object.assign(settings, overrides);
}

/** Test-only: forget everything and restore the numbers. */
export function __resetRenderQueue(): void {
  for (const notice of notices.values()) clearTimeout(notice.timer);
  cache.clear();
  cacheTotal = 0;
  inflight.clear();
  slots.clear();
  pluginEpochs.clear();
  langEpochs.clear();
  notices.clear();
  invalidationListeners.clear();
  Object.assign(settings, DEFAULTS);
}

/**
 * Deliver every pending `invalidate` notice now rather than when its `coalesceMs` runs out (D12 ·
 * plan 0125 final review carry 37). Export's settle calls this before it reads which blocks are
 * done: an `invalidate` moves the epoch at once, but a block hears of it only through the notice,
 * and until then it still reads `done` — the export would write the drawing from before it.
 */
export function flushInvalidationNotices(): void {
  for (const pluginId of [...notices.keys()]) deliverNotice(pluginId);
}

/**
 * A renderer bound to `lang`, or unbound (D6 · D7): the language's epoch moves and its cache entries
 * go, with no notice — the registry's own change rebuilds the blocks. The cache key holds no
 * renderer, so without this a renderer registered again would be served the previous one's answers.
 */
export function forgetLangRenders(pluginId: string, lang: string): void {
  const key = langKey(pluginId, lang);
  langEpochs.set(key, (langEpochs.get(key) ?? 0) + 1);
  dropCache((entry) => entry.pluginId === pluginId && entry.lang === lang);
}

/**
 * Unload, Reload or disable of `pluginId` (D7): its epoch moves — an answer still in flight is
 * dropped and not cached, and a request still waiting calls nothing — its cache entries go, and a
 * pending notice is cancelled (the registry's own change rebuilds its blocks).
 */
export function forgetPluginRenders(pluginId: string): void {
  movePluginEpoch(pluginId);
  const notice = notices.get(pluginId);
  if (notice !== undefined) {
    clearTimeout(notice.timer);
    notices.delete(pluginId);
  }
}

/**
 * `ctx.codeBlocks.invalidate` (D7): the epoch moves now and the cache entries go now; the views hear
 * one notice per `coalesceMs` per plugin, or sooner when export flushes it
 * (`flushInvalidationNotices`) — visible blocks draw again, the rest are marked stale.
 * `lang` omitted means every language of the plugin.
 */
export function invalidateRenders(pluginId: string, lang?: string): void {
  if (lang === undefined) movePluginEpoch(pluginId);
  else forgetLangRenders(pluginId, lang);
  const pending = notices.get(pluginId);
  if (pending !== undefined) {
    if (lang === undefined) pending.langs = null;
    else pending.langs?.add(lang);
    return;
  }
  notices.set(pluginId, {
    langs: lang === undefined ? null : new Set([lang]),
    timer: setTimeout(() => deliverNotice(pluginId), settings.coalesceMs),
  });
}

/** Hear coalesced `invalidate` notices: `langs` is `null` for "every language". */
export function onRendersInvalidated(
  listener: (pluginId: string, langs: null | ReadonlySet<string>) => void,
): () => void {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}

/**
 * Ask `binding` to draw `source` for the block `info` describes: from the cache, from a render of
 * the same key already in flight, or by calling the renderer under the plugin's concurrency limit
 * and the timeout. A result is checked and sanitized (`prepareDrawable`, `drawable.ts`) and cached; a failure is
 * a fixed sentence or the renderer's own message, flattened and capped (§6). The request belongs to
 * the epoch in force when it is MADE (D7): when that epoch moves before the renderer is called — while
 * the source is hashed, or while the request waits for a slot — it calls nothing and comes back
 * `stale`. It never rejects: a throw comes back `failed`, except the renderer's own throw or its
 * timeout when the epoch moved meanwhile, which comes back `stale` (`render`'s `catch`).
 */
export async function requestRender(
  binding: RenderTarget,
  source: string,
  info: CodeBlockInfo,
): Promise<RenderOutcome> {
  try {
    // Read before the first `await`: the epoch of the moment the request is made.
    const epoch = epochOf(binding);
    return await outcomeOf(binding, source, info, epoch);
  } catch (err) {
    logger.error(`[PluginBlock] ${binding.pluginId} ${binding.lang}:`, err);
    return { kind: "failed", message: "the block could not be drawn" };
  }
}

async function cacheKey(
  binding: RenderTarget,
  source: string,
  info: CodeBlockInfo,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return [
    binding.pluginId,
    binding.version,
    binding.lang,
    info.context ?? "",
    info.path ?? "",
    hash,
  ].join("\u0000");
}

/** `pluginId`'s pending notice, if any, to every listener — its timer cleared, so it comes once. */
function deliverNotice(pluginId: string): void {
  const notice = notices.get(pluginId);
  if (notice === undefined) return;
  clearTimeout(notice.timer);
  notices.delete(pluginId);
  for (const listener of [...invalidationListeners]) {
    listener(pluginId, notice.langs);
  }
}

function dropCache(match: (entry: CacheEntry) => boolean): void {
  for (const [key, entry] of cache) {
    if (!match(entry)) continue;
    cache.delete(key);
    cacheTotal -= entry.bytes;
  }
}

function epochOf(binding: RenderTarget): string {
  return `${pluginEpochs.get(binding.pluginId) ?? 0}:${langEpochs.get(langKey(binding.pluginId, binding.lang)) ?? 0}`;
}

/**
 * A thrown value's message for the block's chrome, flattened and capped (D10): the renderer's own,
 * or the markup sanitizer's node cap; without one (`thrownMessage` gave `null`), a fixed sentence.
 */
function failureText(message: null | string): string {
  return (
    (message === null
      ? ""
      : sanitizePluginText(message, MAX_RENDER_ERROR_CHARS)) ||
    "the renderer failed"
  );
}

function langKey(pluginId: string, lang: string): string {
  return `${pluginId}\u0000${lang}`;
}

function movePluginEpoch(pluginId: string): void {
  pluginEpochs.set(pluginId, (pluginEpochs.get(pluginId) ?? 0) + 1);
  dropCache((entry) => entry.pluginId === pluginId);
}

/**
 * `requestRender` past its epoch read: the digest, the epoch check after it, the cache, the
 * in-flight render of the same key and epoch, or a new one. May throw — `requestRender` turns that
 * into an outcome.
 */
async function outcomeOf(
  binding: RenderTarget,
  source: string,
  info: CodeBlockInfo,
  epoch: string,
): Promise<RenderOutcome> {
  const key = await cacheKey(binding, source, info);
  if (epochOf(binding) !== epoch) return { kind: "stale" };
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return { content: hit.content, kind: "drawn" };
  }
  const runningKey = `${key}\u0000${epoch}`;
  const running = inflight.get(runningKey);
  if (running !== undefined) return running;
  const started = render(binding, source, info, key, epoch);
  inflight.set(runningKey, started);
  const settle = () => {
    if (inflight.get(runningKey) === started) inflight.delete(runningKey);
  };
  void started.then(settle, settle);
  return started;
}

/** Keep `entry` under `key`, dropping the least recently used entries past the byte cap. */
function remember(key: string, entry: CacheEntry): void {
  const old = cache.get(key);
  if (old !== undefined) {
    cache.delete(key);
    cacheTotal -= old.bytes;
  }
  if (entry.bytes > settings.cacheBytes) return;
  cache.set(key, entry);
  cacheTotal += entry.bytes;
  for (const [oldest, dropped] of cache) {
    if (cacheTotal <= settings.cacheBytes) break;
    cache.delete(oldest);
    cacheTotal -= dropped.bytes;
  }
}

async function render(
  binding: RenderTarget,
  source: string,
  info: CodeBlockInfo,
  key: string,
  epoch: string,
): Promise<RenderOutcome> {
  // The timeout's own message, fixed for this request — how the `catch` below tells it from a
  // renderer's throw. A renderer that throws this very sentence is shown the same sentence.
  const timeoutMs = settings.timeoutMs;
  const timedOut = `the renderer did not answer in ${timeoutMs / 1000} s`;
  let raw: unknown;
  try {
    raw = await withSlot(binding.pluginId, () =>
      // D7 — a request that waited for its slot through an epoch move calls nothing; the check
      // below the `try` then reads it as stale (epochs only count up — the test-only
      // `__resetRenderQueue` is the one place that clears them).
      epochOf(binding) !== epoch
        ? Promise.resolve(undefined)
        : // D7 — only the promise races the timer: a synchronous trusted renderer runs to its end
          // before the timer can fire, and nothing here can interrupt it.
          withTimeout(
            Promise.resolve().then(() => binding.render(source, info)),
            timeoutMs,
            timedOut,
          ),
    );
  } catch (err) {
    if (epochOf(binding) !== epoch) return { kind: "stale" };
    const message = thrownMessage(err);
    return {
      kind: "failed",
      message: message === timedOut ? timedOut : failureText(message),
    };
  }
  if (epochOf(binding) !== epoch) return { kind: "stale" };
  let drawable: ReturnType<typeof prepareDrawable>;
  try {
    drawable = prepareDrawable(
      `[PluginBlock] ${binding.pluginId} ${binding.lang}`,
      raw,
    );
  } catch (err) {
    return {
      kind: "failed",
      message:
        err instanceof PluginCssError
          ? refusedCssMessage(err)
          : failureText(thrownMessage(err)),
    };
  }
  if (typeof drawable === "string") {
    return { kind: "failed", message: drawable };
  }
  remember(key, {
    bytes: drawable.bytes,
    content: drawable.content,
    lang: binding.lang,
    pluginId: binding.pluginId,
  });
  return { content: drawable.content, kind: "drawn" };
}

/**
 * A thrown value's message, or `null` when it gives no string — read guarded, since a trusted
 * renderer's `Error` may carry a `message` getter that throws.
 */
function thrownMessage(err: unknown): null | string {
  try {
    const message = err instanceof Error ? err.message : err;
    return typeof message === "string" ? message : null;
  } catch {
    return null;
  }
}

/**
 * Run under `pluginId`'s concurrency limit. A finishing render hands its slot straight to the next
 * waiter, so a new request can never slip in between and make it `concurrency + 1`. A timeout ends
 * `run` and so frees the slot, while the renderer itself may still be running.
 */
async function withSlot<T>(
  pluginId: string,
  run: () => Promise<T>,
): Promise<T> {
  const state = slots.get(pluginId) ?? { active: 0, waiting: [] };
  slots.set(pluginId, state);
  if (state.active < settings.concurrency) state.active += 1;
  else await new Promise<void>((resolve) => state.waiting.push(resolve));
  try {
    return await run();
  } finally {
    const next = state.waiting.shift();
    if (next !== undefined) next();
    else state.active -= 1;
  }
}

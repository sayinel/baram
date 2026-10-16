// §394 spec 0073 D7 — asking a plugin to draw a block. The cache (a byte-bounded LRU keyed by plugin
// id, plugin version, language, context, note path and the source's hash), the per-plugin
// concurrency and timeout, the epochs that make an answer from before an `invalidate`, an unload or
// a disable worthless, and the coalesced redraw notice the views listen to. Both tiers come through
// here; `binding.render` is the trusted function itself or the sandboxed proxy (Task 11). Counted
// in its tests, never timed.

import type { CodeBlockInfo } from "../types";
import type { RendererBinding } from "./code-block-registry";
import type { DrawableContent } from "./rendered-body";

import { logger } from "../../utils/logger";
import { withTimeout } from "../../utils/with-timeout";
import { sanitizePluginText } from "../plugin-text";
import {
  INVALIDATE_COALESCE_MS,
  MAX_RENDER_ERROR_CHARS,
  RENDER_CACHE_BYTES,
  RENDER_CONCURRENCY,
  RENDER_TIMEOUT_MS,
  renderedContentProblem,
  utf8Bytes,
} from "./limits";
import { PluginCssError, sanitizePluginCss } from "./sanitize-css";
import { sanitizePluginMarkup } from "./sanitize-markup";

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
 * Unload, Reload or disable of `pluginId` (D7): its epoch moves — an answer still in flight is
 * dropped and not cached — its cache entries go, and a pending notice is cancelled (the registry's
 * own change rebuilds its blocks).
 */
export function forgetPluginRenders(pluginId: string): void {
  pluginEpochs.set(pluginId, (pluginEpochs.get(pluginId) ?? 0) + 1);
  dropCache((entry) => entry.pluginId === pluginId);
  const notice = notices.get(pluginId);
  if (notice !== undefined) {
    clearTimeout(notice.timer);
    notices.delete(pluginId);
  }
}

/**
 * `ctx.codeBlocks.invalidate` (D7): the epoch moves now and the cache entries go now; the views hear
 * one notice per `coalesceMs` per plugin — visible blocks draw again, the rest are marked stale.
 * `lang` omitted means every language of the plugin.
 */
export function invalidateRenders(pluginId: string, lang?: string): void {
  if (lang === undefined) {
    pluginEpochs.set(pluginId, (pluginEpochs.get(pluginId) ?? 0) + 1);
  } else {
    const key = langKey(pluginId, lang);
    langEpochs.set(key, (langEpochs.get(key) ?? 0) + 1);
  }
  dropCache(
    (entry) =>
      entry.pluginId === pluginId &&
      (lang === undefined || entry.lang === lang),
  );
  const pending = notices.get(pluginId);
  if (pending !== undefined) {
    if (lang === undefined) pending.langs = null;
    else pending.langs?.add(lang);
    return;
  }
  const notice = {
    langs: lang === undefined ? null : new Set([lang]),
    timer: setTimeout(() => {
      notices.delete(pluginId);
      for (const listener of [...invalidationListeners]) {
        listener(pluginId, notice.langs);
      }
    }, settings.coalesceMs),
  };
  notices.set(pluginId, notice);
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
 * and the timeout. A result is checked (`renderedContentProblem`), sanitized and cached; a failure is
 * a fixed sentence or the renderer's own message, flattened and capped (§6). A renderer that throws,
 * times out, or answers with something `renderedContentProblem` or a sanitizer refuses gets an
 * outcome — `failed`, or `stale` when its epoch moved meanwhile — not a rejection.
 */
export async function requestRender(
  binding: RendererBinding,
  source: string,
  info: CodeBlockInfo,
): Promise<RenderOutcome> {
  const key = await cacheKey(binding, source, info);
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return { content: hit.content, kind: "drawn" };
  }
  const epoch = epochOf(binding);
  const runningKey = `${key}\u0000${epoch}`;
  const running = inflight.get(runningKey);
  if (running !== undefined) return running;
  const started = render(binding, source, info, key, epoch);
  inflight.set(runningKey, started);
  void started.finally(() => {
    if (inflight.get(runningKey) === started) inflight.delete(runningKey);
  });
  return started;
}

async function cacheKey(
  binding: RendererBinding,
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

function dropCache(match: (entry: CacheEntry) => boolean): void {
  for (const [key, entry] of cache) {
    if (!match(entry)) continue;
    cache.delete(key);
    cacheTotal -= entry.bytes;
  }
}

function epochOf(binding: RendererBinding): string {
  return `${pluginEpochs.get(binding.pluginId) ?? 0}:${langEpochs.get(langKey(binding.pluginId, binding.lang)) ?? 0}`;
}

/**
 * A thrown value's text for the block's chrome, flattened and capped (D10): the renderer's own
 * message, or the markup sanitizer's node cap; a throw without a string message reads as a fixed
 * sentence.
 */
function failureText(err: unknown): string {
  const raw = err instanceof Error ? err.message : err;
  return (
    (typeof raw === "string"
      ? sanitizePluginText(raw, MAX_RENDER_ERROR_CHARS)
      : "") || "the renderer failed"
  );
}

function langKey(pluginId: string, lang: string): string {
  return `${pluginId}\u0000${lang}`;
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
  binding: RendererBinding,
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
      // D7 — only the promise races the timer: a synchronous trusted renderer runs to its end
      // before the timer can fire, and nothing here can interrupt it.
      withTimeout(
        Promise.resolve().then(() => binding.render(source, info)),
        timeoutMs,
        timedOut,
      ),
    );
  } catch (err) {
    if (epochOf(binding) !== epoch) return { kind: "stale" };
    const timeout = err instanceof Error && err.message === timedOut;
    return { kind: "failed", message: timeout ? timedOut : failureText(err) };
  }
  if (epochOf(binding) !== epoch) return { kind: "stale" };
  let drawable: ReturnType<typeof toDrawable>;
  try {
    drawable = toDrawable(binding, raw);
  } catch (err) {
    return {
      kind: "failed",
      message:
        err instanceof PluginCssError
          ? `rendered CSS was refused (${err.code})`
          : failureText(err),
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
 * A renderer's answer as the host may draw it, with its size for the cache — or the fixed sentence
 * of `renderedContentProblem` (§6). Throws what the sanitizers throw: a `PluginCssError` for refused
 * CSS (plan 0125 P9), an `Error` over the node cap. Each field is read once, so the value checked is
 * the value drawn.
 */
function toDrawable(
  binding: RendererBinding,
  raw: unknown,
): string | { bytes: number; content: DrawableContent } {
  const answer: { css?: unknown; html?: unknown } =
    typeof raw === "object" && raw !== null ? raw : {};
  const { css, html } = answer;
  const problem = renderedContentProblem({ css, html });
  if (problem !== null) return problem;
  // `renderedContentProblem` passed: `html` is a string, `css` a string or absent.
  const markupText = html as string;
  const cssText = (css as string | undefined) ?? "";
  const markup = sanitizePluginMarkup(markupText);
  if (import.meta.env.DEV && markup.removed > 0) {
    // A lower bound (`SanitizedMarkup.removed`), so the line says "at least".
    logger.debug(
      `[PluginBlock] ${binding.pluginId} ${binding.lang}: the sanitizer removed at least ${markup.removed}`,
    );
  }
  return {
    bytes: utf8Bytes(markupText) + utf8Bytes(cssText),
    content: {
      css: cssText === "" ? "" : sanitizePluginCss(cssText),
      fragment: markup.fragment,
    },
  };
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

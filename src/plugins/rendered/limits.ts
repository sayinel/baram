// §394 spec 0073 §11 — the numbers the plugin-rendered areas run on, in one place (plan 0125 P3).
// Each is a starting value; the task that owns it measures it and ledger 0095 records the run —
// change a value here and the committed tests follow it, because they import it. Two are not in
// ledger 0095: `PANEL_UPDATE_BURST` is a ruling (plan 0126 P34), and `PANEL_UPDATE_INTERVAL_MS` is
// measured by plan 0126's ledger 0096.
//
// ‼️ A leaf with no imports: the sandbox realm imports this (`sandbox/sandbox-code-blocks.ts`,
// added by plan 0125 Task 11, and `sandbox/sandbox-ui.ts`, plan 0126 Task 7) to check a result or a
// panel's content before sending it, and that realm must not reach a store.

/** D13 — HTML of one result, in UTF-8 bytes. */
export const MAX_RENDERED_HTML_BYTES = 1024 * 1024;

/** D13 — CSS of one result, in UTF-8 bytes. */
export const MAX_RENDERED_CSS_BYTES = 64 * 1024;

/**
 * D8 ⑤ — element and text nodes the sanitized fragment may hold. Judged by the host only: a
 * sandbox cannot know what survives sanitizing, so its pre-send check is bytes alone (§6).
 * Sized so a 1,000-row table fits twice over: a `<tr>` of four cells holding a link, two texts
 * and a button is 11 nodes (the link's and the button's text included), so 1,000 rows are 11,002
 * with `<table>` and `<tbody>` (measured, plan 0125 Task 3).
 */
export const MAX_RENDERED_NODES = 30_000;

/** D10 — a rendered block's body scrolls past this height (CSS px). */
export const RENDERED_BLOCK_MAX_HEIGHT_PX = 600;

/** D7 — the render cache's total, in UTF-8 bytes of html + css. */
export const RENDER_CACHE_BYTES = 16 * 1024 * 1024;

/** D7 — renders one plugin may have in flight. */
export const RENDER_CONCURRENCY = 2;

/** D7 — one render; a timeout frees its concurrency slot. */
export const RENDER_TIMEOUT_MS = 10_000;

/** D7 — a source edit settles this long before the block draws again. */
export const SOURCE_DEBOUNCE_MS = 300;

/** D7 — `invalidate` calls of one plugin within this window become one redraw. */
export const INVALIDATE_COALESCE_MS = 250;

/**
 * D14 — "four a second": a sandboxed panel's update interval — the least time between two draws of
 * one panel while its view stays mounted (`panel-painter.ts`) and between the starts of two
 * `ui_set_panel` requests a sandbox sends for it (`sandbox-ui.ts`), and the refill of the host's
 * acceptance bucket, one token per interval (`host-ui-bridge.ts`, plan 0126 P34). Plan 0126 Task 4
 * measured a 1,000-row panel's draw against it (ledger 0096).
 */
export const PANEL_UPDATE_INTERVAL_MS = 250;

/**
 * D14 · plan 0126 P34 — the tokens a panel's acceptance bucket holds: the `ui_set_panel` requests the
 * host takes at once before `PANEL_UPDATE_INTERVAL_MS` paces them. Room for delivery jitter around a
 * client that sends one per interval.
 */
export const PANEL_UPDATE_BURST = 8;

/**
 * D13 — a `renderCodeBlock` frame carries the source inline while the whole serialized frame is
 * at most this many UTF-8 bytes; above it the sandbox pulls the source (`render_get_source`). A
 * margin under tauri's 8,192-byte direct-delivery threshold (`MAX_JSON_DIRECT_EXECUTE_THRESHOLD`
 * in tauri 2.12.1 `ipc/channel.rs`), because the host counts `JSON.stringify` + UTF-8 and Rust
 * counts its own serde_json output. Plan 0125 Task 11 measured the two on five frames — ASCII,
 * Hangul, emoji, control-character escapes, and U+2028 · U+2029 · DEL — and got the same count
 * on each, so the 1 KiB margin is left for fields a frame may gain, not for a counting difference.
 */
export const INLINE_SOURCE_MAX_FRAME_BYTES = 7 * 1024;

/** D11 ③ — a `data-action` value, in UTF-16 units. A longer one is not dispatched. */
export const MAX_ACTION_CHARS = 64;

/**
 * D13 — an id the sandbox sends back, in UTF-16 units: a render's (`renderResult`,
 * `render_get_source`) or an action's (`actionResult`). The host mints the ids (`render-<n>`,
 * `action-<n>`), so this only bounds what a sandbox may echo.
 */
export const MAX_FRAME_ID_CHARS = 64;

/**
 * D14 — the longest panel id a manifest may declare, in UTF-16 units: `MAX_CONTRIBUTION_ID_CHARS`
 * (`manifest.ts`), the bound on every contribution id, a pair `manifest-panels.test.ts` holds
 * together. Here so the frame check `isSetPanel` can read it — `manifest.ts` reaches the editor's
 * language list (`manifest-code-blocks.ts`), and the sandbox realm imports that check's module.
 */
export const MAX_PANEL_ID_CHARS = 64;

/**
 * D5 — the longest fenced language a manifest may declare: what `CODE_BLOCK_LANG`
 * (`manifest-code-blocks.ts`) admits, a pair `tauri-host-transport.test.ts` holds together. Here
 * so the sandbox realm's frame checks can read it — that module reaches the editor's language list.
 */
export const MAX_CODE_BLOCK_LANG_CHARS = 32;

/** D10 — the renderer's own error text in a block's chrome (`sanitizePluginText` cap). */
export const MAX_RENDER_ERROR_CHARS = 200;

/** A lone surrogate only — in `u` mode a pair is one code point (the rule `prompt-shape.ts` uses). */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/** UTF-8 length of `text`. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Why a renderer's result cannot be drawn, or `null` (spec §6): the wrong shape, a byte cap, or a
 * lone surrogate (Rust's `serde_json::Value` refuses one, so a sandboxed frame carrying it would
 * vanish). The host checks every result; the sandbox checks before sending, with the same text.
 */
export function renderedContentProblem(content: {
  css?: unknown;
  html: unknown;
}): null | string {
  if (
    typeof content.html !== "string" ||
    (content.css !== undefined && typeof content.css !== "string")
  ) {
    return "a renderer must return { html: string, css?: string }";
  }
  if (utf8Bytes(content.html) > MAX_RENDERED_HTML_BYTES) {
    return `rendered output exceeds ${MAX_RENDERED_HTML_BYTES} bytes of HTML`;
  }
  if (
    content.css !== undefined &&
    utf8Bytes(content.css) > MAX_RENDERED_CSS_BYTES
  ) {
    return `rendered output exceeds ${MAX_RENDERED_CSS_BYTES} bytes of CSS`;
  }
  if (
    LONE_SURROGATE.test(content.html) ||
    (content.css !== undefined && LONE_SURROGATE.test(content.css))
  ) {
    return "rendered output holds a lone surrogate, which Baram's IPC cannot carry";
  }
  return null;
}

/**
 * `raw` — a renderer's answer, or the content a plugin hands `setPanel` — as the content it names, or
 * the fixed sentence of `renderedContentProblem` when it cannot be drawn; anything but an object meets
 * the wrong-shape sentence. Each field is read once, so the value checked is the value used: a getter
 * cannot pass the check with one string and be sent or drawn with another. `css` is absent when
 * `raw`'s is. The host reads a result with it before sanitizing (`prepareDrawable`) and the sandbox
 * before sending one, so the two sides judge one reading alike.
 */
export function readRenderedContent(
  raw: unknown,
): string | { css?: string; html: string } {
  const { css, html }: { css?: unknown; html?: unknown } =
    typeof raw === "object" && raw !== null ? raw : {};
  const problem = renderedContentProblem({ css, html });
  if (problem !== null) return problem;
  // `renderedContentProblem` passed: `html` is a string, `css` a string or absent.
  return css === undefined
    ? { html: html as string }
    : { css: css as string, html: html as string };
}

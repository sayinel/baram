// §394 spec 0073 D8 · D9 · §7 "계획 B" — a plugin's result made drawable. Both plugin-rendered areas
// draw through it — a code block's render (`render-queue.ts`) and a sandboxed panel's painter
// (`panel-painter.ts`) — and, outside tests, it is the only caller of the two sanitizers
// (`sanitize-markup.ts`, `sanitize-css.ts`). Moved out of `render-queue.ts` (`toDrawable`) by plan 0126
// P3 with its behaviour, its refusals and its console line unchanged. How a result is read and checked
// is `readRenderedContent`'s (`limits.ts`), which the sandbox also runs before it sends one.

import type { DrawableContent } from "./rendered-body";
import type { PluginCssError } from "./sanitize-css";

import { usePluginStore } from "../../stores/system/plugin";
import { readRenderedContent, utf8Bytes } from "./limits";
import { sanitizePluginCss } from "./sanitize-css";
import { sanitizePluginMarkup } from "./sanitize-markup";

/** A result as the host may draw it, with the UTF-8 size of what was sent — the render cache's measure. */
export interface PreparedDrawable {
  bytes: number;
  content: DrawableContent;
}

/**
 * `raw` — a renderer's answer, or a panel's last content — as the host may draw it, or the fixed
 * sentence of `renderedContentProblem` (§6). Throws what the sanitizers throw: a `PluginCssError` for
 * refused CSS (plan 0125 P9), an `Error` over the node cap. Each field is read once
 * (`readRenderedContent`), so the value checked is the value drawn. `owner` begins the developer-mode
 * console line — `[PluginBlock] <plugin> <lang>` for a code block (`render-queue.ts`),
 * `[PluginPanel] <key>` for a panel (`panel-painter.ts`).
 */
export function prepareDrawable(
  owner: string,
  raw: unknown,
): PreparedDrawable | string {
  const content = readRenderedContent(raw);
  if (typeof content === "string") return content;
  const markupText = content.html;
  const cssText = content.css ?? "";
  const markup = sanitizePluginMarkup(markupText);
  if (markup.removed > 0 && usePluginStore.getState().devMode.active) {
    // §6 — developer mode (§379: a dev build, or the user's switch), not Vite's
    // `import.meta.env.DEV`: a `cargo build` debug binary embeds a production `dist/`
    // (`devLoadsAreUnbounded` in `plugin-loader.ts`). `console`, not `logger`: `logger.debug` and
    // `logger.info` are quiet outside a Vite dev build. A lower bound (`SanitizedMarkup.removed`), so
    // the line says "at least".
    console.info(`${owner}: the sanitizer removed at least ${markup.removed}`);
  }
  return {
    bytes: utf8Bytes(markupText) + utf8Bytes(cssText),
    content: {
      css: cssText === "" ? "" : sanitizePluginCss(cssText),
      fragment: markup.fragment,
    },
  };
}

/** The error line's sentence for refused CSS (plan 0125 P9). */
export function refusedCssMessage(err: PluginCssError): string {
  return `rendered CSS was refused (${err.code})`;
}

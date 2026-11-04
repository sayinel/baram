import type {
  CodeBlockInfo,
  RenderedContent,
  SandboxContext,
} from "../../plugin-api";

/**
 * §394 — the reference code block renderer (spec 0073 §8).
 *
 * A ```backlinks block draws the backlinks of the note it sits in: one row per linking line, the
 * linking note's name as a `data-note` link (Baram opens it on click) and that line's text. The
 * block's own text is not read — a renderer's settings live in its source, because Baram does not
 * keep the rest of the fence's info string. It reads `ctx.index` (§393) and draws again on
 * `vault:changed`. Its CSS uses only the app's tokens, so it follows the theme.
 */

const LANG = "backlinks";

const CSS = [
  // This rule only: Baram clips what is wider than the block, so the list sits in a box of its
  // own that scrolls sideways — a long path or a snippet with no space in it stays readable.
  ".rows{overflow-x:auto}",
  "ul{margin:0;padding:0 0 0 1.2em;color:var(--color-text-primary)}",
  "li{margin:.2em 0}",
  "a{color:var(--color-accent-default);cursor:pointer}",
  ".line{color:var(--color-text-muted)}",
  "p{margin:0;color:var(--color-text-muted)}",
].join("");

/** Text as HTML text or attribute value. The host sanitizes the result anyway; this keeps it right. */
function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `notes/a.md` → `a`. */
function noteName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.(md|markdown)$/u, "");
}

/** The renderer, reading this plugin's `ctx.index`. */
function backlinksRenderer(
  ctx: SandboxContext,
): (source: string, info: CodeBlockInfo) => Promise<RenderedContent> {
  return async (_source, info) => {
    // A note in no vault, or not saved yet, has no backlinks to ask for.
    if (info.context === null || info.path === null) {
      return { css: CSS, html: "<p>No backlinks</p>" };
    }
    const rows = await ctx.index.backlinks(info.path, { context: info.context });
    if (rows.length === 0) return { css: CSS, html: "<p>No backlinks</p>" };
    const items = rows.map(
      (row) =>
        `<li><a data-note="${escape(row.path)}">${escape(noteName(row.path))}</a> <span class="line">${escape(row.snippet)}</span></li>`,
    );
    return { css: CSS, html: `<div class="rows"><ul>${items.join("")}</ul></div>` };
  };
}

export function activate(ctx: SandboxContext): void {
  ctx.codeBlocks.register(LANG, backlinksRenderer(ctx));
  // The index answers from disk, so a changed vault can change any note's backlinks.
  ctx.events.on("vault:changed", () => {
    ctx.codeBlocks.invalidate(LANG);
  });
}

// No `deactivate` export: the sandboxed tier never calls one — teardown destroys the webview.

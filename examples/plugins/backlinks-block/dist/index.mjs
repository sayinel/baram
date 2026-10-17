// src/index.ts
var LANG = "backlinks";
var CSS = [
  // This rule only: Baram clips what is wider than the block, so the list sits in a box of its
  // own that scrolls sideways — a long path or a snippet with no space in it stays readable.
  ".rows{overflow-x:auto}",
  "ul{margin:0;padding:0 0 0 1.2em;color:var(--color-text-primary)}",
  "li{margin:.2em 0}",
  "a{color:var(--color-accent-default);cursor:pointer}",
  ".line{color:var(--color-text-muted)}",
  "p{margin:0;color:var(--color-text-muted)}"
].join("");
function escape(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function noteName(path) {
  return (path.split("/").pop() ?? path).replace(/\.(md|markdown)$/u, "");
}
function backlinksRenderer(ctx) {
  return async (_source, info) => {
    if (info.context === null || info.path === null) {
      return { css: CSS, html: "<p>No backlinks</p>" };
    }
    const rows = await ctx.index.backlinks(info.path, { context: info.context });
    if (rows.length === 0) return { css: CSS, html: "<p>No backlinks</p>" };
    const items = rows.map(
      (row) => `<li><a data-note="${escape(row.path)}">${escape(noteName(row.path))}</a> <span class="line">${escape(row.snippet)}</span></li>`
    );
    return { css: CSS, html: `<div class="rows"><ul>${items.join("")}</ul></div>` };
  };
}
function activate(ctx) {
  ctx.codeBlocks.register(LANG, backlinksRenderer(ctx));
  ctx.events.on("vault:changed", () => {
    ctx.codeBlocks.invalidate(LANG);
  });
}
export {
  activate
};

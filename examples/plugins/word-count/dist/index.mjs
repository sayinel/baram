// src/index.ts
var ITEM = "count";
function count(text) {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return { chars: text.length, words };
}
function activate(ctx) {
  const update = async () => {
    const { chars, words } = count(await ctx.editor.getMarkdown());
    ctx.ui.setStatusBarText(ITEM, `${words} words \xB7 ${chars} chars`);
  };
  ctx.events.on("editor:ready", () => void update());
  ctx.events.on("file:open", () => void update());
  ctx.events.on("file:save", () => void update());
}
export {
  activate
};

// src/index.ts
var STYLE = `
.baram-word-count-item { font-variant-numeric: tabular-nums; opacity: 0.85; }
`;
function count(text) {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return { chars: text.length, words };
}
function activate(ctx) {
  ctx.ui.addStyle(STYLE);
  const item = ctx.ui.showStatusBarItem("0 words", "right");
  const update = () => {
    const { chars, words } = count(ctx.editor.getContent());
    item.setText(`${words} words \xB7 ${chars} chars`);
  };
  update();
  ctx.events.on("editor:ready", update);
  ctx.events.on("file:open", update);
  ctx.events.on("file:save", update);
}
function deactivate() {
}
export {
  activate,
  deactivate
};

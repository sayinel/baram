// src/index.ts
var ITEM = "links";
function isNote(path) {
  return path.endsWith(".md") || path.endsWith(".markdown");
}
function activate(ctx) {
  let current;
  let reads = 0;
  const update = async () => {
    const read = ++reads;
    if (!current) {
      ctx.ui.setStatusBarText(ITEM, "");
      return;
    }
    const { context, path } = current;
    try {
      const [backlinks, tasks] = await Promise.all([
        ctx.index.backlinks(path, { context }),
        ctx.index.tasks({ context, file: path })
      ]);
      if (read === reads) {
        ctx.ui.setStatusBarText(ITEM, `\u2190 ${backlinks.length} \xB7 \u2610 ${tasks.length}`);
      }
    } catch {
      if (read === reads) ctx.ui.setStatusBarText(ITEM, "");
    }
  };
  ctx.events.on("file:open", (file) => {
    current = isNote(file.path) ? file : void 0;
    void update();
  });
  ctx.events.on("vault:changed", (change) => {
    if (current?.context === change.context) void update();
  });
}
export {
  activate
};

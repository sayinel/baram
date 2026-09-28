import type { SandboxContext } from "../../plugin-api";

/** The status-bar item declared under `contributions.statusBar` in baram-plugin.json. */
const ITEM = "chars";

export function activate(ctx: SandboxContext): void {
  const update = async (): Promise<void> => {
    const text = await ctx.editor.getText();
    ctx.ui.setStatusBarText(ITEM, `${text.length} chars`);
  };
  // Nothing is read during `activate`. Once it returns, Baram replays `file:open` for the file
  // already open, so the first count arrives with that event. Why reading here would be early:
  // examples/plugins/word-count/src/index.ts in the Baram repository.
  ctx.events.on("editor:ready", () => void update());
  ctx.events.on("file:open", () => void update());
  ctx.events.on("file:save", () => void update());
}

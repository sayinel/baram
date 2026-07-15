import type { ExtensionContext, StatusBarItem } from "../../plugin-api";

const STYLE = `
.baram-word-count-item { font-variant-numeric: tabular-nums; opacity: 0.85; }
`;

function count(text: string): { chars: number; words: number } {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return { chars: text.length, words };
}

export function activate(ctx: ExtensionContext): void {
  ctx.ui.addStyle(STYLE); // light-DOM (status bar); addStyle cannot reach Shadow-DOM
  const item: StatusBarItem = ctx.ui.showStatusBarItem("0 words", "right");

  const update = (): void => {
    const { chars, words } = count(ctx.editor.getContent());
    item.setText(`${words} words · ${chars} chars`);
  };

  update();
  // No live "change" event exists — recompute on load/open/save (see docs).
  ctx.events.on("editor:ready", update);
  ctx.events.on("file:open", update);
  ctx.events.on("file:save", update);
}

export function deactivate(): void {
  // Disposables (style + status-bar item + event listeners) auto-clean on unload.
}

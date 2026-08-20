import type { SandboxContext } from "../../plugin-api";

/**
 * §260 Phase 6 — the reference SANDBOXED plugin.
 *
 * Ported from the trusted tier, and the port is the point: this plugin needs nothing from
 * the main realm. What changed, and why, is written next to each line below — the whole file
 * is meant to be read by someone about to write their first sandboxed plugin.
 */

/** The status-bar item id, declared in `baram-plugin.json` under `contributions.statusBar`. */
const ITEM = "count";

function count(text: string): { chars: number; words: number } {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return { chars: text.length, words };
}

export function activate(ctx: SandboxContext): void {
  const update = async (): Promise<void> => {
    // PROSE, via `getText()` — and the history is the lesson. This tier used to have only
    // `getMarkdown()`, so v2.0.0 counted the markdown SOURCE: `# `, `- `, table pipes and
    // emphasis marks all became words. That was documented rather than papered over with a
    // regex stripper, because a flat-text read was a missing PROTOCOL MEMBER and a reference
    // plugin approximating one teaches the wrong thing.
    //
    // The right fix was to add the member (§4.8), not to strip markdown here. `getText()`
    // returns exactly what the app's own status bar counts, so this plugin now AGREES with
    // the number next to it instead of contradicting it in the same bar.
    const { chars, words } = count(await ctx.editor.getText());
    // Data-only UI: the host owns the item and renders the text. There is no DOM and no
    // `addStyle` in this tier, which is why v1's `tabular-nums` styling is gone.
    ctx.ui.setStatusBarText(ITEM, `${words} words · ${chars} chars`);
  };

  // No read AT activate, on purpose. `plugin-loader` subscribes the sandbox to events only
  // AFTER `activate` resolves — a frame delivered mid-activate would land before
  // `events.on` had run — and it then REPLAYS the open file. So the first count arrives
  // with that replayed `file:open`, and until then the bar shows the manifest's declared
  // text. Awaiting a host request here would also mean awaiting one the host is not yet
  // listening for.
  ctx.events.on("editor:ready", () => void update());
  ctx.events.on("file:open", () => void update());
  ctx.events.on("file:save", () => void update());

  // Still no live "change" event, as in v1: the count refreshes on open, ready and save.
}

// No `deactivate` export. The sandboxed tier never calls one — teardown destroys the whole
// webview realm, so event handlers and the declared status-bar item go with it. An exported
// `deactivate` here would be dead code that reads as a lifecycle hook.

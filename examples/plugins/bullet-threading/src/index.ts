/**
 * Bullet Threading — draws the outline path from the outermost ancestor down to the
 * item holding the caret, the way Logseq's bullet threading does.
 *
 * Two pieces, and the split is the whole point of this example:
 *
 * - `activate` gets the plugin-wide context. It injects the stylesheet, which is a
 *   `ui.addStyle` capability (trusted tier only), and re-injects it whenever the user
 *   changes a setting.
 * - the exported FACTORY gets a per-surface context and returns one ProseMirror plugin.
 *   The editor calls its `decorations` prop on every state change, and the caret's
 *   position is read from the state it is handed — so there is no event listener here,
 *   nothing to unsubscribe, and nothing that can drift out of step with the document.
 *
 * ‼️ EVERY SETTING THIS PLUGIN HAS IS A STYLESHEET TERM, which is what makes the live
 * rebuild below a complete answer. The factory's `ctx.settings` is a SNAPSHOT the host
 * takes once and never refreshes, so a contribution that read a value there would go
 * stale on the next edit; this plugin reads none, deliberately. If you copy this file and
 * your factory needs a current value, call `context.settings.getAll()` when you need it.
 *
 * An earlier version of this plugin did it the other way, listening for
 * `selectionchange` and writing `data-*` onto the `<li>` elements. That cannot work:
 * ProseMirror's `DOMObserver` watches `view.dom`'s whole subtree including attributes,
 * does not ignore them for a node with a `contentDOM`, and re-reads the range as a
 * document change — so the attributes were wiped as fast as they were written and the
 * fold triangles in that range flickered as their widgets were recreated. If you are
 * writing a plugin that draws in the editor, this is the file to copy, not that one.
 */
import type { Disposable, PluginContext } from "./types";

import { buildCss, DEFAULT_SETTINGS, resolveSettings } from "./css";
import { createThreadingPlugin } from "./threading";

let style: Disposable | undefined;
let watching: Disposable | undefined;

export function activate(context: PluginContext): void {
  inject(context);
  // Baram 0.7.4 and newer. On an older host `context.events` is a denied proxy whose every
  // property access THROWS — `?.` does not help, because the object is present and it is
  // the `.on` read that raises. So this is a try/catch rather than a version check: a
  // plugin cannot ask the host what it supports, and the settings still apply on the next
  // load either way, which is what this plugin did for its whole life before now.
  try {
    watching = context.events?.on("settings:changed", () => inject(context));
  } catch {
    watching = undefined;
  }
}

export function deactivate(): void {
  // The host disposes what a plugin registered through the context, but the stylesheet
  // is the one thing whose absence is immediately visible, so this is explicit.
  style?.dispose();
  style = undefined;
  watching?.dispose();
  watching = undefined;
}

/** The `tiptapExtensions` entry points here by `exportName`. */
export const Threading = createThreadingPlugin;

export { DEFAULT_SETTINGS };

/**
 * Rebuild the stylesheet from the current answers, replacing the previous one.
 *
 * Old sheet disposed BEFORE the new one is added, so two builds can never both be live —
 * they have identical selectors, and the later one would win by document order, which is a
 * rule that holds until someone reorders an insertion. There is no flash: both calls are
 * synchronous within one task, so the browser never paints between them.
 */
function inject(context: PluginContext): void {
  const raw = context.settings?.getAll() ?? {};
  const css = buildCss(resolveSettings(raw));
  style?.dispose();
  style = context.ui?.addStyle(css);
}

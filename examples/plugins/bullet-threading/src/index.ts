/**
 * Bullet Threading — draws the outline path from the outermost ancestor down to the
 * item holding the caret, the way Logseq's bullet threading does.
 *
 * Two pieces, and the split is the whole point of this example:
 *
 * - `activate` gets the plugin-wide context. It injects the stylesheet, which is a
 *   `ui.addStyle` capability (trusted tier only).
 * - the exported FACTORY gets a per-surface context and returns one ProseMirror plugin.
 *   The editor calls its `decorations` prop on every state change, and the caret's
 *   position is read from the state it is handed — so there is no event listener here,
 *   nothing to unsubscribe, and nothing that can drift out of step with the document.
 *
 * An earlier version of this plugin did it the other way, listening for
 * `selectionchange` and writing `data-*` onto the `<li>` elements. That cannot work:
 * ProseMirror's `DOMObserver` watches `view.dom`'s whole subtree including attributes,
 * does not ignore them for a node with a `contentDOM`, and re-reads the range as a
 * document change — so the attributes were wiped as fast as they were written and the
 * fold triangles in that range flickered as their widgets were recreated. If you are
 * writing a plugin that draws in the editor, this is the file to copy, not that one.
 */
import type { PluginContext } from "./types";

import { buildCss, DEFAULT_SETTINGS, resolveSettings } from "./css";
import { createThreadingPlugin } from "./threading";

let style: undefined | { dispose: () => void };

export function activate(context: PluginContext): void {
  const raw = context.settings?.getAll() ?? {};
  const settings = resolveSettings(raw as Record<string, unknown>);
  style = context.ui?.addStyle(buildCss(settings));
}

export function deactivate(): void {
  // The host disposes what a plugin registered through the context, but the stylesheet
  // is the one thing whose absence is immediately visible, so this is explicit.
  style?.dispose();
  style = undefined;
}

/** The `tiptapExtensions` entry points here by `exportName`. */
export const Threading = createThreadingPlugin;

export { DEFAULT_SETTINGS };

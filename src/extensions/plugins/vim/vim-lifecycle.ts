// §298 Vim Phase 1 — settings lifecycle (design §7, S6).
//
// The plugin is ALWAYS installed; this module flips it. One module-level
// subscription serves every live editor (§7 bans a subscription per
// instance), and registration replays the current setting at once — an
// editor created after the last toggle would otherwise miss it (the §7
// mount-time replay pin, same shape as SourceCodeEditor's).

import type { EditorView } from "@tiptap/pm/view";

import { useSettingsStore } from "../../../stores/settings/store";
import { vimPluginKey } from "./vim-keys";

const views = new Set<EditorView>();
let subscribed = false;

/** PluginView hook: registers the view, replays the setting, returns the
 *  unregister for destroy. */
export function registerVimLifecycle(view: EditorView): () => void {
  views.add(view);
  ensureSubscription();
  apply(view, useSettingsStore.getState().vimMode);
  return () => {
    views.delete(view);
  };
}

function apply(view: EditorView, enabled: boolean): void {
  if (view.isDestroyed) return;
  const vim = vimPluginKey.getState(view.state);
  if (!vim || vim.enabled === enabled) return;
  view.dispatch(
    view.state.tr.setMeta(vimPluginKey, { enabled, type: "setEnabled" }),
  );
}

function ensureSubscription(): void {
  if (subscribed) return;
  subscribed = true;
  useSettingsStore.subscribe((state, prev) => {
    if (state.vimMode === prev.vimMode) return;
    for (const view of views) apply(view, state.vimMode);
  });
}

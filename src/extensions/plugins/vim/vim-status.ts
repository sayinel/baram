// §298 Vim Phase 1 — the WYSIWYG vim status feed (design §8, S5).
//
// One editor OWNS the StatusBar indicator at a time. Shared and keep-alive
// editors all run the vim plugin, so publishing from every PluginView would
// let a hidden editor's transactions overwrite the visible one's mode. The
// active-editor hook (App) appoints the owner; switching owners immediately
// replays the new owner's snapshot — or null — so no stale mode survives a
// tab switch (§8 잔상 제거). The source surface has its own feeder
// (SourceCodeEditor); the StatusBar arbitrates by surface.

import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

import { useUIStore } from "../../../stores/ui/ui";
import { vimPluginKey } from "./vim-keys";

let owner: Editor | null = null;

/** PluginView destroy: a dying owner view must not leave its mode behind. */
export function clearWysiwygVimStatusFor(view: EditorView): void {
  if (ownerView() === view) {
    useUIStore.getState().setVimStatus(null);
  }
}

/** PluginView update: publishes only from the appointed owner. */
export function publishWysiwygVimStatus(view: EditorView): void {
  if (ownerView() === view) publish();
}

/** Appoint the owner (null while the source surface is active) and replay
 *  its snapshot at once. */
export function setWysiwygVimStatusOwner(next: Editor | null): void {
  owner = next;
  publish();
}

function ownerView(): EditorView | null {
  if (!owner || owner.isDestroyed) return null;
  return owner.view ?? null;
}

function publish(): void {
  const ui = useUIStore.getState();
  if (!owner || owner.isDestroyed) {
    ui.setVimStatus(null);
    return;
  }
  const vim = vimPluginKey.getState(owner.state);
  ui.setVimStatus(vim?.enabled ? { mode: vim.mode, surface: "wysiwyg" } : null);
}

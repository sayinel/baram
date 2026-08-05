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

import { useUIStore, type VimStatusMode } from "../../../stores/ui/ui";
import { vimPluginKey } from "./vim-keys";

let owner: Editor | null = null;

// §298 Phase 0b — the ISLAND layer. A focused code-block CM owns the
// indicator over the PM feed: CM edits dispatch PM transactions, whose
// PluginView would otherwise overwrite the island's insert mode with PM
// normal on every keystroke. Feeders only update snapshots; the store is
// written from exactly one arbitration path.
let activeIsland: unknown = null;
const islandModes = new Map<
  unknown,
  { mode: VimStatusMode; parent: EditorView | null }
>();

/** PluginView destroy: a dying owner view must not leave its mode behind. */
export function clearWysiwygVimStatusFor(view: EditorView): void {
  if (ownerView() === view) {
    useUIStore.getState().setVimStatus(null);
  }
}

/** Island blur/teardown: release the indicator and REPLAY the PM owner. */
export function islandVimBlur(id: unknown): void {
  if (activeIsland !== id) return;
  activeIsland = null;
  publish();
}

/** Island teardown — forget the snapshot too. */
export function islandVimDispose(id: unknown): void {
  islandModes.delete(id);
  islandVimBlur(id);
}

/** Island focus: claim the indicator ONLY with a live vim snapshot —
 *  a vim-off island leaves the PM feed alone. */
export function islandVimFocus(id: unknown): void {
  const entry = islandModes.get(id);
  if (!entry) return;
  // A keep-alive editor's island must never claim the indicator away
  // from the appointed owner.
  if (entry.parent && entry.parent !== ownerView()) return;
  activeIsland = id;
  useUIStore
    .getState()
    .setVimStatus({ mode: entry.mode, surface: "codeblock" });
}

/** Island mode transition (null = vim off for that island). */
export function islandVimMode(
  id: unknown,
  mode: null | VimStatusMode,
  parent: EditorView | null = null,
): void {
  if (mode === null) {
    islandModes.delete(id);
    islandVimBlur(id);
    return;
  }
  islandModes.set(id, {
    mode,
    parent: parent ?? islandModes.get(id)?.parent ?? null,
  });
  if (activeIsland === id) {
    useUIStore.getState().setVimStatus({ mode, surface: "codeblock" });
  }
}

/** PluginView update: publishes only from the appointed owner. */
export function publishWysiwygVimStatus(view: EditorView): void {
  // A focused island owns the indicator — but only over ITS OWN hosting
  // view: another editor's publications must not be swallowed by a stale
  // island claim (keep-alive editors).
  if (activeIsland !== null) {
    const entry = islandModes.get(activeIsland);
    if (!entry || entry.parent === null || entry.parent === view) return;
  }
  if (ownerView() === view) publish();
}

/** Appoint the owner (null while the source surface is active) and replay
 *  its snapshot at once. */
export function setWysiwygVimStatusOwner(next: Editor | null): void {
  owner = next;
  // An owner switch invalidates a stale island claim from another editor —
  // its blur may arrive late or never (keep-alive teardown ordering).
  if (activeIsland !== null) {
    const entry = islandModes.get(activeIsland);
    if (!entry || entry.parent !== ownerView()) activeIsland = null;
  }
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

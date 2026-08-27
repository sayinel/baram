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

import {
  useUIStore,
  type VimStatus,
  type VimStatusMode,
} from "../../../stores/ui/ui";
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
  if (ownerView() === view) writeStatus(null);
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
    writeStatus({ mode, surface: "codeblock" });
  }
}

/**
 * A refused vim operation must SAY so: the key is consumed and the document
 * left alone, and without this the user sees an unexplained no-op (dedicated
 * security review found the new paste budget silent this way — the same gap
 * applied to every existing refusal, e.g. a protected table row).
 */
export function publishVimRefusal(reason: string): void {
  useUIStore.getState().showToast(reason, "warning");
}

/** PluginView update: publishes only from the appointed owner. */
export function publishWysiwygVimStatus(view: EditorView): void {
  // A focused island owns the indicator — but only over ITS OWN hosting
  // view: another editor's publications must not be swallowed by a stale
  // island claim (keep-alive editors).
  if (activeIsland !== null) {
    // 자가 치유 (적대 리뷰 V1, REQUIRED): 소유권 해제는 blur microtask
    // 하나에 의존하는데, 포커스 폭주·강탈 상황에서 그 한 경로를 놓치면
    // stale claim이 PM 표시를 영구 동결시켰다 (기기 실증: -- NORMAL --
    // 고착). claim의 전제 — 포커스가 그 island 안 — 이 관측상 깨져
    // 있으면 claim을 버리고 PM 발행을 통과시킨다. O(1) containment.
    const dom = (activeIsland as { dom?: unknown }).dom;
    if (
      dom instanceof Element &&
      !dom.contains(dom.ownerDocument.activeElement)
    ) {
      activeIsland = null;
    } else {
      const entry = islandModes.get(activeIsland);
      if (!entry || entry.parent === null || entry.parent === view) return;
    }
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
  if (!owner || owner.isDestroyed) {
    writeStatus(null);
    return;
  }
  const vim = vimPluginKey.getState(owner.state);
  if (!vim?.enabled) {
    writeStatus(null);
    return;
  }
  // §8 island honesty: while a KNOWN plain island holds the keys, the mode
  // line shows insert with the island label instead of claiming NORMAL —
  // the island is effectively insert mode (every key types). Unknown hosts
  // (captions, third-party) keep today's display; CM code blocks never get
  // here, their own vim claims the indicator through the island layer.
  if (vim.suspended && vim.island) {
    writeStatus({ island: vim.island, mode: "insert", surface: "wysiwyg" });
    return;
  }
  // The command slot: an open ex line, else an open search line — the two
  // are mutually exclusive in the core.
  const command =
    vim.exLine === null ? (vim.searchLine ?? undefined) : `:${vim.exLine}`;
  writeStatus({
    ...(command === undefined ? {} : { command }),
    mode: vim.mode,
    surface: "wysiwyg",
  });
}

/**
 * The ONLY writer. publish() runs on every view update, and the owner is
 * appointed whenever the WYSIWYG surface is active — vim on or off — so an
 * unchanged value must never reach the store: zustand treats each partial as
 * a new root, clones the whole state and notifies EVERY listener, and the
 * repo has identity useUIStore() subscriptions that then re-render. Compared
 * against the live store value, not a local memo, because other surfaces
 * (source mode, islands) write here too (performance review P1).
 */
function writeStatus(next: null | VimStatus): void {
  const ui = useUIStore.getState();
  const current = ui.vimStatus;
  if (current === null && next === null) return;
  if (
    current !== null &&
    next !== null &&
    current.mode === next.mode &&
    current.surface === next.surface &&
    current.command === next.command &&
    current.island === next.island
  ) {
    return;
  }
  ui.setVimStatus(next);
}

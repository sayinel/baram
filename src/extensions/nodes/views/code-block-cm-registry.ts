// §298 Phase 1 (§12-4) — per-PMView registry of live CodeMirror code blocks.
//
// Why this exists (design §4, "CM readOnly 동기화"): when vim toggles the PM
// view's editable prop, ProseMirror does NOT call NodeView.update() — only
// doc/attr changes do. So the vim PluginView broadcasts the new editable
// state here, and every live CodeBlockNodeView reconfigures its CM readOnly
// Compartment.
//
// Leaf-module pin (plan review R6): this file must import neither the vim
// module nor concrete NodeView classes — both sides import IT.
import type { EditorView as PMView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

type EditableSync = (editable: boolean) => void;

const registries = new WeakMap<PMView, Set<EditableSync>>();
/** Last broadcast value per view — replayed to late registrants so a lazy
 *  CM created after a mode flip does not miss it (vim review S5/S6-R5). */
const lastBroadcast = new WeakMap<PMView, boolean>();

/** Push the PM view's editable state to every live code block it hosts. */
export function broadcastCodeBlockEditable(
  view: PMView,
  editable: boolean,
): void {
  lastBroadcast.set(view, editable);
  const set = registries.get(view);
  if (!set) return;
  for (const sync of set) sync(editable);
}

/**
 * Register a code block's sync callback for its owning PM view.
 * Returns the unregister function — call it in NodeView.destroy().
 */
export function registerCodeBlockEditableSync(
  view: PMView,
  sync: EditableSync,
): () => void {
  let set = registries.get(view);
  if (!set) {
    set = new Set();
    registries.set(view, set);
  }
  set.add(sync);
  const cached = lastBroadcast.get(view);
  if (cached !== undefined) sync(cached);
  return () => {
    set.delete(sync);
  };
}

// §298 Phase 0b — vim on/off channel, same shape as the editable channel:
// the vim PluginView broadcasts the ENABLED flag, live code blocks flip
// their vim controller, and the last value replays to late registrants
// (a lazily created CM must not miss the current setting).

const vimRegistries = new WeakMap<PMView, Set<EditableSync>>();
const lastVimBroadcast = new WeakMap<PMView, boolean>();

/** issue 477 — entry-mode intent, owned by the registrant through its whole
 *  lifecycle (live vim session, vim still loading, cold CM): "insert" lands
 *  the island editing (continuity from a PM insert-mode arrow entry). */
export interface EntryOptions {
  vimMode?: "insert";
}

/** Returns whether focus was delivered SYNCHRONOUSLY. A cold island (CM not
 *  yet mounted) memos the selection for its deferred init and returns false —
 *  the caller must keep its own focus fallback so keys stay alive until the
 *  island claims focus on mount (adversarial review round 2, cold-island
 *  false success). */
type EntryHandoff = (
  anchor: number,
  head: number,
  opts?: EntryOptions,
) => boolean;

interface EntryRegistrant {
  enter: EntryHandoff;
  getPos: () => number | undefined;
}

// §298 — explicit code-block ENTRY channel. prosemirror-view's
// selectionToDOM() is gated by editorOwnsSelection(view): on a NON-editable
// view (vim normal mode) the gate additionally requires a DOM selection
// whose anchor AND focus sit inside view.dom, plus an activeElement that
// contains view.dom. While vim is modal those preconditions frequently do
// not hold (ranged selections are wiped by the phantom-highlight defense,
// a source-mode roundtrip relocates the DOM selection entirely) — so PM's
// own descent into NodeView.setSelection (the one hook that focuses CM and
// carries the cursor in) cannot be relied on; entry only "worked" when a
// stale DOM range happened to be lying inside view.dom (device-measured).
// A cursor write that lands inside a code block invokes the handoff HERE
// instead, with the same node-LOCAL offsets PM's docView descent passes.

/** Push the vim ENABLED flag to every live code block of this PM view. */
export function broadcastCodeBlockVim(view: PMView, enabled: boolean): void {
  lastVimBroadcast.set(view, enabled);
  const set = vimRegistries.get(view);
  if (!set) return;
  for (const sync of set) sync(enabled);
}

/** Register a code block's vim sync; returns the unregister function. */
export function registerCodeBlockVimSync(
  view: PMView,
  sync: EditableSync,
): () => void {
  let set = vimRegistries.get(view);
  if (!set) {
    set = new Set();
    vimRegistries.set(view, set);
  }
  set.add(sync);
  const cached = lastVimBroadcast.get(view);
  if (cached !== undefined) sync(cached);
  return () => {
    set.delete(sync);
  };
}

const entryRegistries = new WeakMap<PMView, Set<EntryRegistrant>>();

/**
 * Invoke the entry handoff of the code block whose node starts at
 * `blockPos`. Returns whether the island took focus SYNCHRONOUSLY — false
 * (no registrant, or a cold island that only memoed the selection) leaves
 * the caller's fallback (plain PM focus) in charge.
 */
export function enterCodeBlockAt(
  view: PMView,
  blockPos: number,
  localAnchor: number,
  localHead: number,
  opts?: EntryOptions,
): boolean {
  const set = entryRegistries.get(view);
  if (!set) return false;
  for (const registrant of set) {
    if (registrant.getPos() === blockPos) {
      return registrant.enter(localAnchor, localHead, opts);
    }
  }
  return false;
}

/**
 * Shared caller-side shape check: hand the CURRENT selection over when it is
 * an empty text cursor inside a code block. Every programmatic landing path
 * (vim dispatchCursor, search submit, source-mode cursor restore) funnels
 * through this one predicate so the entry semantics cannot fork.
 */
export function enterCodeBlockSelection(
  view: PMView,
  opts?: EntryOptions,
): boolean {
  const sel = view.state.selection;
  if (!sel.empty || !(sel instanceof TextSelection)) return false;
  const $head = sel.$head;
  if ($head.parent.type.name !== "codeBlock") return false;
  return enterCodeBlockAt(
    view,
    $head.before(),
    $head.parentOffset,
    $head.parentOffset,
    opts,
  );
}

/** Register a code block's entry handoff; returns the unregister function. */
export function registerCodeBlockEntry(
  view: PMView,
  getPos: () => number | undefined,
  enter: EntryHandoff,
): () => void {
  let set = entryRegistries.get(view);
  if (!set) {
    set = new Set();
    entryRegistries.set(view, set);
  }
  const registrant: EntryRegistrant = { enter, getPos };
  set.add(registrant);
  return () => {
    set.delete(registrant);
  };
}

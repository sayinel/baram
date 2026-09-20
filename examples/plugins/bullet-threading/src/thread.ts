/**
 * The ancestor chain, read off the DOCUMENT rather than the DOM.
 *
 * The first attempt at this plugin walked `view.dom` and wrote `data-*` onto the `<li>`
 * elements it found. That cannot work on ProseMirror: its `DOMObserver` watches the
 * whole subtree including attributes, does not ignore them for a node with a
 * `contentDOM`, and re-reads the range as a document change — wiping the attribute and
 * re-creating any widget in it. Reading `$pos` instead asks the model the same question
 * and lets the view do the writing, which is what decorations are for.
 */

/** Node types that count as a rung on the thread. */
export const LIST_ITEM_TYPES = ["listItem", "taskItem"] as const;

export interface Rung {
  /** Document position just before the item's opening token. */
  from: number;
  /** Depth in the document tree — outermost rung first, so this ascends. */
  depth: number;
  /** Document position just after the item's closing token. */
  to: number;
}

interface ResolvedLike {
  after: (depth: number) => number;
  before: (depth: number) => number;
  depth: number;
  node: (depth: number) => { type: { name: string } };
}

/**
 * Every list item enclosing `$pos`, outermost first.
 *
 * Outermost-first because that is the order the thread is read in: the eye follows it
 * down from the ancestor's bullet to the caret, so the LAST rung is the item the caret
 * is actually in. Returns `[]` when the position is not inside a list at all, which is
 * most of a document and the case this must make free.
 */
export function ancestorRungs($pos: ResolvedLike): Rung[] {
  const rungs: Rung[] = [];
  for (let depth = 1; depth <= $pos.depth; depth++) {
    const name = $pos.node(depth).type.name;
    if ((LIST_ITEM_TYPES as readonly string[]).includes(name)) {
      rungs.push({ from: $pos.before(depth), depth, to: $pos.after(depth) });
    }
  }
  return rungs;
}

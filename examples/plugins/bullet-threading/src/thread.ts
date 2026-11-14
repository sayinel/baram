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

/** A node's span in the document. */
export interface Span {
  from: number;
  to: number;
}

/**
 * The list holding each rung — the node one level above it. `rungs` is `ancestorRungs($pos)`.
 *
 * In the schema `createBaramExtensions` builds, an item's parent is its list: `bulletList`
 * and `orderedList` hold `listItem`, `taskList` holds `taskItem`, neither item type has a
 * `group` a `block+` could take it through, and no other node in `src/extensions/nodes`
 * names either. Each list renders its items as direct children of its `ul`/`ol` — through
 * its own `toDOM` spec, which is also what the large-document virtualising node views
 * render — so a list marked here is exactly a list with a threaded `li` child: what the
 * stylesheet used to find with `:has(> li.bt-thread)`, wherever the list sits. Where it
 * must sit (directly in the item above, or in a `div` there) stays the stylesheet's call.
 *
 * An item directly in the document would have no list to mark, and `before(0)` throws —
 * inside the `decorations` prop, which takes the editor's rendering with it. Baram's schema
 * never puts one there; a host whose schema did gets no mark for that rung instead.
 */
export function rungLists($pos: ResolvedLike, rungs: readonly Rung[]): Span[] {
  return rungs
    .filter((rung) => rung.depth > 1)
    .map((rung) => ({
      from: $pos.before(rung.depth - 1),
      to: $pos.after(rung.depth - 1),
    }));
}

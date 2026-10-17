// §394 spec 0073 D12 · plan 0125 Task 12 fix I1 — export's wake for rendered blocks whose drawing is
// not of their current source. A rendered view keeps `data-render-state="pending"` while a redraw is
// due (`rendered-code-block-view.ts`), but in the editor it redraws only when it is on screen and
// rendered (D7): an edit while source editing is open, or an `invalidate` that reaches a block off
// screen, waits for the block to be shown. An export reads every block, so settle
// (`export-heavy-blocks.ts`) asks each due view inside the exported root to draw now, whatever its
// visibility or mode, as it asks the lazy queue to mount the blocks never drawn
// (`flushPendingVisibility`).

interface DueRedraw {
  /** Start a draw if one is due and none is in flight; whether one started. */
  drawIfDue: () => boolean;
  root: Element;
}

const views = new Set<DueRedraw>();

/**
 * Start a draw for every registered view inside `root` whose redraw is due. Returns how many
 * started: a view that cannot draw now — its editor names no note, its binding is gone — starts
 * none and is not counted, so it does not reset settle's stall detector on every poll.
 */
export function drawDuePluginBlocks(root: ParentNode): number {
  let started = 0;
  for (const view of [...views]) {
    if (root.contains(view.root) && view.drawIfDue()) started++;
  }
  return started;
}

/** A rendered view's root and its due-draw; the view calls this when it is made, and the returned
 *  disposer when it is destroyed. */
export function registerDueRedraw(
  root: Element,
  drawIfDue: () => boolean,
): () => void {
  const view: DueRedraw = { drawIfDue, root };
  views.add(view);
  return () => {
    views.delete(view);
  };
}

// §5.12 export — wake every lazily-mounted heavy block and wait for it to land.
//
// Code blocks, math (inline and block) and Mermaid diagrams all defer their real
// content until they near the viewport (extensions/nodes/views/lazy-visible.ts).
// An export reads the WHOLE document from a viewport that never moves, so
// without this the capture cloned whatever placeholder each unvisited block
// happened to be showing.
//
// Waking them is one synchronous call. Waiting for them is not: each block then
// starts async work of its own (a CodeMirror language mode, `import("katex")`,
// `mermaid.render`), and the clone is only faithful once that work has landed.

import { flushPendingVisibility } from "../../extensions/nodes/views/lazy-visible";

/**
 * Timings, injectable so the loop can be tested without wall-clock waits.
 *
 * ‼️ A test that has to sit through the real stall budget to prove the loop
 * gives up is a test nobody will keep. Passing small values makes the SHAPE of
 * the loop observable in milliseconds, and leaves the production numbers free
 * to be as generous as a real render needs.
 */
export interface SettleOptions {
  /** Hard stop, so a pathological document cannot hang the export. */
  ceilingMs?: number;
  /** How often to re-read the DOM. */
  pollMs?: number;
  /** How long with NO progress before concluding a block is stuck. */
  stallMs?: number;
  /** How many blocks to wake per pass. */
  wakeBatch?: number;
}

/** One unsettled block, named well enough to appear in a diagnostic. */
interface PendingBlock {
  el: Element;
  kind: string;
}

const DEFAULTS = {
  /** Small enough to feel instant, large enough not to spin. */
  pollMs: 50,

  /**
   * How long to keep waiting once nothing is happening — a stall detector, not
   * a deadline. Progress (a block woken OR a block finished) resets it, so a
   * document of two hundred diagrams takes as long as it needs.
   *
   * ‼️ It has to exceed the slowest plausible SINGLE render, because a render
   * in flight is not observable from here — the DOM looks identical to a stuck
   * one. A large Mermaid diagram on a slow machine can take several seconds,
   * and the first `import("mermaid")` pays for the bundle on top. 4s was too
   * tight and cost content; the cost of being generous is only paid by a block
   * that is genuinely stuck, and `ceilingMs` still bounds that.
   */
  stallMs: 15_000,

  ceilingMs: 120_000,

  /**
   * Waking a block is SYNCHRONOUS — it constructs a CodeMirror view, or starts
   * a React render. A document with hundreds of code blocks would do all of
   * that in one task, and because the export runs in the same task the click
   * handler started, the window would freeze before the dialog's own
   * "Exporting…" state had painted. Batching turns one long freeze into short
   * slices with a paint between them; the poll is already the loop that drives
   * them.
   */
  wakeBatch: 24,
};

/** Every heavy block in `root` that has not produced its content yet. */
export function pendingHeavyBlocks(root: ParentNode): PendingBlock[] {
  const pending: PendingBlock[] = [];
  const check = (
    selector: string,
    kind: string,
    ok: (el: Element) => boolean,
  ) => {
    for (const el of root.querySelectorAll(selector)) {
      if (!ok(el)) pending.push({ el, kind });
    }
  };
  check(".code-block-wrapper", "code", codeBlockSettled);
  check(".math-block", "math-block", mathBlockSettled);
  check(".math-inline", "math-inline", mathInlineSettled);
  check(".mermaid-block", "mermaid", mermaidSettled);
  return pending;
}

/**
 * Mount every deferred heavy block in `root` and resolve once they have all
 * produced their content.
 *
 * Resolves early — without waiting at all — for the common case of a document
 * whose blocks are already rendered.
 *
 * Returns the blocks that never settled (empty on success) rather than throwing:
 * a diagram that cannot render must not cost the user their whole export, and
 * the capture has a placeholder fallback for exactly this case.
 */
export async function settleHeavyBlocks(
  root: ParentNode,
  options: SettleOptions = {},
): Promise<PendingBlock[]> {
  const { ceilingMs, pollMs, stallMs, wakeBatch } = { ...DEFAULTS, ...options };

  let pending = pendingHeavyBlocks(root);
  // Nothing deferred: a short document the reader has scrolled through costs
  // this call nothing at all, not even a tick.
  if (pending.length === 0) return pending;

  const started = Date.now();
  let lastProgressAt = started;
  let lastCount = pending.length;

  while (pending.length > 0) {
    // A block that mounts can itself contain further lazy blocks (a code block
    // inside a collapsed callout, say), so this runs every pass rather than
    // assuming one reached everything.
    const woken = flushPendingVisibility(wakeBatch, root);

    await new Promise((resolve) => setTimeout(resolve, pollMs));
    pending = pendingHeavyBlocks(root);

    const now = Date.now();
    // Read the comparison BEFORE updating the high-water mark — folding the two
    // together makes the completion test below always false, which would leave
    // waking as the only kind of progress and stall the loop the moment the
    // last block is woken.
    const finishedSome = pending.length < lastCount;
    if (finishedSome) lastCount = pending.length;

    // ‼️ WAKING counts as progress, not just finishing. Waking is batched, so a
    // document with more blocks than one batch spends its first passes purely
    // waking — and if those blocks render more slowly than the stall budget
    // (a page of Mermaid diagrams does), a completions-only rule sees a flat
    // pending count from the very first poll, calls it a stall, and returns
    // while blocks it never woke are still placeholders. They then export
    // empty, which is the defect this whole file exists to prevent.
    if (woken > 0 || finishedSome) lastProgressAt = now;

    if (now - lastProgressAt > stallMs || now - started > ceilingMs) break;
  }

  return pending;
}

/**
 * A code block is settled once CodeMirror exists inside it — that is what
 * `collectCodeBlockInfo` reads highlighting and line numbers from.
 */
function codeBlockSettled(el: Element): boolean {
  return el.querySelector(".cm-editor") !== null;
}

/**
 * A math block is settled once its KaTeX host has ANY content. Every branch of
 * math-block-view's render effect writes something: the rendered formula, the
 * un-thrown fallback, or the literal "Empty math block" — so "still empty"
 * means "the effect has not run", which is exactly the lazy gate.
 */
function mathBlockSettled(el: Element): boolean {
  const host = el.querySelector(".math-block-katex");
  // No host at all is not a state math-block-view produces — both its branches
  // render one, the editing branch included. Treated as settled rather than
  // waited on: whatever put a `.math-block` on the page without a preview host
  // is not going to fill one in, and blocking the export on it would cost the
  // full stall budget for nothing.
  if (!host) return true;

  // ‼️ An empty host does NOT always mean "not rendered yet". The render effect
  // writes `textContent = selected ? "" : "Empty math block"`, so an empty
  // formula that is currently being EDITED leaves the host childless forever.
  // The class is the discriminator: the effect sets `math-block-katex-empty`
  // when it runs and finds nothing to typeset, and clears it the moment there
  // is a formula. Without this, a caret parked in an empty `$$` costs every
  // export the whole stall budget.
  if (host.classList.contains("math-block-katex-empty")) return true;

  return host.childNodes.length > 0;
}

/**
 * Inline math is settled once KaTeX has written into it. `data-empty` marks the
 * one case that never will (math-inline-view.tsx): an empty formula, whose
 * render effect returns before touching the DOM. Without that marker an empty
 * `$$` would burn the whole stall budget on every export.
 */
function mathInlineSettled(el: Element): boolean {
  if (el.getAttribute("data-empty") === "true") return true;
  return el.childNodes.length > 0 && el.textContent !== "";
}

/**
 * A Mermaid block reports its own state, because the DOM cannot be read for it.
 *
 * ‼️ The obvious predicate — "does it contain an SVG?" — is wrong in both
 * directions. `.mermaid-block-empty` ("Empty diagram") is what the block shows
 * BEFORE the lazy render as well as after a genuinely empty source, so it can
 * neither be treated as settled (the real diagram would be dropped) nor as
 * pending (an empty block would burn the whole stall budget). And a diagram
 * whose source does not parse never produces an SVG at all. `data-render-state`
 * (mermaid-block-view.tsx) says whether the render was ATTEMPTED, which is the
 * question actually being asked.
 */
function mermaidSettled(el: Element): boolean {
  return el.getAttribute("data-render-state") === "done";
}

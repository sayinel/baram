// §298 vim plugin state transitions — apply/init of the plugin's StateField
// (vim-plugin split, issue 776: vim-plugin.ts was past 500 lines).
//
// The §5b priority ladder lives here: vim's own meta first (`reduce`), then an
// explicit external command, an untagged doc change, and a foreign selection.

import type { VimCoreState } from "./core/types";
import type { VimMeta, VimPluginState } from "./vim-plugin-state";
import type { Transaction } from "@tiptap/pm/state";

import { SYNTAX_REVEAL_EPHEMERAL_META } from "../syntax-reveal-state";
import { releaseGraphemeIndex } from "./adapters/graphemes";
import { initialCoreState } from "./core/types";
import { isVimExternalEdit, vimPluginKey } from "./vim-keys";

export function applyVimTransaction(
  tr: Transaction,
  prev: VimPluginState,
): VimPluginState {
  // §5b priority 1 — vim's own meta.
  const meta = tr.getMeta(vimPluginKey) as undefined | VimMeta;
  if (meta) return reduce(prev, meta);

  if (!prev.enabled) return prev;

  // §5b priority 2 — explicit external command: clear count/pending,
  // apply the mode matrix (visual collapses to normal). Applies to
  // selection/meta-only transactions too (v7 pin 4).
  if (isVimExternalEdit(tr)) {
    return withCore(prev, {
      ...prev.core,
      count: null,
      goalColumn: null,
      mode: prev.core.mode === "visual" ? "normal" : prev.core.mode,
      pending: null,
      pendingCount: null,
      visual: null,
    });
  }

  // §5b priority 3 — untagged doc change: reconcile positions.
  if (tr.docChanged) {
    // Equality gate — every insert-mode keystroke lands here, and with no
    // visual range to map and no goal to forget nothing changes.
    if (prev.core.visual === null && prev.core.goalColumn === null) return prev;
    const visual = prev.core.visual
      ? {
          ...prev.core.visual,
          anchorCursor: tr.mapping.map(prev.core.visual.anchorCursor),
          headCursor: tr.mapping.map(prev.core.visual.headCursor),
        }
      : null;
    return withCore(prev, {
      ...prev.core,
      goalColumn: forgetsGoal(tr) ? null : prev.core.goalColumn,
      visual,
    });
  }

  // §5b priority 4 — external selection: a foreign selectionSet drops
  // visual back to normal (the anchor no longer means anything).
  if (tr.selectionSet && prev.core.mode === "visual") {
    return withCore(prev, {
      ...prev.core,
      goalColumn: forgetsGoal(tr) ? null : prev.core.goalColumn,
      mode: "normal",
      visual: null,
    });
  }
  // ...and in any mode it moved the cursor out from under the goal column
  // (a click). Equality-gated: most foreign selections find it already null.
  if (tr.selectionSet && prev.core.goalColumn !== null && forgetsGoal(tr)) {
    return withCore(prev, { ...prev.core, goalColumn: null });
  }

  return prev;
}

export function initialVimPluginState(): VimPluginState {
  return {
    core: initialCoreState("insert"),
    enabled: false,
    exLine: null,
    island: null,
    mode: "insert",
    searchLine: null,
    suspended: false,
  };
}

function reduce(prev: VimPluginState, meta: VimMeta): VimPluginState {
  switch (meta.type) {
    case "core":
      return withCore(prev, meta.core);
    case "setEnabled":
      if (!meta.enabled) releaseGraphemeIndex();
      // §7: enabling lands in normal with a clean slate; disabling returns
      // the surface to plain editing — and drops the boundary index, which
      // only vim builds (performance review P3).
      return {
        core: initialCoreState(meta.enabled ? "normal" : "insert"),
        enabled: meta.enabled,
        exLine: null,
        island: null,
        mode: meta.enabled ? "normal" : "insert",
        searchLine: null,
        suspended: false,
      };
    case "setMode":
      // issue 478 — a BOUNDARY handoff (mode following the cursor out of a
      // code block island) needs a clean core: an outer `:`/`/` buffer left
      // open before entering the island must not resurrect on exit. The
      // ordinary setMode (change-refusal recovery) keeps them.
      // The goal column is forgotten either way: an island exit lands where
      // CodeMirror's own goal put it, and a refused change moved nothing
      // vim can vouch for (issue 776).
      return withCore(prev, {
        ...prev.core,
        count: null,
        exLine: meta.boundary ? null : prev.core.exLine,
        goalColumn: null,
        mode: meta.mode,
        pending: null,
        pendingCount: null,
        searchLine: meta.boundary ? null : prev.core.searchLine,
        visual: meta.mode === "visual" ? prev.core.visual : null,
      });
    case "setSuspended":
      // §5b focusLocal: entering an island clears count/pending — an
      // operator must not survive a trip through an input island.
      return {
        ...withCore(prev, {
          ...prev.core,
          count: null,
          goalColumn: null, // the island may move the caret (issue 776)
          pending: null,
          pendingCount: null,
        }),
        island: meta.suspended ? (meta.island ?? null) : null,
        suspended: meta.suspended,
      };
  }
}

function withCore(prev: VimPluginState, core: VimCoreState): VimPluginState {
  return {
    ...prev,
    core,
    exLine: core.exLine,
    mode: core.mode,
    searchLine:
      core.searchLine === null
        ? null
        : (core.searchLine.direction === "forward" ? "/" : "?") +
          core.searchLine.text,
  };
}

/**
 * Does a transaction vim did not make forget the goal column (issue 776)?
 * Yes when it changed the text or moved the selection — except syntax
 * reveal's expand/collapse (SYNTAX_REVEAL_EPHEMERAL_META), which swaps a
 * mark's rendering under a cursor vim itself just put there: without the
 * exception, every j across a bold or linked line lost the column. A click
 * that expands through syntax reveal is still forgotten: the press arms a
 * watch (vim-pointer-goal.ts) whose appendTransaction step forgets the goal
 * once the cursor has moved.
 */
function forgetsGoal(tr: Transaction): boolean {
  return (
    (tr.docChanged || tr.selectionSet) &&
    tr.getMeta(SYNTAX_REVEAL_EPHEMERAL_META) !== true
  );
}

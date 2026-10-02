// §298 vim plugin state transitions — apply/init of the plugin's StateField
// (vim-plugin split, issue 776: vim-plugin.ts was past 500 lines).
//
// The §5b priority ladder lives here: vim's own meta first (`reduce`), then an
// explicit external command, an untagged doc change, and a foreign selection.

import type { VimCoreState } from "./core/types";
import type { VimMeta, VimPluginState } from "./vim-plugin-state";
import type { Transaction } from "@tiptap/pm/state";

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
      mode: prev.core.mode === "visual" ? "normal" : prev.core.mode,
      pending: null,
      pendingCount: null,
      visual: null,
    });
  }

  // §5b priority 3 — untagged doc change: reconcile positions.
  if (tr.docChanged) {
    const visual = prev.core.visual
      ? {
          ...prev.core.visual,
          anchorCursor: tr.mapping.map(prev.core.visual.anchorCursor),
          headCursor: tr.mapping.map(prev.core.visual.headCursor),
        }
      : null;
    return withCore(prev, { ...prev.core, visual });
  }

  // §5b priority 4 — external selection: a foreign selectionSet drops
  // visual back to normal (the anchor no longer means anything).
  if (tr.selectionSet && prev.core.mode === "visual") {
    return withCore(prev, {
      ...prev.core,
      mode: "normal",
      visual: null,
    });
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
      return withCore(prev, {
        ...prev.core,
        count: null,
        exLine: meta.boundary ? null : prev.core.exLine,
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

/**
 * The ProseMirror plugin: ancestor rungs in, decorations out.
 *
 * Everything prosemirror comes off `ctx.pm` — the host's own copy. A plugin that
 * imported `@tiptap/pm/view` itself would get a SECOND copy, and a `DecorationSet` from
 * that copy crashes the view as soon as anything else is also decorating (the app's own
 * extensions always are). See the host's contributed-decorations test.
 */
import type { PluginContext, PluginFactoryContext } from "./types";

import { ancestorRungs } from "./thread";

/** Class on every item in the chain. */
export const THREAD_CLASS = "bt-thread";
/** Class on the innermost item only — the one holding the caret. */
export const CURSOR_CLASS = "bt-thread-cursor";

/**
 * Build the decoration set for one state.
 *
 * Exported so the host-side test can call it without a plugin instance. Returns the
 * empty set outside a list, which is most positions in most documents — this runs on
 * every state change, and the app's budget is 16ms of typing latency.
 */
export function threadDecorations(
  state: { doc: unknown; selection: { $head: unknown } },
  pm: PluginFactoryContext["pm"],
) {
  const rungs = ancestorRungs(
    state.selection.$head as Parameters<typeof ancestorRungs>[0],
  );
  if (rungs.length === 0) return pm.DecorationSet.empty;

  const last = rungs.length - 1;
  return pm.DecorationSet.create(
    state.doc as never,
    rungs.map((rung, i) =>
      pm.Decoration.node(rung.from, rung.to, {
        class: i === last ? `${THREAD_CLASS} ${CURSOR_CLASS}` : THREAD_CLASS,
      }),
    ),
  );
}

/** The factory the manifest points at. */
export function createThreadingPlugin(ctx: PluginFactoryContext) {
  return new ctx.pm.Plugin({
    key: ctx.key,
    props: {
      decorations: (state: never) => threadDecorations(state, ctx.pm),
    },
  });
}

export type { PluginContext };

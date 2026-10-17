// §260 Phase 4a · §394 — an absolute path as the sandboxed tier may see it. Moved out of
// `plugin-lifecycle.ts` so the code block NodeView can use it (plan 0125 P13) without importing the
// plugin lifecycle — and through it the loader — into the editor's extension graph.
import type { PluginFileEvent } from "./types";

import { contextRootOf, useContextStore } from "../stores/context/context";

/**
 * §260 Phase 4a — an absolute path as the sandboxed tier is allowed to see it: the
 * containing context's id plus a path relative to its root, POSIX-separated.
 *
 * This is the single translation that keeps absolute paths out of the tier. Two callers:
 * the sandbox event bridge (installed by `initializePlugins` through `setContextResolver`)
 * and the `CodeBlockInfo` a rendered code block carries (`rendered/code-block-info.ts`,
 * §394). Exported from its own module so the second can reach it without the plugin
 * lifecycle, and tested on its own (`plugin-lifecycle.events.test.ts`) rather than through
 * `initializePlugins`, which would mean mocking the whole load path to assert one string.
 *
 * `getContextForPath` is the app's own longest-prefix rule (§81), reused rather than
 * re-derived: a second implementation could disagree about which vault a file belongs
 * to, and this one decides what a plugin is then permitted to read. A file in no
 * registered context returns `null`: the event bridge then drops the event, and
 * `codeBlockInfo` tells the renderer `{ context: null, path: null }` (sandboxed).
 */
export function locateInContext(absolutePath: string): null | PluginFileEvent {
  const context = useContextStore.getState().getContextForPath(absolutePath);
  if (!context) return null;
  // A `file` context IS the file (§89), so it has no interior path; Rust accepts `""`
  // for exactly this case and refuses anything else against such a context.
  if (context.contextType === "file") return { context: context.id, path: "" };
  // Sliced at the SAME boundary `getContextForPath` matched on, through the shared
  // `contextRootOf` rather than a second copy of the rule (security re-review LOW-4).
  const relative = absolutePath
    .slice(contextRootOf(context.path).length)
    .replace(/^[/\\]+/, "")
    .replace(/\\/g, "/");
  return { context: context.id, path: relative };
}

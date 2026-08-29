import type { TabSwitchContext } from "./types";

// §298 split-review §2 — original use-tab-switching.ts:623-639.
import { useEditorStore } from "../../stores/editor/editor";
import { logCacheEvent } from "../../utils/editor/perf-trace";

/**
 * Clean up cache for closed tabs.
 *
 * ‼️ Placement contract: call this ONLY from the markdown load path (cached-restore
 * or cold-load), inside the same `if (content !== undefined)` branch the pre-split
 * effect had it in. The keep-alive hit, non-file-tab, no-active-tab, and non-markdown
 * branches all `return` before reaching this in the original — hoisting this call to
 * run unconditionally at the end of every switch would make `keepalive.release()` fire
 * on switches where it currently never does (§298 split-review §2).
 */
export function gcClosedTabs(ctx: TabSwitchContext): void {
  const { tabs } = useEditorStore.getState();
  const openTabIds = new Set(tabs.map((t) => t.id));
  for (const cachedId of ctx.editorStateCache.current.keys()) {
    if (!openTabIds.has(cachedId)) {
      logCacheEvent("delete", cachedId);
      ctx.editorStateCache.current.delete(cachedId);
      ctx.scrollOffsets.current.delete(cachedId);
    }
  }
  // [MAJOR-4] Keep-alive tabs never enter editorStateCache, so check
  // the pool separately for closed tabs.
  for (const pooledTabId of ctx.keepalive.keys()) {
    if (!openTabIds.has(pooledTabId)) {
      ctx.keepalive.release(pooledTabId);
      ctx.scrollOffsets.current.delete(pooledTabId);
    }
  }
}

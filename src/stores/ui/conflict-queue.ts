// §3.6 External-change conflicts, queued per tab.
//
// A conflict belongs to the TAB whose unsaved work met a change on disk, not to
// a path: a rename moves the tab to another path, and a closed tab reopened on
// the same path is another tab with a fresh id. The queue keeps one entry per
// tab id; a newer event for the same tab replaces the entry in place and takes
// a new generation, so an action that started before that event can tell it
// resolved only the older one (`resolveConflictEntry`).
//
// Pure functions over an immutable array; `ui.ts` holds the field and wires the
// actions. Every function returns the SAME array when nothing changes, so the
// store can skip `set` (the equality gate the store writes require).

export interface ConflictEntry {
  /** Snapshot of the common-ancestor content captured when the conflict was
   *  detected (before reading the external change) — used as the 3-way base. */
  base: string;
  externalMtime: number;
  /** The tab's path as last known. Actions use the tab's CURRENT path. */
  filePath: string;
  /** Bumped by every enqueue for the tab; resolve only matches its own. */
  generation: number;
  tabId: string;
}

export type ConflictEvent = Omit<ConflictEntry, "generation">;

let lastGeneration = 0;

/** Remove the tab's entry regardless of generation — for a tab that is gone. */
export function dropConflictEntry(
  queue: readonly ConflictEntry[],
  tabId: string,
): readonly ConflictEntry[] {
  return queue.some((e) => e.tabId === tabId)
    ? queue.filter((e) => e.tabId !== tabId)
    : queue;
}

/**
 * Add a conflict for a tab, or merge a newer event into its entry in place:
 * the later mtime wins, path and base take the new values, the generation is new.
 * An event identical to the entry already queued changes nothing.
 */
export function enqueueConflictEntry(
  queue: readonly ConflictEntry[],
  event: ConflictEvent,
): readonly ConflictEntry[] {
  const index = queue.findIndex((e) => e.tabId === event.tabId);
  if (index === -1) {
    return [...queue, { ...event, generation: ++lastGeneration }];
  }
  const old = queue[index];
  const externalMtime = Math.max(old.externalMtime, event.externalMtime);
  if (
    old.externalMtime === externalMtime &&
    old.filePath === event.filePath &&
    old.base === event.base
  ) {
    return queue;
  }
  const next = [...queue];
  next[index] = {
    base: event.base,
    externalMtime,
    filePath: event.filePath,
    generation: ++lastGeneration,
    tabId: event.tabId,
  };
  return next;
}

/** Remove the tab's entry only when it is still the generation the caller saw. */
export function resolveConflictEntry(
  queue: readonly ConflictEntry[],
  tabId: string,
  generation: number,
): readonly ConflictEntry[] {
  return queue.some((e) => e.tabId === tabId && e.generation === generation)
    ? queue.filter((e) => e.tabId !== tabId)
    : queue;
}

/** Follow the tab to its new path. The generation stays: it is the same event. */
export function retargetConflictEntry(
  queue: readonly ConflictEntry[],
  tabId: string,
  filePath: string,
): readonly ConflictEntry[] {
  const index = queue.findIndex((e) => e.tabId === tabId);
  if (index === -1 || queue[index].filePath === filePath) return queue;
  const next = [...queue];
  next[index] = { ...queue[index], filePath };
  return next;
}

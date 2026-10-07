// §3.2 A tab saving its own file right now (issue 795).
//
// An atomic save renames a temporary file onto the note, and the watcher reports that
// as a change of the note — possibly twice, and possibly before `writeFile` resolves.
// While it has not resolved the save site has not yet recorded the save, and the tab is
// still dirty, so the change listener would read our own write as somebody else's and
// open the conflict modal over it. The tab's save sites therefore announce the save
// here, around their `writeFile`; the listener holds back a change of that path until
// the save settles and then drops it if the save's own mtime covers it.
//
// ‼️ Only the TAB'S OWN save sites announce — the places that record `lastSaveMtime`
// for the tab (auto-save, code auto-save, the close guard, manual save and Save As, the
// preview-source flush, the conflict merge). Any other in-app writer (Quick Capture's
// disk route, global search replace, journal and zettelkasten services, plugins, PDF
// companions) changes a file the tab did not write, and its change must reach the tab:
// a clean tab reloads, a dirty one gets the conflict modal. `origin: "app"` cannot tell
// the two apart, so the announcement does — not the `writeFile` wrapper, which every
// writer shares.
//
// Writes still pass through `writeFile`'s per-path queue (src/ipc/fs.ts, #798); this
// only records which of them are the tab's own.

interface Saving {
  count: number;
  /** The newest mtime a finished save of this run reported. */
  mtime: number | undefined;
  waiters: Array<(mtime: number | undefined) => void>;
}

const saving = new Map<string, Saving>();

/** Whether a tab's own save of `path` is running. */
export function tabSaveInFlight(path: string): boolean {
  return saving.has(path);
}

/**
 * Resolves once no tab save of `path` is running, with the newest mtime those saves
 * wrote (`undefined` if none succeeded). Immediately when none is running.
 */
export function afterTabSaves(path: string): Promise<number | undefined> {
  const entry = saving.get(path);
  if (!entry) return Promise.resolve(undefined);
  return new Promise((resolve) => entry.waiters.push(resolve));
}

/**
 * Run `write` — the tab's own save of `path` — announced as such, and answer the mtime
 * to record as `lastSaveMtime`: the one the write reports, or the clock when it reports
 * none (a test double).
 */
export async function asTabSave(
  path: string,
  write: () => Promise<number | void>,
): Promise<number> {
  const entry = saving.get(path) ?? { count: 0, mtime: undefined, waiters: [] };
  entry.count += 1;
  saving.set(path, entry);
  try {
    const written = await write();
    const mtime =
      typeof written === "number" && written > 0 ? written : Date.now();
    entry.mtime = Math.max(entry.mtime ?? 0, mtime);
    return mtime;
  } finally {
    entry.count -= 1;
    if (entry.count === 0) {
      saving.delete(path);
      for (const resolve of entry.waiters) resolve(entry.mtime);
    }
  }
}

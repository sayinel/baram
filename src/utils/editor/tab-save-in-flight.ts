// §3.2 A tab saving its own file right now (issue 795).
//
// An atomic save renames a temporary file onto the note, and the watcher reports that
// as a change of the note — possibly twice, and possibly before `writeFile` resolves.
// While it has not resolved the save site has not yet recorded the save, and the tab is
// still dirty, so the change listener would read our own write as somebody else's and
// open the conflict modal over it. The tab's save sites therefore announce the save
// here, around their `writeFile`; the listener holds back a change of that path until
// the save settles and then decides it (`ownSaveCovers`).
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
// ‼️ Judged by mtime, which is not an event's identity: a held change whose mtime the
// save's own write covers is taken for that write. A backend write token on every
// event would say it exactly — #824.
//
// Writes still pass through `writeFile`'s per-path queue (src/ipc/fs.ts, #798); this
// only records which of them are a tab's own.

import { useEditorStore } from "../../stores/editor/editor";

/** One finished save: which tab wrote, and the mtime its write reported (if any). */
export interface FinishedTabSave {
  mtime: number | undefined;
  tabId: string;
}

interface Saving {
  count: number;
  finished: FinishedTabSave[];
  waiters: Array<(finished: FinishedTabSave[]) => void>;
}

const saving = new Map<string, Saving>();

/** Whether a tab's own save of `path` is running. */
export function tabSaveInFlight(path: string): boolean {
  return saving.has(path);
}

/**
 * Resolves once no tab save of `path` is running, with every save of that run that
 * succeeded. Immediately (empty) when none is running.
 */
export function afterTabSaves(path: string): Promise<FinishedTabSave[]> {
  const entry = saving.get(path);
  if (!entry) return Promise.resolve([]);
  return new Promise((resolve) => entry.waiters.push(resolve));
}

/**
 * Whether a change of `path` reported with `mtime` was the tab's own save in `saves`,
 * as things stand now. It was only if every save reported its mtime and one of them
 * covers this change, and the tab that wrote it is still the only one showing the path.
 * A path reopened in another tab, or saved onto by Save As while another tab shows it,
 * belongs to a tab that did not write it, and that tab must hear the change.
 */
export function ownSaveCovers(
  path: string,
  mtime: number,
  saves: FinishedTabSave[],
): boolean {
  if (saves.length === 0 || mtime <= 0) return false;
  if (saves.some((s) => s.mtime === undefined)) return false;
  const covering = saves.filter((s) => (s.mtime as number) >= mtime);
  if (covering.length === 0) return false;
  const showing = useEditorStore
    .getState()
    .tabs.filter((t) => t.filePath === path)
    .map((t) => t.id);
  return (
    showing.length > 0 &&
    showing.every((id) => covering.some((s) => s.tabId === id))
  );
}

/**
 * Run `write` — tab `tabId`'s own save of `path` — announced as such. Answers the mtime
 * the write reported, or `undefined` when it reported none: unknown, and then no held
 * change is taken for this save.
 */
export async function asTabSave(
  path: string,
  tabId: string,
  write: () => Promise<number | void>,
): Promise<number | undefined> {
  const entry = saving.get(path) ?? { count: 0, finished: [], waiters: [] };
  entry.count += 1;
  saving.set(path, entry);
  try {
    const written = await write();
    const mtime =
      typeof written === "number" && written > 0 ? written : undefined;
    entry.finished.push({ mtime, tabId });
    return mtime;
  } finally {
    entry.count -= 1;
    if (entry.count === 0) {
      saving.delete(path);
      for (const resolve of entry.waiters) resolve(entry.finished);
    }
  }
}

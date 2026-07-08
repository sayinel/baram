// §103 Zettel hub — data hook: inbox / recent / MOCs derivations for the
// hub panel (Task 4 renders this data; Task 5 wires index-change reactivity).
import { useCallback, useEffect, useRef, useState } from "react";

import type { FileEntry } from "../../ipc/types";

import { listDir, readFile } from "../../ipc/invoke";
import { getFilesByTag } from "../../ipc/tag";
import {
  loadFavorites,
  useZettelFavoritesStore,
} from "../../stores/zettelkasten/zettel-favorites";
import {
  titleForId,
  useZettelIndexStore,
} from "../../stores/zettelkasten/zettel-index";
import { extractTagsFromContent } from "../../utils/journal/journal-tags";
import { basename } from "../../utils/path-utils";
import { recentFromEntries } from "../../utils/zettelkasten/hub-data";
import {
  extractLeadingId,
  firstBodyLine,
  parseNoteTitle,
} from "../../utils/zettelkasten/parse-note-title";

export interface ZettelHubData {
  favorites: ZettelHubListItem[];
  inbox: ZettelHubInboxItem[];
  loading: boolean;
  mocs: ZettelHubListItem[];
  recent: ZettelHubListItem[];
  refresh: () => Promise<void>;
}

export interface ZettelHubInboxItem {
  id: string;
  path: string;
  tags: string[];
  title: string;
}

export interface ZettelHubListItem {
  id?: string;
  path: string;
  title: string;
}

/** Soft cap on the MOCs list — MOC sets are curated and typically small. */
const MOC_LIMIT = 12;

/** Pure data layer for the Zettel hub panel — no UI here (see ZettelHubPanel, Task 4). */
export function useZettelHubData(zettelDir: null | string): ZettelHubData {
  const [inbox, setInbox] = useState<ZettelHubInboxItem[]>([]);
  const [mocs, setMocs] = useState<ZettelHubListItem[]>([]);
  const [recent, setRecent] = useState<ZettelHubListItem[]>([]);
  const [favorites, setFavorites] = useState<ZettelHubListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  // Bumped on every refresh() call; guards against an overlapping earlier
  // refresh overwriting state with stale results (see gen check below).
  const genRef = useRef(0);
  // Raw reference selector (NOT useShallow) — byId is replaced wholesale by
  // every upsert/removeByPath/setAll/clear, so reference-change is exactly
  // the "something changed" signal this hook wants to react to.
  const indexById = useZettelIndexStore((s) => s.byId);
  // Array selector — the favorites store replaces the whole array on every
  // toggle, so reference-change is a reliable "something changed" signal
  // (same reasoning as indexById above; useShallow isn't needed here).
  const favoriteIds = useZettelFavoritesStore((s) => s.favoriteIds);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load the persisted favorite ids whenever the zettel vault changes.
  useEffect(() => {
    if (zettelDir) void loadFavorites(zettelDir);
  }, [zettelDir]);

  const refresh = useCallback(async () => {
    const gen = ++genRef.current;
    if (!zettelDir) {
      setInbox([]);
      setMocs([]);
      setRecent([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [inboxItems, recentItems, mocItems] = await Promise.all([
      loadInbox(zettelDir),
      loadRecent(zettelDir),
      loadMocs(zettelDir),
    ]);
    if (!mountedRef.current || gen !== genRef.current) return;
    setInbox(inboxItems);
    setRecent(recentItems);
    setMocs(mocItems);
    setLoading(false);
  }, [zettelDir]);

  // Refresh on mount, on zettelDir change (via refresh's identity), and on
  // every index mutation — capture/promote/delete all upsert/removeByPath
  // the index (including Quick Capture, which happens outside this panel).
  useEffect(() => {
    void refresh();
  }, [refresh, indexById]);

  // Favorites are a pure, synchronous derivation of favoriteIds + the index
  // (see resolveFavorites) — recompute them directly instead of routing
  // through the async refresh() above, so a star toggle doesn't re-scan the
  // inbox/notes directories just to update this list.
  useEffect(() => {
    setFavorites(zettelDir ? resolveFavorites() : []);
  }, [favoriteIds, indexById, zettelDir]);

  return { favorites, inbox, mocs, recent, loading, refresh };
}

/** inbox/ listing — newest first, title from the fleeting note's first body line. */
async function loadInbox(zettelDir: string): Promise<ZettelHubInboxItem[]> {
  let entries: FileEntry[];
  try {
    entries = await listDir(`${zettelDir}/inbox`, false);
  } catch {
    return [];
  }
  const noteEntries = entries.filter(
    (e) => !e.isDir && /\.(md|markdown)$/.test(e.name),
  );
  const items = await Promise.all(
    noteEntries.map(async (entry) => {
      let content = "";
      try {
        content = await readFile(entry.path);
      } catch {
        /* keep empty — title/tags fall back below */
      }
      return {
        entry,
        item: {
          id: extractLeadingId(entry.name) ?? "",
          path: entry.path,
          title: firstBodyLine(content) || parseNoteTitle(entry.name, content),
          tags: extractTagsFromContent(content),
        },
      };
    }),
  );
  return items
    .sort((a, b) => b.entry.modifiedAt - a.entry.modifiedAt)
    .map(({ item }) => item);
}

/**
 * Files tagged #moc — title resolved from the id index, else filename-derived.
 * Restricted to `notes/`: a `#moc` tag on a fleeting inbox/ note is not a
 * real MOC (MOCs are created into notes/ by createMoc). getFilesByTag's Rust
 * backend returns OS-native separators, so backslashes (Windows) are
 * normalized to `/` before the filter/basename/path-join below — mirrors
 * use-file-tree-search.ts. Sorted by title and soft-capped at MOC_LIMIT
 * (mirrors Recent's top-15 bounding; MOC sets are curated and typically small
 * so this rarely truncates).
 */
async function loadMocs(zettelDir: string): Promise<ZettelHubListItem[]> {
  try {
    const relPaths = await getFilesByTag(zettelDir, "moc");
    return relPaths
      .map((rel) => rel.replace(/\\/g, "/"))
      .filter((rel) => rel.startsWith("notes/"))
      .map((rel) => {
        const name = basename(rel);
        const id = extractLeadingId(name) ?? "";
        return {
          id,
          path: `${zettelDir}/${rel}`,
          title: titleForId(id) ?? parseNoteTitle(name, ""),
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, MOC_LIMIT);
  } catch {
    return [];
  }
}

/** notes/ listing — top 15 by modifiedAt desc, filename-derived titles only. */
async function loadRecent(zettelDir: string): Promise<ZettelHubListItem[]> {
  try {
    const entries = await listDir(`${zettelDir}/notes`, false);
    return recentFromEntries(entries, 15);
  } catch {
    return [];
  }
}

/**
 * Resolves the persisted favorite ids against the zettel index — a
 * synchronous store-read (no IPC), so it's safe to call inline inside
 * refresh() after the async loads settle. Ids not (yet) present in the
 * index (note deleted, or index not loaded) are dropped; order mirrors
 * favoriteIds.
 */
function resolveFavorites(): ZettelHubListItem[] {
  const { favoriteIds } = useZettelFavoritesStore.getState();
  const { byId } = useZettelIndexStore.getState();
  const items: ZettelHubListItem[] = [];
  for (const id of favoriteIds) {
    const note = byId[id];
    if (note) items.push({ id: note.id, path: note.path, title: note.title });
  }
  return items;
}

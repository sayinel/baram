// §103 Zettel hub — data hook: inbox / recent / MOCs derivations for the
// hub panel (Task 4 renders this data; Task 5 wires index-change reactivity).
import { useCallback, useEffect, useRef, useState } from "react";

import type { FileEntry } from "../../ipc/types";

import { listDir, readFile } from "../../ipc/invoke";
import { getFilesByTag } from "../../ipc/tag";
import { titleForId } from "../../stores/zettelkasten/zettel-index";
import { extractTagsFromContent } from "../../utils/journal/journal-tags";
import { basename } from "../../utils/path-utils";
import { recentFromEntries } from "../../utils/zettelkasten/hub-data";
import {
  extractLeadingId,
  firstBodyLine,
  parseNoteTitle,
} from "../../utils/zettelkasten/parse-note-title";

export interface ZettelHubData {
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
  path: string;
  title: string;
}

/** Pure data layer for the Zettel hub panel — no UI here (see ZettelHubPanel, Task 4). */
export function useZettelHubData(zettelDir: null | string): ZettelHubData {
  const [inbox, setInbox] = useState<ZettelHubInboxItem[]>([]);
  const [mocs, setMocs] = useState<ZettelHubListItem[]>([]);
  const [recent, setRecent] = useState<ZettelHubListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
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
    if (!mountedRef.current) return;
    setInbox(inboxItems);
    setRecent(recentItems);
    setMocs(mocItems);
    setLoading(false);
  }, [zettelDir]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { inbox, mocs, recent, loading, refresh };
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

/** Files tagged #moc — title resolved from the id index, else filename-derived. */
async function loadMocs(zettelDir: string): Promise<ZettelHubListItem[]> {
  try {
    const relPaths = await getFilesByTag(zettelDir, "moc");
    return relPaths.map((rel) => {
      const name = basename(rel);
      const id = extractLeadingId(name) ?? "";
      return {
        path: `${zettelDir}/${rel}`,
        title: titleForId(id) ?? parseNoteTitle(name, ""),
      };
    });
  } catch {
    return [];
  }
}

/** notes/ listing — top 7 by modifiedAt desc, filename-derived titles only. */
async function loadRecent(zettelDir: string): Promise<ZettelHubListItem[]> {
  try {
    const entries = await listDir(`${zettelDir}/notes`, false);
    return recentFromEntries(entries, 7);
  } catch {
    return [];
  }
}

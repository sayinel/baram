// §260 Phase 5 — bookmark load/save must stay ORDERED after going async.
//
// `BookmarkPanel` mounts two effects: one loads for the current vault, the other saves
// whenever `bookmarks` changes — and the second fires on mount too, before the first has
// produced anything. While both were synchronous that was harmless: the load set the
// store, and the save read `get().bookmarks` (the LIVE value, not a render closure) and
// wrote the same list straight back.
//
// Moving to `tauriStorage` made both async and put them in flight together, so the save
// read an empty store and wrote `[]` — either clobbering the file after the load had
// read it, or landing first so the load read `[]` back. Either ordering wipes the user's
// bookmarks on the first mount against an existing vault.
import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, string>();
let getDelay = 0;

vi.mock("../../../ipc/invoke", () => ({
  getConfig: async (key: string) => {
    if (getDelay > 0) await new Promise((r) => setTimeout(r, getDelay));
    return disk.get(key) ?? null;
  },
  removeConfig: async (key: string) => void disk.delete(key),
  setConfig: async (key: string, value: string) => void disk.set(key, value),
}));

import { storageKey, useBookmarkStore } from "../bookmark";

const ROOT = "/vaults/one";
const STORED = [
  {
    createdAt: 1,
    filePath: "note.md",
    group: "Default",
    id: "a",
    label: "Note",
    type: "file" as const,
  },
];

describe("bookmark load/save ordering (§260 Phase 5)", () => {
  beforeEach(() => {
    disk.clear();
    getDelay = 0;
    useBookmarkStore.setState({ bookmarks: [] });
  });

  it("does not let a mount-time save clobber an in-flight load", async () => {
    disk.set(storageKey(ROOT), JSON.stringify(STORED));
    // The read is slow; the save is not. This is the mount ordering, made deterministic.
    getDelay = 20;

    const { loadBookmarks, saveBookmarks } = useBookmarkStore.getState();
    const load = loadBookmarks(ROOT);
    const save = saveBookmarks(ROOT);
    await Promise.all([load, save]);

    expect(useBookmarkStore.getState().bookmarks).toEqual(STORED);
    expect(JSON.parse(disk.get(storageKey(ROOT)) ?? "null")).toEqual(STORED);
  });

  it("still writes a genuine change that follows a load", async () => {
    // The ordering fix must not turn saves into no-ops — the panel's autosave effect is
    // the only thing that persists an added bookmark.
    disk.set(storageKey(ROOT), JSON.stringify(STORED));
    await useBookmarkStore.getState().loadBookmarks(ROOT);

    useBookmarkStore.getState().addBookmark({
      filePath: "second.md",
      group: "Default",
      label: "Second",
      type: "file",
    });
    await useBookmarkStore.getState().saveBookmarks(ROOT);

    const written = JSON.parse(disk.get(storageKey(ROOT)) ?? "null") as {
      filePath: string;
    }[];
    expect(written.map((b) => b.filePath)).toEqual(["note.md", "second.md"]);
  });

  it("writes an empty list when the vault genuinely has none", async () => {
    // The fix must not confuse "not loaded yet" with "loaded and empty" so thoroughly
    // that clearing every bookmark stops persisting.
    await useBookmarkStore.getState().loadBookmarks(ROOT);
    await useBookmarkStore.getState().saveBookmarks(ROOT);

    expect(disk.get(storageKey(ROOT))).toBe("[]");
  });
});

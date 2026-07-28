// §260 Phase 5 — the localStorage → Tauri-config migration, and specifically the part a
// static key list cannot do.
//
// `baram:bookmarks:{vaultRoot}` is one key per vault the user has ever opened. Before
// this phase bookmarks lived in localStorage, which every `plugin-*` sandbox webview
// shares an origin with; moving them is only half the fix, because a user upgrading with
// existing bookmarks would otherwise both LOSE them and leave the readable copy behind.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("../../../ipc/invoke", () => ({
  getConfig: (key: string) => Promise.resolve(store.get(key) ?? null),
  removeConfig: (key: string) => {
    store.delete(key);
    return Promise.resolve();
  },
  setConfig: (key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve();
  },
}));

import { storageKey } from "../../file/bookmark";
import { migrateFromLocalStorage } from "../tauri-storage";

describe("migrateFromLocalStorage (§260 Phase 5)", () => {
  beforeEach(() => {
    store.clear();
    localStorage.clear();
  });

  it("sweeps every per-vault bookmark key, not just the ones someone listed", async () => {
    // Keys built by the REAL `storageKey`, not a literal: the sweep's prefix and that
    // function have to agree, and nothing else in the codebase couples them. A rename
    // there would otherwise leave the migration quietly finding nothing.
    const one = storageKey("/vaults/one");
    const two = storageKey("/vaults/two");
    localStorage.setItem(one, '[{"id":"a"}]');
    localStorage.setItem(two, '[{"id":"b"}]');

    await migrateFromLocalStorage();

    expect(store.get(one)).toBe('[{"id":"a"}]');
    expect(store.get(two)).toBe('[{"id":"b"}]');
    // …and the readable copy is gone from the shared surface.
    expect(localStorage.getItem(one)).toBeNull();
    expect(localStorage.getItem(two)).toBeNull();
  });

  it("moves the fixed keys too, including the journal layout added in Phase 5", async () => {
    localStorage.setItem("baram:settings", "{}");
    localStorage.setItem("baram:journal-layout", '{"collapsed":{}}');

    await migrateFromLocalStorage();

    expect(store.get("baram:settings")).toBe("{}");
    expect(store.get("baram:journal-layout")).toBe('{"collapsed":{}}');
    expect(localStorage.getItem("baram:journal-layout")).toBeNull();
  });

  it("leaves unrelated keys alone", async () => {
    localStorage.setItem("someone-elses-key", "keep me");
    localStorage.setItem("baram:bookmarksNotReally", "keep me too");

    await migrateFromLocalStorage();

    expect(localStorage.getItem("someone-elses-key")).toBe("keep me");
    expect(localStorage.getItem("baram:bookmarksNotReally")).toBe(
      "keep me too",
    );
    expect(store.size).toBe(0);
  });

  it("does not clobber a value already migrated, and still deletes the copy", async () => {
    store.set("baram:bookmarks:/vaults/one", '[{"id":"newer"}]');
    localStorage.setItem("baram:bookmarks:/vaults/one", '[{"id":"stale"}]');

    await migrateFromLocalStorage();

    expect(store.get("baram:bookmarks:/vaults/one")).toBe('[{"id":"newer"}]');
    // §260 Phase 5 code review (H1) — skipping the COPY was the whole point of the
    // sweep. Leaving it behind keeps the shared-origin surface that every sandboxed
    // plugin can read, which is what this migration exists to remove.
    expect(localStorage.getItem("baram:bookmarks:/vaults/one")).toBeNull();
  });

  it("runs before anything can write, so a legitimate empty save cannot shadow it", async () => {
    // §260 Phase 5 code review (H1). The failure this guards: `BookmarkPanel` loads,
    // finds nothing in config, and its autosave correctly writes "[]" — after which the
    // sweep sees a TRUTHY "[]", concludes "already migrated", and skips. The user's
    // bookmarks are gone AND the readable localStorage copy survives.
    //
    // The ordering itself is enforced in `main.tsx` (the migration is awaited before the
    // app module graph is imported, so no store has been created and no effect has run).
    // What is asserted here is the half that lives in this module: a truthy config value
    // must not be the only thing standing between the copy and deletion.
    localStorage.setItem("baram:bookmarks:/vaults/one", '[{"id":"real"}]');
    store.set("baram:bookmarks:/vaults/one", "[]"); // the spurious empty save

    await migrateFromLocalStorage();

    expect(localStorage.getItem("baram:bookmarks:/vaults/one")).toBeNull();
  });
});

// §260 Phase 5 — the localStorage → Tauri-config migration.
//
// `baram:bookmarks:{vaultRoot}` is one key per vault the user has ever opened, so the
// sweep cannot work off a static list. Before this phase bookmarks lived in localStorage,
// which every `plugin-*` sandbox webview shares an origin with — so moving them is only
// half the fix. The other half is that a user upgrading with existing bookmarks must not
// LOSE them, and must not be left with the readable copy either.
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

const VAULT_KEY = "baram:bookmarks:/vaults/one";

describe("migrateFromLocalStorage (§260 Phase 5)", () => {
  beforeEach(() => {
    store.clear();
    localStorage.clear();
  });

  it("sweeps every per-vault bookmark key, not just the ones someone listed", async () => {
    // Keys built by the REAL `storageKey`, not literals: the sweep's prefix and that
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
    localStorage.setItem("baram:settings", '{"theme":"dark"}');
    localStorage.setItem("baram:journal-layout", '{"collapsed":{"a":true}}');

    await migrateFromLocalStorage();

    expect(store.get("baram:settings")).toBe('{"theme":"dark"}');
    expect(store.get("baram:journal-layout")).toBe('{"collapsed":{"a":true}}');
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

  it("does not let a degenerate config value shadow the real data", async () => {
    // §260 Phase 5 re-review (R6). The first version of this test asserted only that the
    // copy was deleted — while the config still held `"[]"`. So it certified the shadowing
    // its own title said could not happen, AND certified deleting the last surviving copy
    // of the user's bookmarks: recoverable loss had become permanent loss, green.
    //
    // The scenario: something read before the sweep, found nothing, and correctly saved an
    // empty list. `main.tsx` awaiting the sweep is what stops that write happening at all;
    // this is the second lock, because the consequence of the first slipping is not
    // recoverable.
    localStorage.setItem(VAULT_KEY, '[{"id":"real"}]');
    store.set(VAULT_KEY, "[]");

    await migrateFromLocalStorage();

    // The DATA first — it is the property the title claims, and the one the old test
    // omitted entirely.
    expect(JSON.parse(store.get(VAULT_KEY) ?? "null")).toEqual([
      { id: "real" },
    ]);
    expect(localStorage.getItem(VAULT_KEY)).toBeNull();
  });

  it("treats an empty object and a whitespace-padded empty array as degenerate too", async () => {
    localStorage.setItem("baram:journal-layout", '{"collapsed":{"a":true}}');
    store.set("baram:journal-layout", " {} ");

    await migrateFromLocalStorage();

    expect(store.get("baram:journal-layout")).toBe('{"collapsed":{"a":true}}');
  });

  it("sees through zustand's persist envelope", async () => {
    // §260 Phase 5 re-review (F3) — the shape three of the four migrated key families
    // actually have. `{"state":{"collapsed":{}},"version":0}` is what `journal-layout`
    // writes when it rehydrated nothing, and the first version of this check read it as
    // genuine — so the skip branch ran and deleted the only surviving copy.
    localStorage.setItem("baram:journal-layout", '{"collapsed":{"a":true}}');
    store.set("baram:journal-layout", '{"state":{"collapsed":{}},"version":0}');

    await migrateFromLocalStorage();

    expect(store.get("baram:journal-layout")).toBe('{"collapsed":{"a":true}}');
  });

  it("unwraps the envelope only at the top level", async () => {
    // §260 Phase 5 round 4 (G2) — a store whose own state contains a key named `state`
    // must not have its siblings ignored. Unwrapping at any depth judged this degenerate,
    // which would fall through and overwrite the real config value.
    localStorage.setItem(
      "baram:journal-layout",
      '{"collapsed":{"stale":true}}',
    );
    store.set(
      "baram:journal-layout",
      '{"state":{"state":{},"realData":{"a":1}}}',
    );

    await migrateFromLocalStorage();

    expect(store.get("baram:journal-layout")).toBe(
      '{"state":{"state":{},"realData":{"a":1}}}',
    );
  });

  it("does not treat a POPULATED persist envelope as degenerate", async () => {
    // The other side: `version` must not make an envelope look empty, and real state
    // inside one must win.
    localStorage.setItem(
      "baram:journal-layout",
      '{"collapsed":{"stale":true}}',
    );
    store.set(
      "baram:journal-layout",
      '{"state":{"collapsed":{"real":true}},"version":0}',
    );

    await migrateFromLocalStorage();

    expect(store.get("baram:journal-layout")).toBe(
      '{"state":{"collapsed":{"real":true}},"version":0}',
    );
    expect(localStorage.getItem("baram:journal-layout")).toBeNull();
  });

  it("leaves a POPULATED config value alone, and still drops the copy", async () => {
    // The other side of the same rule, and the H1 half: a real migrated value wins, and
    // the readable localStorage copy goes regardless of which value won.
    store.set(VAULT_KEY, '[{"id":"newer"}]');
    localStorage.setItem(VAULT_KEY, '[{"id":"stale"}]');

    await migrateFromLocalStorage();

    expect(store.get(VAULT_KEY)).toBe('[{"id":"newer"}]');
    expect(localStorage.getItem(VAULT_KEY)).toBeNull();
  });

  it("does not treat an unparseable config value as degenerate", async () => {
    // Anything we cannot read counts as real. Guessing otherwise would overwrite it.
    store.set(VAULT_KEY, "not json at all");
    localStorage.setItem(VAULT_KEY, '[{"id":"stale"}]');

    await migrateFromLocalStorage();

    expect(store.get(VAULT_KEY)).toBe("not json at all");
  });
});

// §69 — the fetch/persist half, which had no test file at all.
//
// A review mutated this module and five mutations survived, one of them re-creating the
// exact disarm two separate comments in the source argue must never happen. The
// arithmetic of revocation was well guarded; the plumbing that decides whether a
// revocation is ever STORED was not guarded at all.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRevocations =
  vi.fn<(url: string) => Promise<{ body: string; verified: boolean }>>();
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginFetchRevocations: (url: string) => fetchRevocations(url),
}));

import type { RevocationList } from "../revocation";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createJSONStorage } from "zustand/middleware";

import {
  DEFAULT_REGISTRY_URL,
  usePluginStore,
} from "../../stores/system/plugin";
import { logger } from "../../utils/logger";
import { revocationFor } from "../revocation";
import {
  refreshRevocations,
  REVOCATION_STALE_AFTER_MS,
  revocationsAreStale,
  revocationUrlFor,
} from "../revocation-client";

const LIST: RevocationList = {
  revoked: [
    {
      id: "bad",
      reason: "steals things",
      severity: "malicious",
      versions: "*",
    },
  ],
  sequence: 1,
  version: 1,
};

describe("revocationUrlFor", () => {
  it("resolves as a sibling of whatever index is configured", () => {
    // A custom registry must get ITS list, not ours. String surgery on the URL is what
    // this avoids; the parser handles the cases hand-rolled slicing gets wrong.
    expect(revocationUrlFor("https://x.test/custom/index.json")).toBe(
      "https://x.test/custom/revoked.json",
    );
    expect(
      revocationUrlFor("https://sayinel.github.io/baram-plugins/index.json"),
    ).toBe("https://sayinel.github.io/baram-plugins/revoked.json");
  });

  it("returns null rather than throwing on a URL it cannot parse", () => {
    expect(revocationUrlFor("not a url")).toBeNull();
  });

  it("lands under the prefix Rust demands a signature for", () => {
    // ‼️ THIS DRIFT FAILS OPEN, which is the whole reason it needs a test. Rust decides whether
    // to demand a signature by prefix-matching the URL it was handed against
    // `FIRST_PARTY_REVOCATION_PREFIX`. Move the registry — a hostname change, a path move, a
    // Pages project rename — and the match simply misses: the fetch takes the "third-party
    // registry, list is not signature-verified" branch, returns `verified: false`, and every
    // client stops checking signatures AND stops trusting the counter. No error, no failed
    // build, nothing a user could notice.
    const rust = readFileSync(
      resolve(__dirname, "../../../src-tauri/src/plugin/mod.rs"),
      "utf8",
    );
    // Matched on the DECLARATION, and the count is asserted: the identifier also appears in
    // comments and in Rust's own tests, so "a match exists" would not mean this is the value
    // that ships.
    const declarations = [
      ...rust.matchAll(/FIRST_PARTY_REVOCATION_PREFIX: &str = "([^"]+)"/gu),
    ];
    expect(declarations).toHaveLength(1);
    const prefix = declarations[0][1];
    // The URL Rust actually receives is the revocation list's, not the index's.
    expect(revocationUrlFor(DEFAULT_REGISTRY_URL)?.startsWith(prefix)).toBe(
      true,
    );
    expect(DEFAULT_REGISTRY_URL.startsWith(prefix)).toBe(true);
  });
});

/**
 * Simulate a launch whose storage ALREADY HOLDS `state` — i.e. what rehydration restores,
 * which is a different set from what `partialize` writes.
 *
 * Drives the store's real `persist.rehydrate()` rather than reading `partialize` output,
 * because that difference is precisely what hid a CRITICAL for two review rounds.
 */
async function rehydrateWith(state: Record<string, unknown>): Promise<void> {
  const original = usePluginStore.persist.getOptions().storage;
  const blob = JSON.stringify({ state, version: 3 });
  usePluginStore.persist.setOptions({
    storage: createJSONStorage(() => ({
      getItem: () => blob,
      removeItem: () => undefined,
      setItem: () => undefined,
    })),
  });
  try {
    await usePluginStore.persist.rehydrate();
  } finally {
    usePluginStore.persist.setOptions({ storage: original });
  }
}

describe("refreshRevocations", () => {
  beforeEach(() => {
    fetchRevocations.mockReset();
    usePluginStore.setState({
      revocations: null,
      revocationSequenceSeen: {},
      revocationsFetchedAt: 0,
    });
  });

  it("stores a list it can read", async () => {
    fetchRevocations.mockResolvedValue({
      body: JSON.stringify(LIST),
      verified: true,
    });
    await refreshRevocations();
    expect(
      revocationFor("bad", "1.0.0", usePluginStore.getState().revocations),
    ).not.toBeNull();
    expect(usePluginStore.getState().revocationsFetchedAt).toBeGreaterThan(0);
  });

  it("KEEPS the stored list when the host serves an unreadable document", async () => {
    // The mutation that survived review: replacing this path with "store an empty
    // list" was green, while the source argues in two places that it must not happen.
    // A botched deploy would otherwise disarm every client that could reach it.
    usePluginStore.setState({ revocations: LIST });
    for (const payload of ["not json at all", "42", '{"revoked":"nope"}']) {
      fetchRevocations.mockResolvedValue({ body: payload, verified: true });
      await refreshRevocations();
      expect(
        revocationFor("bad", "1.0.0", usePluginStore.getState().revocations),
        payload,
      ).not.toBeNull();
    }
  });

  it("KEEPS the stored list when the fetch fails outright", async () => {
    usePluginStore.setState({ revocations: LIST });
    fetchRevocations.mockRejectedValue(new Error("offline"));
    await refreshRevocations();
    expect(
      revocationFor("bad", "1.0.0", usePluginStore.getState().revocations),
    ).not.toBeNull();
  });

  it("REPLACES the stored list with a well-formed empty one", async () => {
    // The other direction, and it has to work: withdrawing a false positive is the
    // remedy for a revocation that should not have been published. A withdrawal is a NEWER
    // publish, so it carries a higher counter — that is what separates it from the replay
    // below, which is byte-identical apart from the counter.
    usePluginStore.setState({ revocations: LIST });
    fetchRevocations.mockResolvedValue({
      body: '{"version":1,"sequence":2,"revoked":[]}',
      verified: true,
    });
    await refreshRevocations();
    expect(
      revocationFor("bad", "1.0.0", usePluginStore.getState().revocations),
    ).toBeNull();
  });

  it("REFUSES a replay after the user switches registries and comes back", async () => {
    // ‼️ THE ROUND TRIP (security review MEDIUM-1). `setRegistryUrl` clears `revocations` —
    // correctly, ours must not govern someone else's plugins — and that also erased the
    // high-water mark, so on the way back the comparison had nothing to make and accepted
    // anything at or above a floor that is 0 today. An attacker serving the origin could replay
    // an old signed list on the return trip, which is the exact rollback the counter exists to
    // refuse. Within a session; across a restart `MINIMUM_REVOCATION_SEQUENCE` is what stands.
    const first = usePluginStore.getState().registryUrl;
    fetchRevocations.mockResolvedValue({
      body: JSON.stringify({ ...LIST, sequence: 5 }),
      verified: true,
    });
    await refreshRevocations();
    expect(usePluginStore.getState().revocations?.sequence).toBe(5);

    // Away…
    usePluginStore
      .getState()
      .setRegistryUrl("https://elsewhere.test/index.json");
    expect(usePluginStore.getState().revocations).toBeNull();
    // …and back.
    usePluginStore.getState().setRegistryUrl(first);
    expect(usePluginStore.getState().revocations).toBeNull();

    // The replay: an old list, no stored list to compare against.
    // ‼️ WHICH refusal fired is asserted, not just that nothing was stored (code review LOW-5).
    // `toBeNull()` is also the DEFAULT state here — `setRegistryUrl` just cleared it — so on its
    // own it is satisfied by any refusal path, or by no fetch happening at all.
    const refusals = vi.spyOn(logger, "error").mockImplementation(() => {});
    fetchRevocations.mockResolvedValue({
      body: '{"version":1,"sequence":1,"revoked":[]}',
      verified: true,
    });
    await refreshRevocations();
    expect(
      usePluginStore.getState().revocations,
      "a counter this registry already passed must not be accepted again",
    ).toBeNull();
    expect(refusals.mock.calls.flat().join(" ")).toContain(
      "this is a rollback, not a stale cache",
    );
    refusals.mockRestore();
  });

  it("REFUSES an empty list that moves the counter backwards", async () => {
    // ‼️ THE ATTACK A SIGNATURE CANNOT STOP. `{"version":1,"revoked":[]}` was the live
    // document for 31 hours before the first revocation was recorded (registry `395b914` →
    // `aa4a218`), so once the list is signed that empty document holds a VALID signature
    // forever. Replaying it clears every revocation without forging anything.
    //
    // Byte-for-byte the same payload as the withdrawal above; only the counter differs, and
    // that is the entire difference between "the operator took it back" and "someone served
    // you yesterday".
    //
    // ‼️ The floor comes from a VERIFIED fetch, not from `setState`. The stored list's own
    // counter is no longer consulted — it is persisted and therefore poisonable, which was
    // CRITICAL-1 — so the mark has to be established the way a real client establishes it.
    fetchRevocations.mockResolvedValue({
      body: JSON.stringify(LIST),
      verified: true,
    });
    await refreshRevocations();

    // ‼️ WHICH refusal fired is asserted, not just that the list survived (code review MEDIUM).
    // "the stored list is still there" is satisfied by the unreadable-document branch too — and
    // this payload is a perfectly readable document, so if the rollback check were deleted and
    // anything else happened to refuse it, the old assertion alone would still be green.
    const refusals = vi.spyOn(logger, "error").mockImplementation(() => {});
    fetchRevocations.mockResolvedValue({
      body: '{"version":1,"revoked":[]}',
      verified: true,
    });
    await refreshRevocations();
    expect(
      revocationFor("bad", "1.0.0", usePluginStore.getState().revocations),
    ).not.toBeNull();
    expect(refusals.mock.calls.flat().join(" ")).toContain(
      "this is a rollback, not a stale cache",
    );
    refusals.mockRestore();
  });

  it("does NOT let an unverified list poison the floor", async () => {
    // ‼️ CRITICAL-1, the defect this rework exists for. A `trusted` plugin can patch
    // `window.__TAURI_INTERNALS__.invoke` — the transport this refresh uses, an attacker
    // `plugin-lifecycle.ts` already models — and answer with any counter. Honouring it
    // unconditionally turned ONE won race into a permanent disarm: `MAX_SAFE_INTEGER` raised
    // the floor above every counter the registry will ever publish, the value was persisted,
    // and genuine lists at 2, 3, 99 and 1000000 were all refused from then on.
    //
    // Reproduced before the fix; the assertion that matters is the second one — a genuine
    // list must still be able to land afterwards.
    //
    // ‼️ The poison sits just UNDER `MAXIMUM_REVOCATION_SEQUENCE`, not at `MAX_SAFE_INTEGER`.
    // The first version of this test used the latter and was hollow: the upper bound reads it
    // as 0, so the mark stayed 0 no matter what the `verified` gate did, and removing that gate
    // left the test green. Two guards, and the test must exercise the one it names.
    fetchRevocations.mockResolvedValue({
      body: '{"version":1,"sequence":999999,"revoked":[]}',
      verified: false,
    });
    await refreshRevocations();
    const url = usePluginStore.getState().registryUrl;
    expect(
      usePluginStore.getState().revocationSequenceSeen[url] ?? 0,
      "an unverified counter must never raise the mark",
    ).toBe(0);

    fetchRevocations.mockResolvedValue({
      body: JSON.stringify({ ...LIST, sequence: 2 }),
      verified: true,
    });
    await refreshRevocations();
    expect(
      revocationFor("bad", "1.0.0", usePluginStore.getState().revocations),
      "a genuine list must still land after a poisoning attempt",
    ).not.toBeNull();
  });

  it("keeps the mark out of what this app WRITES to storage", () => {
    // ‼️ Named for what it measures, which is `partialize` — the WRITE side. It was called
    // "what a restart restores" and that was wrong in a way that hid a CRITICAL: zustand's
    // default `merge` is `{...currentState, ...persistedState}`, so the read side restores
    // ANY key present in storage whether `partialize` would have written it or not. The
    // rehydration test below is the one that covers restores.
    const persisted = usePluginStore.persist
      .getOptions()
      .partialize?.(usePluginStore.getState());
    expect(Object.keys(persisted ?? {})).not.toContain(
      "revocationSequenceSeen",
    );
  });

  it("keeps the registry URL out of what this app WRITES", () => {
    // ‼️ DEFENCE IN DEPTH, AND NOT THE CONTROL — stated because a mutation proved it. Putting
    // `registryUrl` back into `partialize` leaves every test green, because `merge` forces the
    // reset on the read side regardless. So this pins something weaker than it looks: that we
    // do not keep WRITING a value we no longer restore. Worth pinning anyway — a stale URL
    // sitting in `config.json` reads as authoritative to whoever opens it, and it would silently
    // become live again if the `merge` reset were ever dropped.
    const persisted = usePluginStore.persist
      .getOptions()
      .partialize?.(usePluginStore.getState());
    expect(Object.keys(persisted ?? {})).not.toContain("registryUrl");
  });

  it("does not RESTORE a mark that was written into storage behind partialize's back", async () => {
    // ‼️ CRITICAL-1, third round, and the defect my second and third fixes both missed.
    // `partialize` filters what this app writes; it does not filter what rehydration reads.
    // And the attacker does not need to go through this app to write it: `tauriStorage` is
    // `get_config`/`set_config` (`stores/system/tauri-storage.ts`), and
    // `capabilities/default.json` grants the `main` realm `allow-set-config`. So a consented
    // trusted plugin reads `baram:plugins`, splices in a huge mark, writes it back, and
    // uninstalls itself — no race, no patched `invoke`, and the denial then survives every
    // restart and refuses every future revocation of every OTHER plugin too.
    //
    // Dormant only because enforcement is unarmed today, and it arms with the one-line paste
    // in the follow-up PR. That is why it has to be fixed here.
    const url = usePluginStore.getState().registryUrl;
    await rehydrateWith({ revocationSequenceSeen: { [url]: 1_000_000 } });
    expect(
      usePluginStore.getState().revocationSequenceSeen,
      "a mark planted in storage must not come back into memory",
    ).toEqual({});

    // And the consequence, so this is not merely a shape assertion: the genuine list lands.
    fetchRevocations.mockResolvedValue({
      body: JSON.stringify({ ...LIST, sequence: 2 }),
      verified: true,
    });
    await refreshRevocations();
    expect(
      revocationFor("bad", "1.0.0", usePluginStore.getState().revocations),
      "a planted mark must not refuse a genuine list after a restart",
    ).not.toBeNull();
  });

  it("does not RESTORE a registry URL planted in storage, so the refresh cannot be redirected", async () => {
    // ‼️ THE STRONGER PRIMITIVE THE MARK FIX DID NOT TOUCH (security review HIGH-1). USER
    // DECISION 2026-08-04: stop persisting `registryUrl`.
    //
    // `setRegistryUrl` has no callers anywhere in the app and no UI field, so only an in-realm
    // attacker ever changed it — and one call was PERMANENT, worse than anything the counter
    // could do: the same call clears `revocations` (immediate fail-open), the value survived the
    // restart, and the startup refresh — awaited BEFORE installed plugins load — then fetched
    // the attacker's origin. Rust sees a non-first-party prefix there, so it does not even ask
    // for a signature, reports `verified: false`, and the attacker's empty list is stored and
    // governs. It did NOT self-heal, because the fetch that would heal it was the one aimed at
    // the attacker; and arming verification would not have touched it either.
    await rehydrateWith({ registryUrl: "https://evil.test/r/index.json" });
    expect(usePluginStore.getState().registryUrl).toBe(DEFAULT_REGISTRY_URL);

    // ‼️ THE LOAD-BEARING ASSERTION IS THE FETCH TARGET, not the field. Redirecting that fetch
    // is the whole attack, and a shape assertion alone would not notice if some other code path
    // resolved the URL from the persisted blob instead.
    fetchRevocations.mockResolvedValue({
      body: JSON.stringify(LIST),
      verified: true,
    });
    await refreshRevocations();
    expect(fetchRevocations).toHaveBeenCalledWith(
      "https://sayinel.github.io/baram-plugins/revoked.json",
    );
  });

  it("lets a genuine list land after a restart, even when the session's mark was poisoned", async () => {
    // ‼️ THE SECOND ATTEMPT AT CRITICAL-1, and the first one was wrong in a way worth stating.
    // I had Rust report `verified` and this module decide. That is not a boundary: a `trusted`
    // plugin patching `window.__TAURI_INTERNALS__.invoke` writes the WHOLE answer, `verified`
    // included, so it simply claims true. Confirmed by reproduction — one answer at sequence
    // 1000000 set the mark to 1000000 and genuine lists at 2, 3, 99, 1000 and 999999 were then
    // all refused, and the mark was PERSISTED, so that was forever.
    //
    // The trusted tier cannot be contained from inside it (`capabilities/default.json` gives
    // the `main` realm `allow-set-config` and `allow-export-binary-file`, so a Rust-side mark
    // is writable by the same attacker). What can be refused is the DURABILITY, and that is
    // what this pins: the mark must not outlive the session, so the next launch starts from the
    // compiled floor and a genuine list lands again.
    fetchRevocations.mockResolvedValue({
      body: '{"version":1,"sequence":999999,"revoked":[]}',
      verified: true, // the attacker writes this field too
    });
    await refreshRevocations();
    const url = usePluginStore.getState().registryUrl;
    expect(
      usePluginStore.getState().revocationSequenceSeen[url],
      "in-session, the claimed counter does raise the mark — that half is unavoidable",
    ).toBe(999_999);

    // The restart, driven by the store's OWN partialize: in-memory state is dropped and only
    // what would have been written to disk comes back. If the mark is in that set, the poison
    // returns and the assertion below fails — which is the behaviour, not the shape.
    const persisted = usePluginStore.persist
      .getOptions()
      .partialize?.(usePluginStore.getState());
    usePluginStore.setState({
      revocationSequenceSeen: {},
      ...(persisted as object),
    });
    fetchRevocations.mockResolvedValue({
      body: JSON.stringify({ ...LIST, sequence: 2 }),
      verified: true,
    });
    await refreshRevocations();
    expect(
      revocationFor("bad", "1.0.0", usePluginStore.getState().revocations),
      "after a restart a genuine list must land, or the poison was permanent",
    ).not.toBeNull();
  });

  it("re-reads the store after the fetch, so a slow refresh cannot use a stale floor", async () => {
    // ‼️ HIGH-1. The snapshot is taken before the await and was still being compared against
    // after it. `plugin-lifecycle.ts` races this refresh against a 1500 ms budget and the
    // abandoned promise keeps running, so a slow network followed by the marketplace mounting
    // gave two refreshes in flight — the slow one carrying a pre-await view of the floor. A
    // sequence-1 rollback overwrote a stored sequence 2 that way.
    let release: (v: { body: string; verified: boolean }) => void = () => {};
    const slow = new Promise<{ body: string; verified: boolean }>((resolve) => {
      release = resolve;
    });
    fetchRevocations.mockReturnValueOnce(slow);
    const inflight = refreshRevocations(); // snapshot taken here: mark is 0

    // A second refresh lands first and raises the mark.
    fetchRevocations.mockResolvedValue({
      body: JSON.stringify({ ...LIST, sequence: 5 }),
      verified: true,
    });
    await refreshRevocations();
    const url = usePluginStore.getState().registryUrl;
    expect(usePluginStore.getState().revocationSequenceSeen[url]).toBe(5);

    // Now the abandoned one answers with an OLDER list. It must lose.
    release({
      body: JSON.stringify({ ...LIST, sequence: 1 }),
      verified: true,
    });
    await inflight;
    expect(
      usePluginStore.getState().revocations?.sequence,
      "the slow refresh must not roll the list back using its stale snapshot",
    ).toBe(5);
  });

  it("stores an unverified list but does not trust its counter", async () => {
    // The unarmed state, which is where this ships: the list is still stored (that is today's
    // behaviour and the offline guarantee depends on it) while its counter buys nothing.
    fetchRevocations.mockResolvedValue({
      body: JSON.stringify({ ...LIST, sequence: 7 }),
      verified: false,
    });
    await refreshRevocations();
    const state = usePluginStore.getState();
    expect(revocationFor("bad", "1.0.0", state.revocations)).not.toBeNull();
    expect(state.revocationSequenceSeen[state.registryUrl] ?? 0).toBe(0);
  });
});

describe("the sequence high-water mark", () => {
  it("cannot be walked back down by storing an older list", () => {
    // ‼️ `Math.max` in `setRevocations` was unpinned: the only caller reaches it AFTER
    // `meetsRevocationFloor` has already refused anything lower, so a mutation to plain
    // assignment survived every other test. But `setRevocations` is public store API — a
    // future caller that skips the check would silently lower the mark and re-open the
    // rollback. Exercised directly rather than through the fetch path, which is the only way
    // to reach it.
    const url = usePluginStore.getState().registryUrl;
    usePluginStore.setState({ revocationSequenceSeen: {}, revocations: null });
    usePluginStore.getState().setRevocations({ ...LIST, sequence: 9 }, true);
    expect(usePluginStore.getState().revocationSequenceSeen[url]).toBe(9);

    usePluginStore.getState().setRevocations({ ...LIST, sequence: 2 }, true);
    expect(
      usePluginStore.getState().revocationSequenceSeen[url],
      "the mark must never go down",
    ).toBe(9);
  });

  it("is kept per registry, so one registry cannot raise another's floor", () => {
    // Keyed by URL for a reason: a custom registry legitimately sits at its own counter, and
    // inheriting ours would refuse its list outright.
    usePluginStore.setState({ revocationSequenceSeen: {}, revocations: null });
    usePluginStore.getState().setRegistryUrl("https://a.test/index.json");
    usePluginStore.getState().setRevocations({ ...LIST, sequence: 7 }, true);
    usePluginStore.getState().setRegistryUrl("https://b.test/index.json");
    usePluginStore.getState().setRevocations({ ...LIST, sequence: 1 }, true);
    const seen = usePluginStore.getState().revocationSequenceSeen;
    expect(seen["https://a.test/index.json"]).toBe(7);
    expect(seen["https://b.test/index.json"]).toBe(1);
  });
});

describe("revocationsAreStale", () => {
  const now = 1_000_000_000_000;

  it("is false for a list that has never been fetched", () => {
    // Never fetched is not old, it is absent — a different thing to tell the user,
    // and reporting a 56-year-old list on first run would be nonsense.
    expect(revocationsAreStale(0, now)).toBe(false);
  });

  it("is false for a recent list and true past the threshold", () => {
    expect(revocationsAreStale(now - 1000, now)).toBe(false);
    expect(revocationsAreStale(now - REVOCATION_STALE_AFTER_MS + 1, now)).toBe(
      false,
    );
    expect(revocationsAreStale(now - REVOCATION_STALE_AFTER_MS - 1, now)).toBe(
      true,
    );
  });
});

describe("offline durability", () => {
  it("persists the list, which is the whole point of not caching it", () => {
    // Deleting `revocations` from `partialize` left the entire suite green, and that
    // one line is the difference between "blocking the network cannot undo a
    // revocation" and the opposite. Asserted against what the store actually emits.
    usePluginStore.setState({ revocations: LIST, revocationsFetchedAt: 123 });
    const persisted = usePluginStore.persist
      .getOptions()
      .partialize?.(usePluginStore.getState()) as Record<string, unknown>;
    expect(persisted.revocations).toEqual(LIST);
    expect(persisted.revocationsFetchedAt).toBe(123);
    // Survives the round trip a restart actually performs.
    const rehydrated = JSON.parse(JSON.stringify(persisted)) as {
      revocations: typeof LIST;
    };
    expect(
      revocationFor("bad", "1.0.0", rehydrated.revocations),
    ).not.toBeNull();
  });
});

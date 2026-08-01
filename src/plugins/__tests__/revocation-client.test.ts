// §69 — the fetch/persist half, which had no test file at all.
//
// A review mutated this module and five mutations survived, one of them re-creating the
// exact disarm two separate comments in the source argue must never happen. The
// arithmetic of revocation was well guarded; the plumbing that decides whether a
// revocation is ever STORED was not guarded at all.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRevocations = vi.fn<(url: string) => Promise<string>>();
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginFetchRevocations: (url: string) => fetchRevocations(url),
}));

import type { RevocationList } from "../revocation";

import { usePluginStore } from "../../stores/system/plugin";
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
});

describe("refreshRevocations", () => {
  beforeEach(() => {
    fetchRevocations.mockReset();
    usePluginStore.setState({ revocations: null, revocationsFetchedAt: 0 });
  });

  it("stores a list it can read", async () => {
    fetchRevocations.mockResolvedValue(JSON.stringify(LIST));
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
      fetchRevocations.mockResolvedValue(payload);
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
    // remedy for a revocation that should not have been published.
    usePluginStore.setState({ revocations: LIST });
    fetchRevocations.mockResolvedValue('{"version":1,"revoked":[]}');
    await refreshRevocations();
    expect(
      revocationFor("bad", "1.0.0", usePluginStore.getState().revocations),
    ).toBeNull();
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

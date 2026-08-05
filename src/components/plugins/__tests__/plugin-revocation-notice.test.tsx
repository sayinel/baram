import type { RegistryIndex } from "../../../plugins/types";

// §69 — the notices that say what state revocation protection is actually in.
//
// WHY THIS FILE EXISTS: a security review found that a DISARMED state was indistinguishable
// from a healthy one. `revocationsFetchedAt` is stamped whether or not the list's signature was
// checked, so the staleness warning stayed quiet, and nothing anywhere surfaced `verified` or the
// effective registry. That is the property which made a redirected refresh undetectable — the
// user sees a normal marketplace while holding a list an attacker supplied.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRegistryIndex = vi.fn();
const checkForUpdates = vi.fn();

vi.mock("../../../plugins/registry-client", () => ({
  checkForUpdates: (...a: unknown[]) => checkForUpdates(...a),
  fetchRegistryIndex: (...a: unknown[]) => fetchRegistryIndex(...a),
  searchRegistry: (index: null | RegistryIndex) => index?.plugins ?? [],
}));

// The refresh itself is stubbed out so these cases describe a STORED state rather than racing a
// network call. `revocationsAreStale` stays real — it is part of what is under test.
vi.mock("../../../plugins/revocation-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refreshRevocations: () => Promise.resolve(),
}));

import en from "../../../i18n/en.json";
import { usePluginStore } from "../../../stores/system/plugin";
import { PluginMarketplace } from "../PluginMarketplace";

const LABELS = en as Record<string, string>;
const EMPTY_INDEX: RegistryIndex = { plugins: [], updatedAt: "2026-01-01" };

const LIST = {
  revoked: [
    {
      id: "bad",
      reason: "steals things",
      severity: "malicious" as const,
      versions: "*" as const,
    },
  ],
  sequence: 1,
  version: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchRegistryIndex.mockResolvedValue(EMPTY_INDEX);
  checkForUpdates.mockResolvedValue({});
  usePluginStore.setState({
    devPlugins: {},
    installedPlugins: {},
    installing: {},
    pluginErrors: {},
    registryCache: null,
    registryCacheTime: 0,
    updateAvailable: {},
  });
});

describe("what the marketplace says about revocation state", () => {
  it("says nothing when the stored list was signature-verified", async () => {
    usePluginStore.setState({
      revocations: LIST,
      revocationsFetchedAt: Date.now(),
      revocationsVerified: true,
    });
    render(<PluginMarketplace />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalled());
    expect(screen.queryByText(LABELS["plugin.revoked.unverified"])).toBeNull();
    expect(screen.queryByText(LABELS["plugin.revoked.never"])).toBeNull();
  });

  it("SAYS SO when the stored list was not signature-verified", async () => {
    // ‼️ The whole finding. Before this the two states above and below rendered identically,
    // so a user holding an attacker-supplied list had nothing to notice.
    usePluginStore.setState({
      revocations: LIST,
      revocationsFetchedAt: Date.now(),
      revocationsVerified: false,
    });
    render(<PluginMarketplace />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalled());
    expect(
      screen.getByText(LABELS["plugin.revoked.unverified"]),
    ).toBeInTheDocument();
  });

  it("says 'never received' ALONE before the first fetch, not both notices", async () => {
    // The two must not double up: an unverified list and no list at all are different
    // situations, and stacking both notices would read as two problems.
    usePluginStore.setState({
      revocations: null,
      revocationsFetchedAt: 0,
      revocationsVerified: false,
    });
    render(<PluginMarketplace />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalled());
    expect(
      screen.getByText(LABELS["plugin.revoked.never"]),
    ).toBeInTheDocument();
    expect(screen.queryByText(LABELS["plugin.revoked.unverified"])).toBeNull();
  });
});

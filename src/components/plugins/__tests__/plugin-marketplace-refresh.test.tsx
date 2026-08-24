// §69 Marketplace registry refresh button — always-available force-refresh
import type { InstalledPlugin, RegistryIndex } from "../../../plugins/types";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchRegistryIndex = vi.fn();
const checkForUpdates = vi.fn();

vi.mock("../../../plugins/registry-client", () => ({
  checkForUpdates: (...a: unknown[]) => checkForUpdates(...a),
  fetchRegistryIndex: (...a: unknown[]) => fetchRegistryIndex(...a),
  searchRegistry: (index: null | RegistryIndex) => index?.plugins ?? [],
}));

import { usePluginStore } from "../../../stores/system/plugin";
import { PluginMarketplace } from "../PluginMarketplace";

const emptyIndex: RegistryIndex = { plugins: [], updatedAt: "2026-01-01" };

const samplePlugin = {
  author: "test-author",
  capabilities: [],
  checksum: "abc123",
  description: "A test plugin",
  downloadUrl: "https://example.com/plugin.zip",
  engines: { baram: "^1.0.0" },
  id: "test-plugin",
  license: "MIT",
  name: "Test Plugin",
  version: "1.0.0",
};
const populatedIndex: RegistryIndex = {
  plugins: [samplePlugin],
  updatedAt: "2026-01-01",
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchRegistryIndex.mockResolvedValue(emptyIndex);
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PluginMarketplace registry refresh button", () => {
  it("renders on the browse tab", async () => {
    render(<PluginMarketplace />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalledWith());
    expect(
      screen.getByRole("button", { name: /refresh/i }),
    ).toBeInTheDocument();
  });

  it("does not set color/cursor inline so the stylesheet's hover/active/disabled feedback can apply", async () => {
    // Inline styles beat stylesheet pseudo-class rules. If `color` or `cursor`
    // were set inline here, the .marketplace-refresh-btn:hover/:active color
    // changes and :disabled { cursor } in panels.css would never take effect.
    render(<PluginMarketplace />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalled());
    const btn = screen.getByRole("button", { name: /refresh/i });
    expect(btn.style.color).toBe("");
    expect(btn.style.cursor).toBe("");
  });

  it("does not render on the installed tab", async () => {
    render(<PluginMarketplace />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalled());
    // §69 — "(1)", not "(0)": the badge counts what the panel renders, and this tab now
    // lists built-ins as well as installs. `installedPlugins` is empty here, so the one
    // row is the compiled-in Media Viewer. The old string encoded the pre-built-in world.
    fireEvent.click(screen.getByRole("button", { name: "Installed (1)" }));
    expect(
      screen.queryByRole("button", { name: /refresh/i }),
    ).not.toBeInTheDocument();
  });

  it("calls fetchRegistryIndex(true) then checkForUpdates on click", async () => {
    render(<PluginMarketplace />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalled());
    fetchRegistryIndex.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalledWith(true));
    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(1));
  });

  it("surfaces the error state on a rejected fetch and skips checkForUpdates", async () => {
    render(<PluginMarketplace />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalled());
    fetchRegistryIndex.mockRejectedValueOnce(new Error("network down"));

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() =>
      expect(screen.getByText("Failed to load registry")).toBeInTheDocument(),
    );
    expect(screen.getByText("Error: network down")).toBeInTheDocument();
    expect(checkForUpdates).not.toHaveBeenCalled();
  });

  it("disables both Retry and Refresh buttons while a retry is in flight", async () => {
    fetchRegistryIndex.mockRejectedValueOnce(new Error("network down"));
    render(<PluginMarketplace />);

    await waitFor(() =>
      expect(screen.getByText("Failed to load registry")).toBeInTheDocument(),
    );

    // The retry's fetch never resolves so we can inspect the in-flight state.
    fetchRegistryIndex.mockReturnValueOnce(new Promise(() => {}));

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
      expect(screen.getByRole("button", { name: /refresh/i })).toBeDisabled();
    });
  });

  it("does not surface an error when checkForUpdates rejects after a successful refresh", async () => {
    render(<PluginMarketplace />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalled());

    fetchRegistryIndex.mockResolvedValueOnce(populatedIndex);
    checkForUpdates.mockRejectedValueOnce(new Error("update check failed"));

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() =>
      expect(screen.getByText("Test Plugin")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("Failed to load registry"),
    ).not.toBeInTheDocument();
  });

  it("shows a Refreshing… label while the refresh fetch is in flight", async () => {
    render(<PluginMarketplace />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalled());

    // Deferred promise so we can observe the in-flight label before resolving.
    let resolveFetch: (index: RegistryIndex) => void = () => {};
    fetchRegistryIndex.mockReturnValueOnce(
      new Promise<RegistryIndex>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "↻ Refreshing…" }),
      ).toBeInTheDocument(),
    );

    resolveFetch(emptyIndex);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "↻ Refresh" }),
      ).toBeInTheDocument(),
    );
  });

  // ‼️ §69 fix round 1, Important 2 — a badge must count what its panel renders.
  //
  // `updatesCount` counted every key in `updateAvailable` while the panel rendered entries
  // filtered to installed-and-still-listed. `removePlugin` never cleared that map (fixed at
  // the root in the store), so uninstalling a plugin with a pending update left a stale key:
  // nonzero badge, empty panel, and no "no updates" message either — that branch is skipped
  // when the count is nonzero. The store fix covers the uninstall route; this covers every
  // other way an entry can vanish, a withdrawn listing being the obvious one.
  describe("the Updates badge and its panel agree", () => {
    it("reads zero, and says so, for an update whose plugin is not installed", async () => {
      usePluginStore.setState({ updateAvailable: { ghost: "2.0.0" } });
      render(<PluginMarketplace />);
      await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalled());

      const tab = screen.getByRole("button", { name: /^Updates/ });
      expect(tab.textContent).toContain("(0)");

      // The message the count used to suppress: a nonzero badge skipped this branch, so
      // the user got a blank panel with no explanation.
      fireEvent.click(tab);
      expect(
        screen.getByText("All plugins are up to date"),
      ).toBeInTheDocument();
    });

    it("counts one when the plugin IS installed and still listed", async () => {
      // The complement — without it the assertion above passes for a badge stuck at zero.
      fetchRegistryIndex.mockResolvedValue(populatedIndex);
      usePluginStore.setState({
        installedPlugins: {
          "test-plugin": {
            checksum: "abc123",
            enabled: true,
            installedAt: 0,
            installPath: "/p/test-plugin",
            manifest: { ...samplePlugin, main: "index.mjs" },
            updatedAt: 0,
          } as unknown as InstalledPlugin,
        },
        updateAvailable: { "test-plugin": "2.0.0" },
      });
      render(<PluginMarketplace />);

      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /^Updates/ }).textContent,
        ).toContain("(1)"),
      );
    });
  });

  it("surfaces a store-level plugin error on the Browse tab card", async () => {
    const wordCountEntry = {
      author: "baram",
      capabilities: [],
      checksum: "abc123",
      description: "Word count plugin",
      downloadUrl: "https://example.com/word-count.zip",
      engines: { baram: "^1.0.0" },
      id: "baram-word-count",
      license: "MIT",
      name: "Word Count",
      version: "1.0.0",
    };
    fetchRegistryIndex.mockResolvedValue({
      plugins: [wordCountEntry],
      updatedAt: "2026-01-01",
    });
    usePluginStore.setState({
      pluginErrors: {
        "baram-word-count": "Checksum mismatch: expected abc123, got def456",
      },
    });

    render(<PluginMarketplace />);

    await waitFor(() =>
      expect(screen.getByText("Word Count")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Checksum mismatch: expected abc123, got def456/),
    ).toBeInTheDocument();
  });
});

// §260 Phase 5 removed the "plugins are disabled in this build" screen along with the
// gate that produced it. Nothing replaced the assertion, because nothing replaced the
// behaviour: the marketplace is now always available, and what a user may install is
// decided by the consent dialog and the registry cross-check
// (`plugin-install-consent.test.tsx`).

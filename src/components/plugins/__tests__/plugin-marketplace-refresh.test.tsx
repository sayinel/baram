// §69 Marketplace registry refresh button — always-available force-refresh
import type { RegistryIndex } from "../../../plugins/types";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("PluginMarketplace registry refresh button", () => {
  it("renders on the browse tab", async () => {
    render(<PluginMarketplace />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalledWith());
    expect(
      screen.getByRole("button", { name: /refresh/i }),
    ).toBeInTheDocument();
  });

  it("does not render on the installed tab", async () => {
    render(<PluginMarketplace />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Installed (0)" }));
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
});

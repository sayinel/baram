// The Installed tab must explain a load failure, not just badge it.
//
// WHY: `legacyInstallMessage` tells a v0.4.x user what to do about a plugin v0.5.0 can no
// longer load. That message is useless if they never see it. The error TEXT was rendered in
// three places — the Browse card, the Updates card, and the detail view — and every one of
// them iterates the REGISTRY. The Installed tab, the only surface that lists what is actually
// on disk, showed a bare "Error" chip.
//
// So for a plugin whose registry entry is gone — `baram-ai-summary`, withdrawn in §260
// Phase 6 and deleted from the live index — the explanation was unreachable: not on Browse
// (no entry), not on Updates (`checkForUpdates` skips trust-less entries), and not in the
// detail view (only reachable from those two). The user got a red chip and no sentence.
//
// The registry is mocked EMPTY here, which is exactly that case.
import type { InstalledPlugin, RegistryIndex } from "../../../plugins/types";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: {
    loadPlugin: vi.fn(),
    unloadPlugin: vi.fn(),
  },
}));
vi.mock("../../../plugins/registry-client", () => ({
  checkForUpdates: () => Promise.resolve({}),
  // EMPTY on purpose — a withdrawn plugin has no entry, so nothing registry-driven can
  // render its error. If this ever gains an entry the test stops proving the point.
  fetchRegistryIndex: () =>
    Promise.resolve({ plugins: [] } satisfies RegistryIndex),
  searchRegistry: () => [],
}));

import { legacyInstallMessage } from "../../../plugins/plugin-trust";
import { usePluginStore } from "../../../stores/system/plugin";
import { PluginMarketplace } from "../PluginMarketplace";

/** A v0.4.x install: no `trust`, because that field did not exist yet. */
const legacyInstall = {
  checksum: "abc",
  enabled: true,
  installedAt: 0,
  installPath: "/p/baram-ai-summary",
  manifest: {
    author: "Baram",
    capabilities: ["ai"],
    dependencies: [],
    description: "Summarize the current note",
    engines: { baram: ">=0.3.0" },
    id: "baram-ai-summary",
    license: "Apache-2.0",
    main: "index.mjs",
    name: "AI Summary",
    version: "1.0.0",
  },
  updatedAt: 0,
} as unknown as InstalledPlugin;

function openInstalledTab(): void {
  render(<PluginMarketplace />);
  fireEvent.click(screen.getByRole("button", { name: /^Installed / }));
}

describe("Installed tab surfaces the load error text", () => {
  beforeEach(() => {
    usePluginStore.setState({
      installedPlugins: { "baram-ai-summary": legacyInstall },
      pluginErrors: {},
      updateAvailable: {},
    });
  });

  it("shows the whole sentence, not just an Error chip", () => {
    usePluginStore.setState({
      pluginErrors: { "baram-ai-summary": legacyInstallMessage() },
    });
    openInstalledTab();

    // The remedy is the part that has to reach the user, so that is what is asserted —
    // matching on the message's own words rather than the full string, which would pin copy.
    expect(screen.getByText(/no longer be loaded/)).toBeInTheDocument();
    expect(
      screen.getByText(/Use Remove on the Installed tab/),
    ).toBeInTheDocument();
  });

  it("names a control that exists on this very tab", () => {
    // The first draft of the message said "Uninstall it here". That is the PluginCard label,
    // and PluginCard is never rendered on this tab — the button here is "Remove". Advice
    // naming an absent control sends the user looking for something that is not there.
    usePluginStore.setState({
      pluginErrors: { "baram-ai-summary": legacyInstallMessage() },
    });
    openInstalledTab();

    const named = /Remove/.exec(legacyInstallMessage());
    expect(named, "the message must name a control").not.toBeNull();
    expect(screen.getByRole("button", { name: named![0] })).toBeInTheDocument();
  });

  it("renders no error region for a plugin that loaded fine", () => {
    // The complement: without it, unconditionally rendering the block would pass the tests
    // above while putting an empty red banner on every healthy plugin.
    openInstalledTab();

    expect(screen.queryByText(/no longer be loaded/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^⚠/)).not.toBeInTheDocument();
  });
});

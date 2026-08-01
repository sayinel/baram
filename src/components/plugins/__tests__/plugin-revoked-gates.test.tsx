// §69 — the marketplace's two revocation gates, which had no coverage at all.
//
// A review wrapped each gate in `false &&` and the whole suite stayed green. Both are
// security gates, so this asserts the thing that actually matters: the DOWNLOAD never
// happened. "An error string appeared" is compatible with the ZIP having already been
// fetched and extracted, and on the update path it is compatible with the user's
// working plugin having already been deleted.
import type { RegistryEntry, RegistryIndex } from "../../../plugins/types";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pluginInstall = vi.fn();
const pluginUninstall = vi.fn();

vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: { loadPlugin: vi.fn(), unloadPlugin: vi.fn() },
}));
vi.mock("../../../ipc/plugin-invoke", () => ({
  pluginFetchRevocations: () => Promise.reject(new Error("offline")),
  pluginInstall: (...a: unknown[]) => pluginInstall(...a),
  pluginUninstall: (...a: unknown[]) => pluginUninstall(...a),
}));
vi.mock("../../../ipc/invoke", () => ({
  getConfig: () => Promise.resolve(null),
  readFile: () => Promise.reject(new Error("no README")),
  removeConfig: () => Promise.resolve(),
  setConfig: () => Promise.resolve(),
}));
vi.mock("../../../plugins/registry-client", () => ({
  checkForUpdates: () => Promise.resolve({ demo: "1.0.0" }),
  fetchRegistryIndex: () =>
    Promise.resolve({ plugins: [ENTRY] } satisfies RegistryIndex),
  searchRegistry: () => [ENTRY],
}));

import type { RevocationSeverity } from "../../../plugins/revocation";

import { usePluginStore } from "../../../stores/system/plugin";
import { PluginMarketplace } from "../PluginMarketplace";

const ENTRY: RegistryEntry = {
  author: "Baram",
  capabilities: ["editor"],
  checksum: "sha256:abc",
  description: "a demo plugin",
  downloadUrl: "https://example.com/demo.zip",
  engines: { baram: "*" },
  id: "demo",
  license: "MIT",
  name: "Demo",
  trust: "sandboxed",
  version: "1.0.0",
};

function revoke(severity: RevocationSeverity): void {
  usePluginStore.setState({
    revocations: {
      revoked: [
        { id: "demo", reason: "steals things", severity, versions: "*" },
      ],
      version: 1,
    },
  });
}

describe("the marketplace install gate (§69)", () => {
  beforeEach(() => {
    pluginInstall.mockReset();
    pluginUninstall.mockReset();
    usePluginStore.setState({
      installedPlugins: {},
      pluginErrors: {},
      revocations: null,
    });
  });

  it.each(["malicious", "unlisted", "vulnerable"] as const)(
    "never downloads a %s-revoked plugin",
    async (severity) => {
      // Install is refused for EVERY severity, unlike loading. A revocation always
      // means "do not newly acquire this"; only malware is worth taking a working
      // plugin away over.
      revoke(severity);
      render(<PluginMarketplace />);
      fireEvent.click(await screen.findByRole("button", { name: /^Install$/ }));

      await waitFor(() =>
        expect(usePluginStore.getState().pluginErrors.demo).toBeTruthy(),
      );
      expect(pluginInstall).not.toHaveBeenCalled();
    },
  );

  it("badges a revoked listing in the LIST, and not an unlisted one", async () => {
    // Rendering PluginCard directly with an explicit `revoked` prop does not test this:
    // a review mutation setting `revoked={false}` at both marketplace call sites
    // survived that. What has to be pinned is what the marketplace PASSES.
    revoke("malicious");
    const { unmount } = render(<PluginMarketplace />);
    expect(await screen.findByText("Withdrawn")).toBeInTheDocument();
    unmount();

    // `unlisted` is bookkeeping and the spec forbids surfacing it — a badge whose
    // detail view then explains nothing is worse than no badge.
    revoke("unlisted");
    render(<PluginMarketplace />);
    await screen.findByRole("button", { name: /^Install$/ });
    expect(screen.queryByText("Withdrawn")).toBeNull();
  });

  it("downloads normally when nothing is revoked", async () => {
    // Without this the assertions above would also pass for a marketplace whose
    // Install button does nothing at all.
    pluginInstall.mockResolvedValue({
      checksum: "sha256:abc",
      install_path: "/p/demo",
      manifest: { ...ENTRY, main: "index.mjs" },
    });
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Install$/ }));

    // The consent dialog stands between the click and the download.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
  });
});

describe("the marketplace update gate (§69)", () => {
  beforeEach(() => {
    pluginInstall.mockReset();
    pluginUninstall.mockReset();
    usePluginStore.setState({
      installedPlugins: {
        demo: {
          checksum: "sha256:old",
          installedAt: 0,
          updatedAt: 0,
          consent: { capabilities: ["editor"], trust: "sandboxed" },
          enabled: true,
          installPath: "/p/demo",
          manifest: {
            author: ENTRY.author,
            capabilities: ENTRY.capabilities,
            description: ENTRY.description,
            engines: ENTRY.engines,
            id: ENTRY.id,
            license: ENTRY.license,
            main: "index.mjs",
            name: ENTRY.name,
            trust: "sandboxed",
            version: "0.9.0",
          },
        },
      },
      pluginErrors: {},
      revocations: null,
      updateAvailable: { demo: "1.0.0" },
    });
  });

  it("never uninstalls the working copy when the update target is revoked", async () => {
    // The ordering this pins: an update is uninstall-then-install, so a target caught
    // only at the install step would leave the user with their plugin already deleted
    // and the replacement refused. The gate sits above the uninstall for that reason.
    revoke("malicious");
    render(<PluginMarketplace />);
    // Driven from the INSTALLED tab, which is where a revoked plugin is actually
    // reachable: once it is pulled from the index, Browse and Updates both lose it.
    // Its row action is "Update"; the Updates tab's card says "Update to 1.0.0", and
    // an /Update/i query matches the "Updates (1)" TAB before either.
    fireEvent.click(await screen.findByRole("button", { name: /^Installed/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Update$/ }));

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toBeTruthy(),
    );
    expect(pluginUninstall).not.toHaveBeenCalled();
    expect(pluginInstall).not.toHaveBeenCalled();
  });
});

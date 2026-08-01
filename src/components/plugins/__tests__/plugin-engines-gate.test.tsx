// §69 — the two `engines.baram` gates, mirroring `plugin-revoked-gates.test.tsx`.
//
// The floor was declared by every plugin and evaluated by nothing, so what these assert
// is the same thing the revocation gates assert: the DOWNLOAD never happened, and on the
// update path the working copy was never DELETED. `plugin-release.yml` names that outcome
// exactly — "destroys a working older version on update" — and it is reachable only
// through the ordering, so an error string alone would not pin it.
import type { RegistryEntry, RegistryIndex } from "../../../plugins/types";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pluginInstall = vi.fn();
const pluginUninstall = vi.fn();
const getVersion = vi.fn();

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => getVersion() as Promise<string>,
}));
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

import { usePluginStore } from "../../../stores/system/plugin";
import { PluginMarketplace } from "../PluginMarketplace";

/** The listing declares a floor the app under test will not meet. */
const ENTRY: RegistryEntry = {
  author: "Baram",
  capabilities: ["editor"],
  checksum: "sha256:abc",
  description: "a demo plugin",
  downloadUrl: "https://example.com/demo.zip",
  engines: { baram: ">=9.0.0" },
  id: "demo",
  license: "MIT",
  name: "Demo",
  trust: "sandboxed",
  version: "1.0.0",
};

describe("the marketplace version-floor gate (§69)", () => {
  beforeEach(() => {
    pluginInstall.mockReset();
    pluginUninstall.mockReset();
    getVersion.mockReset();
    usePluginStore.setState({
      installedPlugins: {},
      pluginErrors: {},
      revocations: null,
    });
  });

  it("never downloads a plugin whose floor this app is below", async () => {
    getVersion.mockResolvedValue("0.5.1");
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Install$/ }));

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toBeTruthy(),
    );
    // Both numbers are in the message: without the floor the user does not know what to
    // update TO, and without their own version they cannot tell whether they already did.
    expect(usePluginStore.getState().pluginErrors.demo).toContain("9.0.0");
    expect(usePluginStore.getState().pluginErrors.demo).toContain("0.5.1");
    expect(pluginInstall).not.toHaveBeenCalled();
  });

  it("refuses before asking for consent", async () => {
    // A consent dialog for a plugin that will then be refused trains the user to click
    // through capability grants for nothing.
    getVersion.mockResolvedValue("0.5.1");
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Install$/ }));

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toBeTruthy(),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("downloads when the app satisfies the floor", async () => {
    // Without this the assertions above would also pass for an Install button that does
    // nothing at all.
    getVersion.mockResolvedValue("9.1.0");
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Install$/ }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("proceeds when the app version cannot be read at all", async () => {
    // The direction of doubt: an app that cannot report its own version must not become
    // an app that installs nothing. Refusing here would punish the user for our defect.
    getVersion.mockRejectedValue(new Error("no IPC"));
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Install$/ }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("the marketplace update floor gate (§69)", () => {
  beforeEach(() => {
    pluginInstall.mockReset();
    pluginUninstall.mockReset();
    getVersion.mockReset();
    usePluginStore.setState({
      installedPlugins: {
        demo: {
          checksum: "sha256:old",
          consent: { capabilities: ["editor"], trust: "sandboxed" },
          enabled: true,
          installedAt: 0,
          installPath: "/p/demo",
          manifest: {
            author: ENTRY.author,
            capabilities: ENTRY.capabilities,
            description: ENTRY.description,
            // The INSTALLED version's floor is met — it is the update TARGET's that is
            // not. A gate reading the wrong one would let this through.
            engines: { baram: ">=0.5.0" },
            id: ENTRY.id,
            license: ENTRY.license,
            main: "index.mjs",
            name: ENTRY.name,
            trust: "sandboxed",
            version: "0.9.0",
          },
          updatedAt: 0,
        },
      },
      pluginErrors: {},
      revocations: null,
      updateAvailable: { demo: "1.0.0" },
    });
  });

  it("never uninstalls the working copy when the update target needs a newer app", async () => {
    getVersion.mockResolvedValue("0.5.1");
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Installed/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Update$/ }));

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toBeTruthy(),
    );
    expect(pluginUninstall).not.toHaveBeenCalled();
    expect(pluginInstall).not.toHaveBeenCalled();
  });
});

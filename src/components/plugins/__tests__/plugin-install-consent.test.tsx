// §260 Phase 5 — consent is collected against the REGISTRY ENTRY, which is a claim, and
// verified against the manifest inside the downloaded ZIP, which is the truth.
//
// These tests exist because that verification is the only thing standing between "the
// user approved a sandboxed plugin" and "a trusted plugin is now running in the app's
// own realm". A registry that lies, or a download URL swapped for one whose checksum
// entry was updated with it, is exactly the case the consent step would otherwise wave
// through.
//
// They also pin the persistence ordering: nothing reaches the store until every check
// has passed. Before Phase 5 the record was written first and validated only inside
// `loadPlugin`, whose rejection merely set an error string.
import type { RustInstalledPluginInfo } from "../../../ipc/plugin-invoke";
import type {
  PluginConsent,
  PluginManifest,
  RegistryEntry,
  RegistryIndex,
} from "../../../plugins/types";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadPlugin = vi.fn();
const unloadPlugin = vi.fn();
const pluginInstall = vi.fn();
const pluginUninstall = vi.fn();

vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: {
    loadPlugin: (...a: unknown[]) => loadPlugin(...a),
    unloadPlugin: (...a: unknown[]) => unloadPlugin(...a),
  },
}));
vi.mock("../../../ipc/plugin-invoke", () => ({
  pluginInstall: (...a: unknown[]) => pluginInstall(...a),
  pluginUninstall: (...a: unknown[]) => pluginUninstall(...a),
}));
// `tauriStorage` (the plugin store's persist backend) reaches for these; without them
// every store write logs a mock-resolution error and drowns the real output.
vi.mock("../../../ipc/invoke", () => ({
  getConfig: () => Promise.resolve(null),
  readFile: () => Promise.reject(new Error("no README")),
  removeConfig: () => Promise.resolve(),
  setConfig: () => Promise.resolve(),
}));

let listed: RegistryEntry[] = [];
vi.mock("../../../plugins/registry-client", () => ({
  checkForUpdates: () => Promise.resolve({}),
  fetchRegistryIndex: () =>
    Promise.resolve({ plugins: listed } satisfies RegistryIndex),
  searchRegistry: () => listed,
}));

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

const MANIFEST: PluginManifest = {
  author: "Baram",
  capabilities: ["editor"],
  description: "a demo plugin",
  engines: { baram: "*" },
  id: "demo",
  license: "MIT",
  main: "index.mjs",
  name: "Demo",
  trust: "sandboxed",
  version: "1.0.0",
};

/** Render the browse tab and click Install on the single listed entry. */
async function clickInstall() {
  render(<PluginMarketplace />);
  fireEvent.click(await screen.findByRole("button", { name: /^Install$/ }));
}

/**
 * The consent dialog's confirm button — scoped to the dialog, because the card behind it
 * still offers its own "Install" and an unscoped query would match both.
 */
async function confirmConsent() {
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: /^Install$/ }));
}

function downloadReturns(manifest: PluginManifest) {
  pluginInstall.mockResolvedValue({
    checksum: "sha256:abc",
    install_path: "/p/demo",
    manifest,
  } as unknown as RustInstalledPluginInfo);
}

/** Seed an already-installed plugin carrying `consent`, with an update available. */
function installedAt(consent: PluginConsent) {
  usePluginStore.setState({
    installedPlugins: {
      demo: {
        checksum: "sha256:abc",
        consent,
        enabled: true,
        installedAt: 0,
        installPath: "/p/demo",
        manifest: { ...MANIFEST, capabilities: consent.capabilities },
        updatedAt: 0,
      },
    },
    updateAvailable: { demo: "2.0.0" },
  });
}

describe("install consent + registry cross-check (§260 Phase 5)", () => {
  beforeEach(() => {
    listed = [ENTRY];
    loadPlugin.mockReset().mockResolvedValue(undefined);
    unloadPlugin.mockReset().mockResolvedValue(undefined);
    pluginInstall.mockReset();
    pluginUninstall.mockReset().mockResolvedValue(undefined);
    downloadReturns(MANIFEST);
    usePluginStore.setState({
      installedPlugins: {},
      pluginErrors: {},
      updateAvailable: {},
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("asks before downloading anything", async () => {
    await clickInstall();
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(pluginInstall).not.toHaveBeenCalled();
  });

  it("downloads nothing when the dialog is cancelled", async () => {
    await clickInstall();
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(pluginInstall).not.toHaveBeenCalled();
    expect(usePluginStore.getState().installedPlugins.demo).toBeUndefined();
  });

  it("records the consent alongside the plugin on success", async () => {
    await clickInstall();
    await confirmConsent();
    await waitFor(() =>
      expect(usePluginStore.getState().installedPlugins.demo?.consent).toEqual({
        capabilities: ["editor"],
        trust: "sandboxed",
      }),
    );
    expect(loadPlugin).toHaveBeenCalledWith("/p/demo", MANIFEST);
  });

  it("persists nothing when the download's trust exceeds what was approved", async () => {
    // The registry advertised "sandboxed"; the archive declares "trusted".
    downloadReturns({ ...MANIFEST, trust: "trusted" });
    await clickInstall();
    await confirmConsent();

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain("trusted"),
    );
    expect(usePluginStore.getState().installedPlugins.demo).toBeUndefined();
    expect(pluginUninstall).toHaveBeenCalledWith("demo");
    expect(loadPlugin).not.toHaveBeenCalled();
  });

  it("persists nothing when the download requests an unapproved capability", async () => {
    downloadReturns({ ...MANIFEST, capabilities: ["editor", "network"] });
    await clickInstall();
    await confirmConsent();

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain("network"),
    );
    expect(usePluginStore.getState().installedPlugins.demo).toBeUndefined();
    expect(pluginUninstall).toHaveBeenCalledWith("demo");
  });

  it("persists nothing when the downloaded manifest fails validation", async () => {
    // Reaches the store at all only because validation used to live inside
    // `loadPlugin`, which runs after `addPlugin`.
    downloadReturns({ ...MANIFEST, trust: undefined as never });
    await clickInstall();
    await confirmConsent();

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain("invalid"),
    );
    expect(usePluginStore.getState().installedPlugins.demo).toBeUndefined();
    expect(pluginUninstall).toHaveBeenCalled();
  });

  it("persists nothing when the archive installs under a different id", async () => {
    downloadReturns({ ...MANIFEST, id: "other" });
    await clickInstall();
    await confirmConsent();

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain("other"),
    );
    expect(usePluginStore.getState().installedPlugins.demo).toBeUndefined();
    expect(usePluginStore.getState().installedPlugins.other).toBeUndefined();
    // Rolled back under the id the files actually landed under, not the listing's.
    expect(pluginUninstall).toHaveBeenCalledWith("other");
  });

  it("does not check a tiptapExtensions plugin any more loosely", async () => {
    // This path skips `loadPlugin` entirely (tiptap extensions need a restart), and
    // `loadPlugin` was where validation used to live — so before Phase 5 this was the
    // one install that reached the store with a manifest nothing had ever inspected.
    //
    // It has to be a TRUSTED manifest: the validator only permits `tiptapExtensions`
    // for the trusted tier, since they run in the main realm.
    listed = [{ ...ENTRY, capabilities: ["editor"], trust: "trusted" }];
    downloadReturns({
      ...MANIFEST,
      capabilities: ["editor", "network"],
      tiptapExtensions: [{ exportName: "X", name: "x", type: "node" as const }],
      trust: "trusted",
    });

    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Install$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Install$/ }));

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain("network"),
    );
    expect(usePluginStore.getState().installedPlugins.demo).toBeUndefined();
    expect(loadPlugin).not.toHaveBeenCalled();
  });

  it("asks again when an update adds a capability", async () => {
    // The escalation this phase exists to stop, in its milder form. `handleUpdate` must
    // read the recorded consent BEFORE uninstalling — `handleUninstall` calls
    // `removePlugin`, which deletes the record being compared against.
    installedAt({ capabilities: ["editor"], trust: "sandboxed" });
    listed = [
      { ...ENTRY, capabilities: ["editor", "network"], version: "2.0.0" },
    ];
    downloadReturns({ ...MANIFEST, capabilities: ["editor", "network"] });

    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Updates/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Update to v/ }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("NEW");
    fireEvent.click(within(dialog).getByRole("button", { name: /install/i }));

    await waitFor(() =>
      expect(usePluginStore.getState().installedPlugins.demo?.consent).toEqual({
        capabilities: ["editor", "network"],
        trust: "sandboxed",
      }),
    );
  });

  it("does not ask when an update stays within the recorded consent", async () => {
    installedAt({ capabilities: ["editor", "network"], trust: "sandboxed" });
    listed = [{ ...ENTRY, capabilities: ["editor"], version: "2.0.0" }];
    downloadReturns({ ...MANIFEST, capabilities: ["editor"] });

    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Updates/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Update to v/ }),
    );

    // Narrower than what was approved, so no prompt — and the record NARROWS with it,
    // rather than carrying the wider old grant forward past the version that needed it.
    await waitFor(() =>
      expect(usePluginStore.getState().installedPlugins.demo?.consent).toEqual({
        capabilities: ["editor"],
        trust: "sandboxed",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuses a legacy entry outright, without a dialog or a download", async () => {
    listed = [{ ...ENTRY, trust: undefined }];
    render(<PluginMarketplace />);
    const install = await screen.findByRole("button", { name: /^Install$/ });
    fireEvent.click(install);

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain(
        "predates Baram's plugin trust model",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pluginInstall).not.toHaveBeenCalled();
  });
});

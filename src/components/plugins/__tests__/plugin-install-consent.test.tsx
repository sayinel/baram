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

  it("tells the user the plugin is gone when an update fails its checks", async () => {
    // An update is uninstall-then-install, so a rejected download leaves NOTHING
    // installed — the working version was already removed. Phase 5 adds three new ways
    // for the second half to fail, so this outcome has to be stated rather than left as
    // a bare error next to an empty slot.
    installedAt({ capabilities: ["editor"], trust: "sandboxed" });
    listed = [{ ...ENTRY, version: "2.0.0" }];
    downloadReturns({ ...MANIFEST, trust: "trusted" }); // exceeds the recorded consent

    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Updates/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Update to v/ }),
    );

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toMatch(
        /no longer installed/i,
      ),
    );
    // Both halves: the reason it failed AND the consequence.
    expect(usePluginStore.getState().pluginErrors.demo).toContain("trusted");
    expect(usePluginStore.getState().installedPlugins.demo).toBeUndefined();
  });

  it("keeps a plugin that installed but failed to start — files and record both", async () => {
    // The rollback marker is cleared once every check has passed, and that line is
    // load-bearing: without it a failing `loadPlugin` deletes the extracted files while
    // `addPlugin` has already persisted the record, leaving an entry pointing at nothing.
    // A plugin that installs and fails to activate is installed-but-broken, which the
    // error badge says and the enable toggle can retry.
    loadPlugin.mockRejectedValue(new Error("activate timed out"));
    await clickInstall();
    await confirmConsent();

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain(
        "activate timed out",
      ),
    );
    expect(usePluginStore.getState().installedPlugins.demo).toBeDefined();
    expect(pluginUninstall).not.toHaveBeenCalled();
  });

  it("calls an update an update, even when there is no consent record to compare", async () => {
    // §260 Phase 5 code review (M2). `backfillConsent` deliberately leaves a legacy
    // (trust-less) manifest without a record, so `consentRequired` returns
    // "first-install" — and the dialog used to derive its wording from that, titling
    // itself Install over a button that updates. Only the caller knows which it is.
    usePluginStore.setState({
      installedPlugins: {
        demo: {
          checksum: "sha256:abc",
          enabled: true,
          installedAt: 0,
          installPath: "/p/demo",
          manifest: MANIFEST, // no `consent` — the migration skipped it
          updatedAt: 0,
        },
      },
      updateAvailable: { demo: "2.0.0" },
    });
    listed = [{ ...ENTRY, version: "2.0.0" }];

    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Updates/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Update to v/ }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading").textContent).toMatch(/update/i);
    expect(within(dialog).getByRole("heading").textContent).not.toMatch(
      /^Install/i,
    );
  });

  it("will not update from an entry that is not in the registry listing", async () => {
    // §260 Phase 5 code review (H2). The Installed tab synthesises a RegistryEntry out of
    // the installed manifest with `downloadUrl: ""`, so an update from there uninstalled
    // the plugin and then failed to reinstall it — destroying it every time. It also
    // computed consent against the manifest ALREADY INSTALLED, so the escalation check
    // was unconditionally silent on that path.
    installedAt({ capabilities: ["editor"], trust: "sandboxed" });
    listed = []; // the registry has no such plugin

    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Installed/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Update$/ }));

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toMatch(
        /not in the registry/i,
      ),
    );
    // The plugin is untouched — not uninstalled, not downloaded.
    expect(unloadPlugin).not.toHaveBeenCalled();
    expect(pluginUninstall).not.toHaveBeenCalled();
    expect(pluginInstall).not.toHaveBeenCalled();
    expect(usePluginStore.getState().installedPlugins.demo).toBeDefined();
  });

  it("checks the listing's capabilities on an update, not the installed manifest's", async () => {
    // The other half of H2: resolving the real entry is what makes the escalation check
    // reachable from the Installed tab at all.
    installedAt({ capabilities: ["editor"], trust: "sandboxed" });
    listed = [
      { ...ENTRY, capabilities: ["editor", "network"], version: "2.0.0" },
    ];

    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Installed/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Update$/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("NEW");
  });

  it("does not reinstall over a plugin whose removal failed", async () => {
    // §260 Phase 5 code review. `handleUninstall` swallows its failure by design, so the
    // old record survives — and a presence check after the failed reinstall would then
    // see it and report success for an update that never happened.
    installedAt({ capabilities: ["editor"], trust: "sandboxed" });
    listed = [{ ...ENTRY, version: "2.0.0" }];
    unloadPlugin.mockRejectedValue(new Error("teardown wedged"));

    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Updates/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Update to v/ }),
    );

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain(
        "teardown wedged",
      ),
    );
    expect(pluginInstall).not.toHaveBeenCalled();
    // Still installed, and the badge still says an update is available.
    expect(usePluginStore.getState().installedPlugins.demo).toBeDefined();
    expect(usePluginStore.getState().updateAvailable.demo).toBe("2.0.0");
  });

  it("does not even offer Install for a legacy entry in the Browse list", async () => {
    // §260 Phase 5 code review (M1) — this used to click an ENABLED button and assert the
    // resulting error, which pinned the gap instead of catching it. Both live registry
    // entries are trust-less, so Browse is where a user meets this first.
    listed = [{ ...ENTRY, trust: undefined }];
    render(<PluginMarketplace />);

    const install = await screen.findByRole("button", { name: /^Install$/ });
    expect(install.hasAttribute("disabled")).toBe(true);
    fireEvent.click(install);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pluginInstall).not.toHaveBeenCalled();
  });

  it("refuses a legacy entry in the handler too, if a button ever gets through", async () => {
    // Defence in depth: the disabled button is UI, the handler is the rule.
    listed = [{ ...ENTRY, trust: undefined }];
    render(<PluginMarketplace />);
    await screen.findByRole("button", { name: /^Install$/ });

    fireEvent.click(screen.getByRole("button", { name: /^Installed/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(pluginInstall).not.toHaveBeenCalled();
  });
});

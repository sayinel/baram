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
const pluginInstallStage = vi.fn();
const pluginInstallCommit = vi.fn();
const pluginInstallDiscard = vi.fn();
const pluginUninstall = vi.fn();

vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: {
    loadPlugin: (...a: unknown[]) => loadPlugin(...a),
    unloadPlugin: (...a: unknown[]) => unloadPlugin(...a),
  },
}));
vi.mock("../../../ipc/plugin-invoke", () => ({
  pluginInstallCommit: (...a: unknown[]) => pluginInstallCommit(...a),
  pluginInstallDiscard: (...a: unknown[]) => pluginInstallDiscard(...a),
  pluginInstallStage: (...a: unknown[]) => pluginInstallStage(...a),
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
  engines: { baram: ">=0.1.0" },
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
  engines: { baram: ">=0.1.0" },
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

/**
 * #261 — installing is stage-then-commit, so the download mock feeds the STAGE and the
 * commit is what puts the files in place. Every check the component makes runs against
 * the staged manifest, between the two calls, which is the whole point: a refusal there
 * discards a staged copy instead of destroying whatever was already installed.
 */
function downloadReturns(manifest: PluginManifest) {
  pluginInstallStage.mockResolvedValue({
    checksum: "sha256:abc",
    manifest,
    manifest_sha256: "digest-1",
    stage_id: "stage-1",
  });
  pluginInstallCommit.mockResolvedValue({
    install_path: "/p/demo",
    manifest,
  });
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
    pluginInstallStage.mockReset();
    pluginInstallCommit.mockReset();
    pluginInstallDiscard.mockReset().mockResolvedValue(undefined);
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
    expect(pluginInstallStage).not.toHaveBeenCalled();
  });

  it("downloads nothing when the dialog is cancelled", async () => {
    await clickInstall();
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(pluginInstallStage).not.toHaveBeenCalled();
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
    // #261 — the staged copy is thrown away and NOTHING was installed. There is nothing
    // to uninstall because the swap never ran.
    expect(pluginInstallDiscard).toHaveBeenCalledWith("stage-1");
    expect(pluginInstallCommit).not.toHaveBeenCalled();
    expect(pluginUninstall).not.toHaveBeenCalled();
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
    expect(pluginInstallDiscard).toHaveBeenCalledWith("stage-1");
    expect(pluginInstallCommit).not.toHaveBeenCalled();
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
    expect(pluginInstallDiscard).toHaveBeenCalledWith("stage-1");
    expect(pluginInstallCommit).not.toHaveBeenCalled();
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
    // #261 — the files landed nowhere, so there is no "id they landed under" to roll
    // back. The stage is discarded by its own handle and no directory named `other` was
    // ever created.
    expect(pluginInstallDiscard).toHaveBeenCalledWith("stage-1");
    expect(pluginInstallCommit).not.toHaveBeenCalled();
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

  it("keeps the working version when an update fails its checks", async () => {
    // ‼️ THIS TEST USED TO ASSERT THE OPPOSITE, and that is the point of #261.
    //
    // An update was uninstall-then-install, so a rejected download left NOTHING installed
    // — the working version had already been removed, and the best the app could do was
    // say so ("no longer installed — reinstall it from the registry"). Staging removes
    // the outcome instead of describing it: the escalation is caught between the stage
    // and the commit, so the installed version was never touched and the update badge is
    // still there to try again.
    installedAt({ capabilities: ["editor"], trust: "sandboxed" });
    listed = [{ ...ENTRY, version: "2.0.0" }];
    downloadReturns({ ...MANIFEST, trust: "trusted" }); // exceeds the recorded consent

    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Updates/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Update to v/ }),
    );

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain("trusted"),
    );
    expect(
      usePluginStore.getState().installedPlugins.demo?.manifest.version,
    ).toBe("1.0.0");
    expect(pluginInstallDiscard).toHaveBeenCalledWith("stage-1");
    expect(pluginInstallCommit).not.toHaveBeenCalled();
    expect(pluginUninstall).not.toHaveBeenCalled();
    expect(usePluginStore.getState().updateAvailable.demo).toBe("2.0.0");
  });

  it("keeps the old version when the SWAP itself fails", async () => {
    // The last failure the staging design has to cover, and the only one that reaches
    // Rust's rollback: everything passed, the commit was attempted, and the rename failed
    // anyway (disk full, a permission change). Rust puts the previous version back and
    // reports the error; the frontend must not record the new version, must discard the
    // stage, and must leave the old record exactly as it was.
    installedAt({ capabilities: ["editor"], trust: "sandboxed" });
    listed = [{ ...ENTRY, version: "2.0.0" }];
    pluginInstallCommit.mockRejectedValue(new Error("No space left on device"));

    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Updates/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Update to v/ }),
    );

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain(
        "No space left on device",
      ),
    );
    expect(pluginInstallDiscard).toHaveBeenCalledWith("stage-1");
    expect(
      usePluginStore.getState().installedPlugins.demo?.manifest.version,
    ).toBe("1.0.0");
    expect(usePluginStore.getState().updateAvailable.demo).toBe("2.0.0");
    // ‼️ AND IT IS RUNNING AGAIN (#261 review, MEDIUM-1 / security area 2). The bytes
    // surviving is only half of it: the update unloaded the old version — closing its
    // sandbox window and sweeping its commands and UI contributions — before attempting the
    // swap. With the swap refused, nothing else in the app reconciles "enabled" against
    // "loaded" until the next startup, so without this the row would read Enabled while the
    // plugin had silently disappeared.
    expect(loadPlugin).toHaveBeenCalledWith("/p/demo", {
      ...MANIFEST,
      capabilities: ["editor"],
    });
  });

  it("runs one install per plugin however fast the button is clicked", async () => {
    // ‼️ #261 security review (area 3). `setInstalling` is a store write that sits below two
    // `getVersion` IPCs and, when the consent record already covers the update, below no
    // dialog at all — so nothing serialised a double-click. Two commits interleave badly:
    // the first renames the target aside, the second sees no target and takes the fast
    // path, and the first's rename AND its restore then both fail `ENOTEMPTY`. The user is
    // told their previous version is stranded in a hidden directory, for a plugin that is
    // perfectly fine.
    installedAt({ capabilities: ["editor"], trust: "sandboxed" });
    listed = [{ ...ENTRY, version: "2.0.0" }];

    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Updates/ }));
    const button = await screen.findByRole("button", {
      name: /^Update to v/,
    });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() =>
      expect(usePluginStore.getState().installedPlugins.demo?.checksum).toBe(
        "sha256:abc",
      ),
    );
    expect(pluginInstallStage).toHaveBeenCalledTimes(1);
    expect(pluginInstallCommit).toHaveBeenCalledTimes(1);
    // The digest the stage returned must be the one the commit is pinned to.
    expect(pluginInstallCommit).toHaveBeenCalledWith(
      "stage-1",
      "demo",
      "digest-1",
    );
  });

  it("unloads the old version before swapping the files, and not before staging", async () => {
    // Ordering, and both halves matter. Unloading BEFORE the commit is required — the
    // module and its sandbox window are about to be replaced underneath a running
    // plugin. Unloading before the STAGE would be the old destructive shape wearing a
    // different name: the download could still be refused with the plugin already torn
    // down.
    installedAt({ capabilities: ["editor"], trust: "sandboxed" });
    listed = [{ ...ENTRY, version: "2.0.0" }];
    const order: string[] = [];
    unloadPlugin.mockImplementation(() => {
      order.push("unload");
      return Promise.resolve();
    });
    pluginInstallStage.mockImplementation(() => {
      order.push("stage");
      return Promise.resolve({
        checksum: "sha256:abc",
        manifest: MANIFEST,
        manifest_sha256: "digest-1",
        stage_id: "stage-1",
      });
    });
    pluginInstallCommit.mockImplementation(() => {
      order.push("commit");
      return Promise.resolve({ install_path: "/p/demo", manifest: MANIFEST });
    });

    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Updates/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Update to v/ }),
    );

    await waitFor(() => expect(order).toEqual(["stage", "unload", "commit"]));
  });

  it("keeps a plugin that installed but failed to start — files and record both", async () => {
    // #261 states this as the activation-failure POLICY, not just an implementation
    // detail: the archive passed the checksum, the manifest, the consent comparison and
    // the version floor, so the fault is in running the plugin rather than in the copy on
    // disk. It stays installed with the error against it, and the enable toggle can retry.
    //
    // The post-commit work lives OUTSIDE the block that discards, so "nothing may discard
    // after the commit" is enforced by scope. An earlier draft cleared a `pendingStage`
    // flag there instead — mutation testing showed no test could falsify that line,
    // because nothing after a successful commit throws.
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
    expect(pluginInstallDiscard).not.toHaveBeenCalled();
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
    // The plugin is untouched — not unloaded, not downloaded.
    expect(unloadPlugin).not.toHaveBeenCalled();
    expect(pluginUninstall).not.toHaveBeenCalled();
    expect(pluginInstallStage).not.toHaveBeenCalled();
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

  it("does not swap the files when the old version will not shut down", async () => {
    // A wedged teardown must abort the update, not proceed: replacing the files under a
    // plugin whose module, sandbox window and command registrations are all still live
    // is worse than not updating at all. The stage is discarded and the old version keeps
    // running, badge and all.
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
    expect(pluginInstallCommit).not.toHaveBeenCalled();
    expect(pluginInstallDiscard).toHaveBeenCalledWith("stage-1");
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
    expect(pluginInstallStage).not.toHaveBeenCalled();
  });

  it("refuses a legacy entry in the handler too, not only at the button", async () => {
    // §260 Phase 5 re-review (R7) — the first version clicked the Installed TAB and then
    // asserted "no dialog, no download", trivially true of a click that attempts nothing:
    // it passed with the handler's guard deleted.
    //
    // Driven through UPDATE instead, because that button is genuinely enabled for a
    // trust-less entry — so this reaches the rule by a path a user can actually take,
    // rather than by defeating the disabled attribute. Same guard, same message.
    installedAt({ capabilities: ["editor"], trust: "sandboxed" });
    listed = [{ ...ENTRY, trust: undefined, version: "2.0.0" }];

    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Updates/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Update to v/ }),
    );

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain(
        "predates Baram's plugin trust model",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pluginInstallStage).not.toHaveBeenCalled();
    // Nothing was removed either — a refusal must not be destructive.
    expect(usePluginStore.getState().installedPlugins.demo).toBeDefined();
  });
});

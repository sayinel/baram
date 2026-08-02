// §69 — the two `engines.baram` gates, mirroring `plugin-revoked-gates.test.tsx`.
//
// The floor was declared by every plugin and evaluated by nothing, so what these assert
// is the same thing the revocation gates assert: the DOWNLOAD never happened, and on the
// update path the working copy was never DELETED. `plugin-release.yml` names that outcome
// exactly — "destroys a working older version on update" — and it is reachable only
// through the ordering, so an error string alone would not pin it.
import type { RegistryEntry, RegistryIndex } from "../../../plugins/types";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pluginInstallStage = vi.fn();
const pluginInstallCommit = vi.fn();
const pluginInstallDiscard = vi.fn();
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
  pluginInstallCommit: (...a: unknown[]) => pluginInstallCommit(...a),
  pluginInstallDiscard: (...a: unknown[]) => pluginInstallDiscard(...a),
  pluginInstallStage: (...a: unknown[]) => pluginInstallStage(...a),
  pluginUninstall: (...a: unknown[]) => pluginUninstall(...a),
}));
vi.mock("../../../ipc/invoke", () => ({
  getConfig: () => Promise.resolve(null),
  readFile: () => Promise.reject(new Error("no README")),
  removeConfig: () => Promise.resolve(),
  setConfig: () => Promise.resolve(),
}));
// The LISTING, mutable so one test can make it disagree with the downloaded manifest.
// Reset in every `beforeEach`.
let listing: RegistryEntry;

vi.mock("../../../plugins/registry-client", () => ({
  checkForUpdates: () => Promise.resolve({ demo: "1.0.0" }),
  fetchRegistryIndex: () =>
    Promise.resolve({ plugins: [listing] } satisfies RegistryIndex),
  searchRegistry: () => [listing],
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
    pluginInstallStage.mockReset();
    pluginInstallCommit.mockReset();
    pluginInstallDiscard.mockReset().mockResolvedValue(undefined);
    pluginUninstall.mockReset();
    getVersion.mockReset();
    listing = ENTRY;
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
    expect(pluginInstallStage).not.toHaveBeenCalled();
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

  it("refuses a DOWNLOAD whose floor the listing under-declared, and discards it", async () => {
    // The entry is a claim; the archive is the truth. id, tier and capabilities are all
    // re-verified against the downloaded manifest, and the floor has to be too — a stale
    // index (or any registry that under-declares) would otherwise install a plugin this
    // app cannot run, which is the outcome the gate exists to prevent.
    getVersion.mockResolvedValue("0.5.1");
    pluginInstallStage.mockResolvedValue({
      checksum: "sha256:abc",
      manifest: {
        ...ENTRY,
        // What the ZIP actually declares, and the listing said `>=0.5.0`.
        engines: { baram: ">=9.0.0" },
        main: "index.mjs",
      },
      stage_id: "stage-1",
    });
    // The listing under-declares, so it passes the pre-download gate.
    listing = { ...ENTRY, engines: { baram: ">=0.5.0" } };
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Install$/ }));
    // Confirm consent — scoped to the dialog, because the card behind it still offers its
    // own "Install" and an unscoped query matches both.
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Install$/ }));

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toBeTruthy(),
    );
    const why = usePluginStore.getState().pluginErrors.demo;
    expect(why).toContain("9.0.0");
    // The record must NOT exist, and the staged files must have been discarded — nothing
    // was ever installed, so there is nothing to uninstall (#261).
    expect(usePluginStore.getState().installedPlugins.demo).toBeUndefined();
    expect(pluginInstallDiscard).toHaveBeenCalledWith("stage-1");
    expect(pluginInstallCommit).not.toHaveBeenCalled();
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
    pluginInstallStage.mockReset();
    pluginInstallCommit.mockReset();
    pluginInstallDiscard.mockReset().mockResolvedValue(undefined);
    pluginUninstall.mockReset();
    getVersion.mockReset();
    listing = ENTRY;
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
    // ‼️ Which refusal fired, not merely that one did. A code review replaced this gate
    // with an unrelated early `setError` + `return` and all five tests still passed: the
    // `if (false && …)` mutation only proves the gate can be REMOVED, never that some
    // future fourth check added above it has not quietly taken its place.
    const why = usePluginStore.getState().pluginErrors.demo;
    expect(why).toContain("9.0.0");
    expect(why).toContain("0.5.1");
    expect(pluginUninstall).not.toHaveBeenCalled();
    expect(pluginInstallStage).not.toHaveBeenCalled();
  });

  /// #261 — THIS REPLACES THE GUARD THAT USED TO LIVE HERE, and covers strictly more.
  ///
  /// The old test asserted that an update was REFUSED OUTRIGHT when the listing declared
  /// no floor: an update was uninstall-then-install, so an unverifiable target was not
  /// worth risking the working copy for. That guard could only ever see the listing,
  /// which left three neighbours it could not close — a listing that declares a floor
  /// this app meets while the ZIP declares a higher one, `"*"`, and unparseable ranges.
  ///
  /// Staging closes all four at once, so the refusal is gone and the outcome is better:
  /// the download happens, the ZIP's own floor is judged while the installed version is
  /// still installed, and a bad floor costs a discard. The case below is the one no
  /// pre-download check could ever have caught.
  it("keeps the working copy when only the DOWNLOAD reveals an unmet floor", async () => {
    getVersion.mockResolvedValue("0.5.1");
    // Deleted from a copy rather than destructured away: this project's lint ignores `^_`
    // for arguments only, so `const { engines: _x, ...rest }` is an error here.
    const withoutEngines = { ...ENTRY };
    delete (withoutEngines as { engines?: unknown }).engines;
    listing = withoutEngines;
    // The listing says nothing; the archive demands an app version this one is below.
    pluginInstallStage.mockResolvedValue({
      checksum: "sha256:new",
      manifest: { ...ENTRY, engines: { baram: ">=9.0.0" }, main: "index.mjs" },
      stage_id: "stage-1",
    });
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Installed/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Update$/ }));

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toBeTruthy(),
    );
    // Names THIS refusal — the floor from the ZIP and the running app's own version —
    // rather than merely "some error".
    const why = usePluginStore.getState().pluginErrors.demo;
    expect(why).toContain("9.0.0");
    expect(why).toContain("0.5.1");
    // The whole point: the working copy survives, and it survives a failure that happens
    // AFTER the download rather than before it.
    expect(pluginInstallCommit).not.toHaveBeenCalled();
    expect(pluginInstallDiscard).toHaveBeenCalledWith("stage-1");
    expect(pluginUninstall).not.toHaveBeenCalled();
    expect(
      usePluginStore.getState().installedPlugins.demo?.manifest.version,
    ).toBe("0.9.0");
  });

  /// ‼️ #261 code review (HIGH-1) — the case NEITHER floor check can evaluate.
  ///
  /// `parseBaramFloor` understands `>=X.Y.Z` and nothing else, on purpose: it shares its
  /// grammar with the publish gate. So `"*"`, `^0.6.0` and an absent field all mean "no
  /// opinion" to the pre-download check AND to the post-download one — staging did not
  /// change that, though an earlier draft of this PR claimed it had.
  ///
  /// On an update that has to refuse, because the commit is a one-way door: the previous
  /// version is replaced atomically and its backup released, so a plugin that then fails to
  /// activate leaves the user with no way back. The refusal costs a discard.
  it("refuses an update when neither side states a floor it can evaluate", async () => {
    getVersion.mockResolvedValue("0.5.1");
    const manifest = { ...ENTRY, engines: { baram: "*" }, main: "index.mjs" };
    pluginInstallStage.mockResolvedValue({
      checksum: "sha256:new",
      manifest,
      manifest_sha256: "deadbeef",
      stage_id: "stage-1",
    });
    listing = { ...ENTRY, engines: { baram: "^0.6.0" } };
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Installed/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Update$/ }));

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toContain(
        "does not say which Baram version it needs",
      ),
    );
    expect(pluginInstallCommit).not.toHaveBeenCalled();
    expect(pluginInstallDiscard).toHaveBeenCalledWith("stage-1");
    expect(pluginUninstall).not.toHaveBeenCalled();
    expect(
      usePluginStore.getState().installedPlugins.demo?.manifest.version,
    ).toBe("0.9.0");
  });

  /// …and the same unevaluable listing updates fine once the ARCHIVE states a real floor.
  /// This is what the guard it replaced could not do: that one read only the listing, so an
  /// entry omitting `engines` was refused however good its ZIP was.
  it("updates when only the DOWNLOAD states an evaluable floor", async () => {
    getVersion.mockResolvedValue("0.5.1");
    const manifest = {
      ...ENTRY,
      engines: { baram: ">=0.5.0" },
      main: "index.mjs",
    };
    pluginInstallStage.mockResolvedValue({
      checksum: "sha256:new",
      manifest,
      manifest_sha256: "deadbeef",
      stage_id: "stage-1",
    });
    pluginInstallCommit.mockResolvedValue({
      install_path: "/p/demo",
      manifest,
    });
    const withoutEngines = { ...ENTRY };
    delete (withoutEngines as { engines?: unknown }).engines;
    listing = withoutEngines;
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Installed/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Update$/ }));

    await waitFor(() =>
      expect(pluginInstallCommit).toHaveBeenCalledWith(
        "stage-1",
        "demo",
        "deadbeef",
      ),
    );
    expect(usePluginStore.getState().pluginErrors.demo).toBeFalsy();
    expect(pluginUninstall).not.toHaveBeenCalled();
    expect(pluginInstallDiscard).not.toHaveBeenCalled();
  });
});

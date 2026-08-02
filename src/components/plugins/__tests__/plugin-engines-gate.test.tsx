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
    pluginInstall.mockReset();
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

  it("refuses a DOWNLOAD whose floor the listing under-declared, and rolls back", async () => {
    // The entry is a claim; the archive is the truth. id, tier and capabilities are all
    // re-verified against the downloaded manifest, and the floor has to be too — a stale
    // index (or any registry that under-declares) would otherwise install a plugin this
    // app cannot run, which is the outcome the gate exists to prevent.
    getVersion.mockResolvedValue("0.5.1");
    // This is the only test here that reaches the rollback, so it is the only one that
    // needs `pluginUninstall` to be awaitable — `handleInstall` calls `.catch()` on it.
    pluginUninstall.mockResolvedValue(undefined);
    pluginInstall.mockResolvedValue({
      checksum: "sha256:abc",
      install_path: "/p/demo",
      manifest: {
        ...ENTRY,
        // What the ZIP actually declares, and the listing said `>=0.5.0`.
        engines: { baram: ">=9.0.0" },
        main: "index.mjs",
      },
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
    // The record must NOT exist, and the extracted files must have been removed.
    expect(usePluginStore.getState().installedPlugins.demo).toBeUndefined();
    expect(pluginUninstall).toHaveBeenCalledWith("demo");
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
    expect(pluginInstall).not.toHaveBeenCalled();
  });

  /// THE DEFECT THIS PINS (code review MEDIUM-1): making `engines` optional on
  /// `RegistryEntry` punched a hole in the gate above.
  ///
  /// An absent floor means "no opinion" to `floorRefusal`, which is right on the INSTALL
  /// path — the post-download re-check against the ZIP's manifest catches a bad floor and
  /// rolls the files back, so nothing is lost. On the UPDATE path the uninstall sits
  /// BETWEEN those two checks: the listing passes, the working copy is deleted, the
  /// download is then refused, and the user has nothing. Before `engines` went optional
  /// this was unreachable — an entry without it failed the whole index parse.
  it("never uninstalls the working copy when the listing declares no floor at all", async () => {
    getVersion.mockResolvedValue("0.5.1");
    // Deleted from a copy rather than destructured away: this project's lint ignores `^_`
    // for arguments only, so `const { engines: _x, ...rest }` is an error here.
    const withoutEngines = { ...ENTRY };
    delete (withoutEngines as { engines?: unknown }).engines;
    listing = withoutEngines;
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Installed/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Update$/ }));

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toBeTruthy(),
    );
    // Names THIS refusal, not merely "some error" — the neighbouring gate's message
    // carries version numbers, so a mutation that let this fall through to it would
    // otherwise pass.
    const why = usePluginStore.getState().pluginErrors.demo;
    expect(why).toContain("does not declare which Baram version it needs");
    expect(why).toContain(ENTRY.name);
    // The whole point: the working copy survives.
    expect(pluginUninstall).not.toHaveBeenCalled();
    expect(pluginInstall).not.toHaveBeenCalled();
    expect(usePluginStore.getState().installedPlugins.demo).toBeDefined();
  });

  it("still updates an entry whose floor it cannot parse, which predates this change", async () => {
    // ‼️ Pins the SCOPE of the guard above, not an endorsement of the outcome. `"*"` gives
    // no more assurance about the ZIP than an absent field does, and a listing that
    // under-declares a parseable floor is worse still — but all of those reached this path
    // before `engines` became optional, and silently changing them here would turn a
    // regression fix into a behaviour change nobody asked for. Issue #261 (stage the
    // download before removing anything) is what actually closes them.
    getVersion.mockResolvedValue("0.5.1");
    pluginUninstall.mockResolvedValue(undefined);
    pluginInstall.mockResolvedValue({
      checksum: "sha256:new",
      install_path: "/p/demo",
      manifest: { ...ENTRY, engines: { baram: "*" }, main: "index.mjs" },
    });
    listing = { ...ENTRY, engines: { baram: "*" } };
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Installed/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Update$/ }));

    await waitFor(() => expect(pluginUninstall).toHaveBeenCalledWith("demo"));
    expect(usePluginStore.getState().pluginErrors.demo).toBeFalsy();
  });
});

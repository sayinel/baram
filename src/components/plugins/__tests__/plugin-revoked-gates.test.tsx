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

const pluginInstallStage = vi.fn();
const pluginInstallCommit = vi.fn();
const pluginInstallDiscard = vi.fn();
const pluginUninstall = vi.fn();

vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: { loadPlugin: vi.fn(), unloadPlugin: vi.fn() },
}));
// ‼️ `importOriginal` + spread, not a bare literal — see the note on the same mock in
// `plugin-install-consent.test.tsx`. `plugin-lifecycle` imports three more names from this
// module, and a literal factory replaces it for every importer in the graph.
vi.mock("../../../ipc/plugin-invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/plugin-invoke")>()),
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
// The LISTING, mutable so one test can escalate its capabilities. Reset in `beforeEach`.
let listing: RegistryEntry = null as unknown as RegistryEntry;

vi.mock("../../../plugins/registry-client", () => ({
  checkForUpdates: () => Promise.resolve({ demo: "1.0.0" }),
  fetchRegistryIndex: () =>
    Promise.resolve({ plugins: [listing] } satisfies RegistryIndex),
  searchRegistry: () => [listing],
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

/**
 * The Installed row's Update button, by its accessible name.
 *
 * §69 — the row moved to `PluginRowView`, which names every control after its plugin, so
 * the `/^Update$/` this replaces now matches nothing. An exact string is stricter than that
 * anchored regex and still cannot collide with the "Updates (1)" tab.
 */
const UPDATE_ROW = "Update Demo";

function revoke(severity: RevocationSeverity): void {
  usePluginStore.setState({
    revocations: {
      revoked: [
        { id: "demo", reason: "steals things", severity, versions: "*" },
      ],
      sequence: 1,
      version: 1,
    },
  });
}

describe("the marketplace install gate (§69)", () => {
  beforeEach(() => {
    listing = ENTRY;
    pluginInstallStage.mockReset();
    pluginInstallCommit.mockReset();
    pluginInstallDiscard.mockReset().mockResolvedValue(undefined);
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
      expect(pluginInstallStage).not.toHaveBeenCalled();
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
    pluginInstallStage.mockResolvedValue({
      checksum: "sha256:abc",
      manifest: { ...ENTRY, main: "index.mjs" },
      manifest_sha256: "digest-1",
      stage_id: "stage-1",
    });
    pluginInstallCommit.mockResolvedValue({
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
    listing = ENTRY;
    pluginInstallStage.mockReset();
    pluginInstallCommit.mockReset();
    pluginInstallDiscard.mockReset().mockResolvedValue(undefined);
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
            // A literal, not `ENTRY.engines`: a manifest's floor is required and an entry's
            // is not, so the entry can no longer stand in for it.
            engines: { baram: "*" },
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
    // The download never happens. Since #261 there is no uninstall between the two
    // halves, so `handleInstall`'s own revocation refusal would also stop this — what the
    // UPDATE gate uniquely prevents is the consent prompt, pinned by the next test.
    revoke("malicious");
    render(<PluginMarketplace />);
    // Driven from the INSTALLED tab, which is where a revoked plugin is actually
    // reachable: once it is pulled from the index, Browse and Updates both lose it.
    // Its row action is "Update Demo"; the Updates tab's card says "Update to 1.0.0", and
    // an /Update/i query matches the "Updates (1)" TAB before either.
    fireEvent.click(await screen.findByRole("button", { name: /^Installed/ }));
    fireEvent.click(await screen.findByRole("button", { name: UPDATE_ROW }));

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toBeTruthy(),
    );
    expect(pluginUninstall).not.toHaveBeenCalled();
    // ‼️ #261 review (HIGH-2) — `expect(pluginInstallStage)` alone became a TAUTOLOGY
    // when install split in two: the mock factory still exported `pluginInstall`, which
    // the component no longer imports, so the assertion held no matter what the gate
    // did. Worse, an un-exported name makes vitest throw INSIDE `handleInstall`, whose
    // catch sets an error string — so `pluginErrors.demo` was truthy and the test stayed
    // green while the revoked archive was downloaded, staged and committed.
    //
    // The commit assertion is the one that cannot be satisfied by accident: it is the
    // only call that touches an installed plugin.
    expect(pluginInstallStage).not.toHaveBeenCalled();
    expect(pluginInstallCommit).not.toHaveBeenCalled();
  });

  /// ‼️ WHAT THE UPDATE GATE STILL DOES THAT THE INSTALL GATE CANNOT.
  ///
  /// The test above cannot distinguish the two: `handleInstall` has its own revocation
  /// refusal, so deleting `handleUpdate`'s left every assertion green — verified by
  /// mutation. Since #261 removed the destructive uninstall the update gate no longer
  /// protects any FILES, and the honest remaining reason for it is this one: it refuses
  /// before `askConsent`, so a revoked target never opens a capability prompt.
  ///
  /// Reaching that requires an escalation, or `consentRequired` returns null and no dialog
  /// would appear either way. `plugin-engines-gate.test.tsx` states the same doctrine for
  /// the floor gate: a consent dialog for a plugin that will then be refused trains the
  /// user to click through capability grants for nothing.
  it("does not prompt for capabilities it is about to refuse", async () => {
    revoke("malicious");
    // The listing wants a capability the recorded consent does not cover, so without the
    // gate above it `consentRequired` is non-null and the dialog opens.
    listing = { ...ENTRY, capabilities: ["editor", "network"] };
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Installed/ }));
    fireEvent.click(await screen.findByRole("button", { name: UPDATE_ROW }));

    await waitFor(() =>
      expect(usePluginStore.getState().pluginErrors.demo).toBeTruthy(),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pluginInstallStage).not.toHaveBeenCalled();
  });
});

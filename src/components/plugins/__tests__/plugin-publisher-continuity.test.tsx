// §382 — the consent record now carries WHO published a community plugin, and an update from
// a different account asks again (spec 0058 §9.2). Driven through the marketplace and the real
// `usePluginActions`, the way `plugin-install-consent.test.tsx` drives tier and capabilities.
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
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadPlugin = vi.fn();
const unloadPlugin = vi.fn();
const pluginInstallStage = vi.fn();
const pluginInstallCommit = vi.fn();
const pluginInstallDiscard = vi.fn();

vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: {
    loadPlugin: (...a: unknown[]) => loadPlugin(...a),
    unloadPlugin: (...a: unknown[]) => unloadPlugin(...a),
  },
}));
// `importOriginal` + spread for the reason `plugin-install-consent.test.tsx` gives: the
// marketplace's built-in toggle reaches `plugin-lifecycle`, which imports more of this module.
vi.mock("../../../ipc/plugin-invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/plugin-invoke")>()),
  pluginInstallCommit: (...a: unknown[]) => pluginInstallCommit(...a),
  pluginInstallDiscard: (...a: unknown[]) => pluginInstallDiscard(...a),
  pluginInstallStage: (...a: unknown[]) => pluginInstallStage(...a),
}));
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

import {
  countAnywhere,
  findSurface,
} from "../../../__tests__/helpers/security-surface";
import { communityEntry } from "../../../plugins/__tests__/community-fixture";
import { usePluginStore } from "../../../stores/system/plugin";
import { PluginMarketplace } from "../PluginMarketplace";

/** A community listing as `fetchRegistryIndex` serves it — normalized, channel stamped. */
const LISTING = communityEntry({
  capabilities: ["editor"],
  channel: "community",
});

const FIRST_PARTY: RegistryEntry = {
  author: "Baram",
  capabilities: ["editor"],
  channel: "first-party",
  checksum: "a".repeat(64),
  description: "Counts words",
  downloadUrl:
    "https://sayinel.github.io/baram-plugins/plugins/baram-word-count-2.1.0.zip",
  engines: { baram: ">=0.5.0" },
  id: "baram-word-count",
  license: "Apache-2.0",
  name: "Word Count",
  trust: "sandboxed",
  version: "2.1.0",
};

const APPROVED_FROM_OCTOCAT: PluginConsent = {
  capabilities: ["editor"],
  channel: "community",
  publisher: "octocat",
  publisherId: 583231,
  trust: "sandboxed",
};

async function clickUpdate() {
  render(<PluginMarketplace />);
  fireEvent.click(screen.getByRole("button", { name: /^Updates/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^Update to v/ }));
}

function downloadReturns(manifest: PluginManifest) {
  pluginInstallStage.mockResolvedValue({
    checksum: "b".repeat(64),
    manifest,
    manifest_sha256: "digest-1",
    stage_id: "stage-1",
  });
  pluginInstallCommit.mockResolvedValue({
    install_path: `/p/${manifest.id}`,
    manifest,
  });
}

/** Seed `entry`'s plugin as installed at its version under `consent`, `next` on offer. */
function installedWith(
  entry: RegistryEntry,
  consent: PluginConsent,
  next: string,
) {
  usePluginStore.setState({
    installedPlugins: {
      [entry.id]: {
        checksum: "b".repeat(64),
        consent,
        enabled: true,
        installedAt: 0,
        installPath: `/p/${entry.id}`,
        manifest: manifestOf(entry),
        updatedAt: 0,
      },
    },
    updateAvailable: { [entry.id]: next },
  });
}

function manifestOf(
  entry: RegistryEntry,
  version = entry.version,
): PluginManifest {
  return {
    author: entry.author,
    capabilities: entry.capabilities,
    description: entry.description,
    engines: entry.engines ?? { baram: "*" },
    id: entry.id,
    license: entry.license,
    main: "index.mjs",
    name: entry.name,
    trust: "sandboxed",
    version,
  };
}

beforeEach(() => {
  loadPlugin.mockReset().mockResolvedValue(undefined);
  unloadPlugin.mockReset().mockResolvedValue(undefined);
  pluginInstallStage.mockReset();
  pluginInstallCommit.mockReset();
  pluginInstallDiscard.mockReset().mockResolvedValue(undefined);
  usePluginStore.setState({
    installedPlugins: {},
    pluginErrors: {},
    updateAvailable: {},
  });
});

describe("publisher continuity (§382)", () => {
  it("records the channel and the publisher with a community install", async () => {
    listed = [LISTING];
    downloadReturns(manifestOf(LISTING));
    render(<PluginMarketplace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Install$/ }));
    const dialog = (await findSurface(".plugin-consent")).getByRole("dialog");
    // `PluginDetailTab` mounts the other `PluginConsentDialog` and passes it the same
    // way — pinned by `PluginDetailTab.test.tsx`'s "passes the same provenance to the
    // consent dialog it mounts (§382)".
    expect(dialog.textContent).toContain("Published by @octocat");
    // A first install has no prior publisher to name a change against.
    expect(dialog.textContent).not.toContain("→");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Install$/ }));
    await waitFor(() =>
      expect(
        usePluginStore.getState().installedPlugins["hello-counter"]?.consent,
      ).toEqual(APPROVED_FROM_OCTOCAT),
    );
  });

  it("asks again when the update comes from a different GitHub account", async () => {
    installedWith(LISTING, APPROVED_FROM_OCTOCAT, "1.3.0");
    listed = [
      {
        ...LISTING,
        publisher: "new-owner",
        publisherId: 999001,
        version: "1.3.0",
      },
    ];
    downloadReturns(manifestOf(LISTING, "1.3.0"));
    await clickUpdate();
    // Same capabilities, same tier: before §382 this update installed without a word.
    expect(await findSurface(".plugin-consent")).toBeTruthy();
    expect(pluginInstallStage).not.toHaveBeenCalled();
    const dialog = (await findSurface(".plugin-consent")).getByRole("dialog");
    expect(dialog.textContent).toContain("@octocat → @new-owner");
  });

  it("approving a publisher-change update records the NEW publisher, not the old one (§382 F5)", async () => {
    installedWith(LISTING, APPROVED_FROM_OCTOCAT, "1.3.0");
    listed = [
      {
        ...LISTING,
        publisher: "new-owner",
        publisherId: 999001,
        version: "1.3.0",
      },
    ];
    downloadReturns(manifestOf(LISTING, "1.3.0"));
    await clickUpdate();
    const dialog = (await findSurface(".plugin-consent")).getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /^Update and install$/ }),
    );
    await waitFor(() =>
      expect(
        usePluginStore.getState().installedPlugins["hello-counter"]?.consent,
      ).toEqual({
        capabilities: ["editor"],
        channel: "community",
        publisher: "new-owner",
        publisherId: 999001,
        trust: "sandboxed",
      }),
    );
  });

  it("does not ask when only the login changed, and records the new login", async () => {
    installedWith(LISTING, APPROVED_FROM_OCTOCAT, "1.3.0");
    listed = [{ ...LISTING, publisher: "octocat-renamed", version: "1.3.0" }];
    downloadReturns(manifestOf(LISTING, "1.3.0"));
    await clickUpdate();
    await waitFor(() =>
      expect(
        usePluginStore.getState().installedPlugins["hello-counter"]?.consent,
      ).toEqual({ ...APPROVED_FROM_OCTOCAT, publisher: "octocat-renamed" }),
    );
    expect(countAnywhere(".plugin-consent")).toBe(0);
  });

  it("records the first-party channel on the next update of an install that predates §382, without asking", async () => {
    installedWith(
      FIRST_PARTY,
      { capabilities: ["editor"], trust: "sandboxed" },
      "2.2.0",
    );
    listed = [{ ...FIRST_PARTY, version: "2.2.0" }];
    downloadReturns(manifestOf(FIRST_PARTY, "2.2.0"));
    await clickUpdate();
    await waitFor(() =>
      expect(
        usePluginStore.getState().installedPlugins["baram-word-count"]?.consent,
      ).toEqual({
        capabilities: ["editor"],
        channel: "first-party",
        trust: "sandboxed",
      }),
    );
    expect(countAnywhere(".plugin-consent")).toBe(0);
  });
});

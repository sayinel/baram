// §69 — the Installed tab's route to `PluginDetail`.
//
// Browse and Updates both iterate the REGISTRY, so before this the detail view was
// unreachable for a plugin installed from a file or one whose listing had been
// withdrawn — precisely the plugins whose provenance a user wants to check. The
// registry here is deliberately EMPTY: a test whose plugin is also listed would pass
// against a build that only opened the detail view through a registry lookup.
import type { InstalledPlugin, RegistryIndex } from "../../../plugins/types";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const activateBuiltin = vi.fn();
const deactivateBuiltin = vi.fn();

vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: { loadPlugin: vi.fn(), unloadPlugin: vi.fn() },
}));
// `importOriginal` + spread — `plugin-lifecycle` exports far more than these two, and the
// marketplace's graph reaches several of them.
vi.mock("../../../plugins/plugin-lifecycle", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../plugins/plugin-lifecycle")
  >()),
  activateBuiltin: (...a: unknown[]) => activateBuiltin(...a),
  deactivateBuiltin: (...a: unknown[]) => deactivateBuiltin(...a),
}));
vi.mock("../../../plugins/registry-client", () => ({
  checkForUpdates: () => Promise.resolve({}),
  fetchRegistryIndex: () =>
    Promise.resolve({ plugins: [] } satisfies RegistryIndex),
  searchRegistry: () => [],
}));
// The detail view reads README off disk; an unresolved read would leave the assertion
// racing the effect.
vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  readFile: () => Promise.reject(new Error("no README")),
}));

import { usePluginStore } from "../../../stores/system/plugin";
import { PluginMarketplace } from "../PluginMarketplace";

const unlisted = {
  checksum: "abc",
  enabled: true,
  installedAt: 0,
  installPath: "/p/sideloaded",
  manifest: {
    author: "Somebody",
    capabilities: ["editor:readonly"],
    dependencies: [],
    description: "installed from a folder, never listed anywhere",
    engines: { baram: "*" },
    homepage: "https://example.test/home",
    id: "sideloaded",
    license: "MIT",
    main: "index.mjs",
    name: "Sideloaded",
    trust: "sandboxed",
    version: "2.1.0",
  },
  updatedAt: 0,
} as unknown as InstalledPlugin;

/** Render, switch to Installed, and press that plugin's Details button. */
async function openDetail() {
  render(<PluginMarketplace />);
  fireEvent.click(screen.getByRole("button", { name: /^Installed / }));
  fireEvent.click(
    await screen.findByRole("button", { name: "View details for Sideloaded" }),
  );
}

describe("Installed tab detail route (§69)", () => {
  beforeEach(() => {
    usePluginStore.setState({
      installedPlugins: { sideloaded: unlisted },
      pluginErrors: {},
      revocations: null,
    });
  });

  it("opens the detail view for a plugin the registry does not list", async () => {
    await openDetail();
    // The detail view's own heading, not the row's name — the row renders the name too,
    // so asserting on the name alone would pass without ever leaving the list.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Back/u })).toBeTruthy();
    });
    expect(screen.getByText("Description")).toBeTruthy();
  });

  it("shows what the row could not: capabilities and links", async () => {
    await openDetail();
    await waitFor(() => {
      expect(screen.getByText("editor:readonly")).toBeTruthy();
    });
    expect(
      screen.getByRole("link", { name: /example\.test\/home|Homepage/u }),
    ).toBeTruthy();
  });

  it("offers no Install button for something already installed", async () => {
    // The synthesised entry carries `downloadUrl: ""`, so an Install button reachable
    // here would start a download that cannot succeed. Gating is by `status`.
    await openDetail();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Back/u })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /^Install$/u })).toBeNull();
  });

  it("gives each row a distinct accessible name", async () => {
    // Two rows, one label: "Details" alone leaves a screen reader with two identical
    // buttons and no way to tell which plugin either belongs to.
    usePluginStore.setState({
      installedPlugins: {
        other: {
          ...unlisted,
          installPath: "/p/other",
          manifest: { ...unlisted.manifest, id: "other", name: "Other" },
        } as unknown as InstalledPlugin,
        sideloaded: unlisted,
      },
    });
    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Installed / }));
    // §69 — scoped to the community section. Built-ins are listed on this tab now and carry
    // their own Details button, so the unscoped query counts three rows for these two
    // installs. Same cause as the scoping in `plugin-marketplace-toggle.test.tsx`.
    const community = await screen.findByTestId("plugin-section-community");
    const names = (
      await within(community).findAllByRole("button", {
        name: /^View details for /,
      })
    ).map((el) => el.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
  });
});

// ‼️ §69 fix round 1, Critical 2 — the detail view for a BUILT-IN.
//
// `getPluginStatus` reads `installedPlugins`, and a built-in is never in it: it is compiled
// into the app, not installed. So the detail view read "not-installed" and rendered an
// ENABLED Install button — `trust: "trusted"` clears the legacy guard — wired to an entry
// `entryFromRow` had given `downloadUrl: ""`. Clicking it staged a download of an empty URL.
// Meanwhile the toggle routed to `handleToggleEnabled`, which early-returns for anything not
// in `installedPlugins`, so the one action a built-in supports did nothing from this screen.
describe("Installed tab detail route — built-ins (§69)", () => {
  const BUILTIN_NAME = "Media Viewer";
  const BUILTIN_ID = "baram-media-viewer";

  /** Render, open Installed, and press the built-in's Details button. */
  async function openBuiltinDetail() {
    render(<PluginMarketplace />);
    fireEvent.click(screen.getByRole("button", { name: /^Installed / }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: `View details for ${BUILTIN_NAME}`,
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Back/u })).toBeTruthy();
    });
  }

  beforeEach(() => {
    activateBuiltin.mockReset().mockResolvedValue(undefined);
    deactivateBuiltin.mockReset().mockResolvedValue(undefined);
    usePluginStore.setState({
      builtinDisabled: [],
      installedPlugins: {},
      pluginErrors: {},
      revocations: null,
    });
  });

  it("offers no Install, Update or Uninstall", async () => {
    // There is nothing to acquire and nothing to delete: `actionsFor("builtin")` says so,
    // and this screen now asks it the same way the row does.
    await openBuiltinDetail();

    expect(screen.queryByRole("button", { name: /^Install$/u })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Uninstall$/u })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Update to /u })).toBeNull();
  });

  it("offers the toggle, and it drives the BUILT-IN path", async () => {
    // The complement — without it the assertions above also pass for a detail view that
    // renders no actions at all. `deactivateBuiltin` because it starts enabled.
    await openBuiltinDetail();

    fireEvent.click(screen.getByRole("button", { name: "Enabled" }));

    await waitFor(() =>
      expect(deactivateBuiltin).toHaveBeenCalledWith(BUILTIN_ID),
    );
    await waitFor(() =>
      expect(usePluginStore.getState().builtinDisabled).toContain(BUILTIN_ID),
    );
  });

  it("says Built-in, instead of only withholding the actions", async () => {
    // ‼️ Every assertion above is an ABSENCE, and an absence explains nothing: a screen
    // with no Update reads exactly like a plugin whose update has not been found yet.
    // The row carries a "Built-in" chip beside the name and this screen is opened FROM
    // that row, so the two surfaces have to say the same thing about the same plugin.
    await openBuiltinDetail();

    expect(screen.getByText("Built-in")).toBeTruthy();
  });

  it("reads its status from the toggle state, not from installedPlugins", async () => {
    // The root of the Critical: "not-installed" was the status for every built-in, which is
    // what made Install render. A disabled built-in must read Disabled, never not-installed.
    usePluginStore.setState({ builtinDisabled: [BUILTIN_ID] });
    await openBuiltinDetail();

    expect(screen.getByRole("button", { name: "Disabled" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Install$/u })).toBeNull();
  });
});

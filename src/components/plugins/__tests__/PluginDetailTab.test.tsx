// §69 The plugin detail as an EDITOR TAB.
//
// These assertions used to live in `plugin-installed-detail-route.test.tsx`, reached by
// clicking Details in the marketplace. What they protect is the DETAIL SCREEN — how a
// built-in's status is resolved, which actions each source may offer — not the route, so
// they now render the host directly. The route itself is asserted in that file.
import type { InstalledPlugin, RegistryIndex } from "../../../plugins/types";

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const activateBuiltin = vi.fn();
const deactivateBuiltin = vi.fn();
const readPluginReadme = vi.fn<(p: string) => Promise<null | string>>();

vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: { loadPlugin: vi.fn(), unloadPlugin: vi.fn() },
}));
vi.mock("../../../plugins/plugin-lifecycle", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../plugins/plugin-lifecycle")
  >()),
  activateBuiltin: (...a: unknown[]) => activateBuiltin(...a),
  deactivateBuiltin: (...a: unknown[]) => deactivateBuiltin(...a),
}));
// Empty by DEFAULT: a detail screen that only worked for a listed plugin would pass against
// a registry lookup, and the installed-but-unlisted plugin is exactly the one whose
// provenance a user opens this screen to check. Individual tests push a listing in.
const listed = vi.hoisted(() => ({ plugins: [] as unknown[] }));
vi.mock("../../../plugins/registry-client", () => ({
  checkForUpdates: () => Promise.resolve({}),
  fetchRegistryIndex: () =>
    Promise.resolve({ plugins: listed.plugins } as RegistryIndex),
  searchRegistry: () => [],
}));
vi.mock("../plugin-readme", () => ({
  MAX_README_BYTES: 262144,
  readPluginReadme: (p: string) => readPluginReadme(p),
}));

import { useEditorStore } from "../../../stores/editor/editor";
import { usePluginStore } from "../../../stores/system/plugin";
import { PluginDetailTab } from "../PluginDetailTab";

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

/** Let the registry fetch and the README read settle, so no assertion reads a first-render
 *  state that every resolution order happens to share. */
async function settleRegistryFetch(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  listed.plugins = [];
  readPluginReadme.mockReset().mockResolvedValue(null);
  usePluginStore.setState({
    builtinDisabled: [],
    devPlugins: {},
    installedPlugins: { sideloaded: unlisted },
    installing: {},
    pluginErrors: {},
    revocations: null,
    updateAvailable: {},
  });
});

describe("PluginDetailTab — a plugin the registry does not list (§69)", () => {
  it("renders the detail from the installed manifest", async () => {
    render(<PluginDetailTab pluginId="sideloaded" />);

    await waitFor(() => {
      expect(screen.getByText("Description")).toBeTruthy();
    });
    expect(screen.getByText("editor:readonly")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /example\.test\/home|Homepage/u }),
    ).toBeTruthy();
  });

  it("offers no Install button for something already installed", async () => {
    // The synthesised entry carries `downloadUrl: ""`, so an Install button reachable here
    // would start a download that cannot succeed. Gating is by `status`.
    render(<PluginDetailTab pluginId="sideloaded" />);

    await waitFor(() => {
      expect(screen.getByText("Description")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /^Install$/u })).toBeNull();
  });

  it("shows the version installed, not the one the registry offers", async () => {
    // ‼️ The documented consequence of resolving from the id rather than carrying an entry
    // snapshot: the old Browse/Updates route handed over the LISTING, so this screen read
    // the newer version for a plugin the user had not updated yet. The Update affordance is
    // unaffected — it comes from `updateAvailable` and `handleUpdate` re-resolves the
    // listing — so what this pins is that the header describes what you actually have.
    listed.plugins = [
      {
        ...unlisted.manifest,
        checksum: "def",
        downloadUrl: "https://example.test/sideloaded-9.0.0.zip",
        version: "9.0.0",
      },
    ];
    usePluginStore.setState({ updateAvailable: { sideloaded: "9.0.0" } });
    render(<PluginDetailTab pluginId="sideloaded" />);
    // ‼️ Flush the registry fetch before asserting. `registryIndex` is null on the first
    // render, so ANY resolution order shows the installed manifest at that moment — a
    // `waitFor` here passes against a build that prefers the listing, because it catches
    // that transient state and stops looking.
    await settleRegistryFetch();

    expect(screen.getByText("v2.1.0")).toBeTruthy();
    expect(screen.queryByText("v9.0.0")).toBeNull();
    // And the update is still offered, by the store rather than by the entry.
    expect(
      screen.getByRole("button", { name: /Update to v9\.0\.0/u }),
    ).toBeTruthy();
  });

  it("falls back to the listing for a plugin that is not installed", async () => {
    // The only case where the listing is the sole source — and the only case where
    // `downloadUrl` matters, since this is the screen that offers Install.
    usePluginStore.setState({ installedPlugins: {} });
    listed.plugins = [
      {
        ...unlisted.manifest,
        checksum: "def",
        downloadUrl: "https://example.test/sideloaded-9.0.0.zip",
        id: "notyet",
        name: "Not Yet",
        version: "9.0.0",
      },
    ];
    render(<PluginDetailTab pluginId="notyet" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Install$/u })).toBeTruthy();
    });
  });

  it("says so when neither an install nor a listing can be found", async () => {
    // A tab outlives the panel that opened it, so the plugin can be uninstalled — or its
    // listing withdrawn — while this screen is open. Rendering nothing would read as a
    // broken tab.
    render(<PluginDetailTab pluginId="ghost" />);

    await waitFor(() => {
      expect(screen.getByText(/no longer available/iu)).toBeTruthy();
    });
  });
});

describe("PluginDetailTab — README (§69)", () => {
  it("renders the README as markdown, not as its source text", async () => {
    // ‼️ The regression this pins: the README was dumped into a `<pre>`, so a markdown
    // editor showed a markdown document with its syntax as literal characters.
    readPluginReadme.mockResolvedValue("# Word Count\n\nCounts **words**.");
    render(<PluginDetailTab pluginId="sideloaded" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Word Count" })).toBeTruthy();
    });
    expect(screen.getByText("words").tagName).toBe("STRONG");
    expect(screen.queryByText(/^# Word Count/u)).toBeNull();
  });

  it("reads it from the plugin's install directory", async () => {
    render(<PluginDetailTab pluginId="sideloaded" />);

    await waitFor(() => {
      expect(readPluginReadme).toHaveBeenCalledWith("/p/sideloaded");
    });
  });
});

// ‼️ §69 fix round 1, Critical 2 — the detail view for a BUILT-IN.
//
// `getPluginStatus` reads `installedPlugins`, and a built-in is never in it: it is compiled
// into the app, not installed. So the detail view read "not-installed" and rendered an
// ENABLED Install button — `trust: "trusted"` clears the legacy guard — wired to an entry
// whose `downloadUrl` is "". Clicking it staged a download of an empty URL.
describe("PluginDetailTab — built-ins (§69)", () => {
  const BUILTIN_ID = "baram-media-viewer";

  async function renderBuiltin() {
    render(<PluginDetailTab pluginId={BUILTIN_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Description")).toBeTruthy();
    });
  }

  beforeEach(() => {
    activateBuiltin.mockReset().mockResolvedValue(undefined);
    deactivateBuiltin.mockReset().mockResolvedValue(undefined);
    usePluginStore.setState({ builtinDisabled: [], installedPlugins: {} });
  });

  it("offers no Install, Update or Uninstall", async () => {
    // Nothing to acquire and nothing to delete: `actionsFor("builtin")` says so, and this
    // screen asks it the same way the row does.
    await renderBuiltin();

    expect(screen.queryByRole("button", { name: /^Install$/u })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Uninstall$/u })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Update to /u })).toBeNull();
  });

  it("offers the toggle, and it drives the BUILT-IN path", async () => {
    // The complement — without it the assertions above also pass for a detail view that
    // renders no actions at all. `deactivateBuiltin` because it starts enabled.
    await renderBuiltin();

    screen.getByRole("button", { name: "Enabled" }).click();

    await waitFor(() =>
      expect(deactivateBuiltin).toHaveBeenCalledWith(BUILTIN_ID),
    );
    await waitFor(() =>
      expect(usePluginStore.getState().builtinDisabled).toContain(BUILTIN_ID),
    );
  });

  it("says Built-in, instead of only withholding the actions", async () => {
    // ‼️ Every assertion above is an ABSENCE, and an absence explains nothing: a screen with
    // no Update reads exactly like a plugin whose update has not been found yet.
    await renderBuiltin();

    expect(screen.getByText("Built-in")).toBeTruthy();
  });

  it("reads its status from the toggle state, not from installedPlugins", async () => {
    // The root of the Critical: "not-installed" was the status for every built-in, which is
    // what made Install render. A disabled built-in must read Disabled, never not-installed.
    usePluginStore.setState({ builtinDisabled: [BUILTIN_ID] });
    await renderBuiltin();

    expect(screen.getByRole("button", { name: "Disabled" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Install$/u })).toBeNull();
  });

  it("does not look for a README on disk — a built-in has no files", async () => {
    await renderBuiltin();

    expect(readPluginReadme).not.toHaveBeenCalled();
  });
});

describe("PluginDetailTab — Back closes the tab (§69)", () => {
  it("closes the active tab rather than returning to a list", async () => {
    // There is no list behind an editor tab to go back to.
    useEditorStore.setState({ tabs: [], activeTabId: null, mruOrder: [] });
    useEditorStore.getState().openPluginTab("sideloaded", "Sideloaded");
    render(<PluginDetailTab pluginId="sideloaded" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Back/u })).toBeTruthy();
    });
    screen.getByRole("button", { name: /Back/u }).click();

    await waitFor(() => {
      expect(useEditorStore.getState().tabs).toHaveLength(0);
    });
  });
});

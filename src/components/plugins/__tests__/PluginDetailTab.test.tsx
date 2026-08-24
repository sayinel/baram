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
const listed = vi.hoisted(() => ({
  /** How `fetchRegistryIndex` behaves: resolved now, rejected, or held open by the test. */
  mode: "resolve" as "defer" | "hang" | "reject" | "resolve",
  plugins: [] as unknown[],
  /** Call count — `settleRegistryFetch` asserts on it, so a flush cannot pass vacuously. */
  requests: 0,
  resolve: undefined as ((index: unknown) => void) | undefined,
}));
vi.mock("../../../plugins/registry-client", () => ({
  checkForUpdates: () => Promise.resolve({}),
  fetchRegistryIndex: () => {
    listed.requests += 1;
    if (listed.mode === "reject") return Promise.reject(new Error("offline"));
    if (listed.mode === "hang") return new Promise(() => undefined);
    if (listed.mode === "defer") {
      return new Promise((res) => {
        listed.resolve = res as (index: unknown) => void;
      });
    }
    return Promise.resolve({ plugins: listed.plugins } as RegistryIndex);
  },
  searchRegistry: () => [],
}));
vi.mock("../plugin-readme", () => ({
  readPluginReadme: (p: string) => readPluginReadme(p),
}));

import { revocationFor } from "../../../plugins/revocation";
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

/**
 * Let the registry fetch and the README read settle, so no assertion reads a first-render
 * state that every resolution order happens to share.
 *
 * ‼️ Asserts the fetch was actually REQUESTED first. A fixed number of microtask ticks is a
 * silent failure mode on its own — if the component never fetched, or a future `await` lands
 * in the chain, the flush becomes too short and every assertion after it passes for the wrong
 * reason. That is exactly how the "installed version wins" assertion used to pass. Tests that
 * need certainty rather than a flush use `mode: "defer"` and resolve explicitly.
 */
async function settleRegistryFetch(): Promise<void> {
  expect(listed.requests).toBeGreaterThan(0);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  listed.mode = "resolve";
  listed.plugins = [];
  listed.requests = 0;
  listed.resolve = undefined;
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
    // ‼️ Deferred, not flushed. `registryIndex` is null on the first render, so ANY resolution
    // order shows the installed manifest at that moment — an assertion made before the index
    // lands passes against a build that prefers the listing. Resolving explicitly inside `act`
    // makes "the index HAS landed" a fact of the test rather than a hoped-for side effect of
    // counting microtasks.
    listed.mode = "defer";
    render(<PluginDetailTab pluginId="sideloaded" />);
    await act(async () => {
      listed.resolve!({ plugins: listed.plugins });
    });

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
    //
    // ‼️ Settles FIRST. Before the loading state existed, a bare `waitFor` here caught the
    // first paint — where `registryIndex` is null and this message renders for ANY id — so the
    // assertion could not tell "the registry says it is gone" from "the registry has not been
    // asked yet", and it pinned that flash as correct.
    render(<PluginDetailTab pluginId="ghost" />);
    await settleRegistryFetch();

    expect(screen.getByText(/no longer available/iu)).toBeTruthy();
  });

  it("claims nothing while the registry has not answered", async () => {
    // The flash this replaces: "This plugin is no longer available." on the first paint of
    // every not-installed plugin, including ones the registry is about to confirm.
    listed.mode = "hang";
    const { container } = render(<PluginDetailTab pluginId="notyet" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toBe("");
  });

  it("distinguishes an unreachable registry from a withdrawn listing", async () => {
    // A failed fetch used to leave "no longer available" up permanently — reporting a network
    // fault as a decision the registry made, with no way for the user to tell the difference.
    listed.mode = "reject";
    render(<PluginDetailTab pluginId="notyet" />);
    await settleRegistryFetch();

    expect(screen.getByText(/could not reach/iu)).toBeTruthy();
    expect(screen.queryByText(/no longer available/iu)).toBeNull();
  });
});

// §69 — the revocation notice, on both paths.
//
// ‼️ The panel's `shownRevocation` resolves against `installedPlugins[id]?.manifest.version ??
// entry.version`. Keying only off an install meant the Browse list drew a revoked badge and the
// detail it links to explained nothing while offering Install — on the one screen whose job is
// provenance. The install itself was still refused by `usePluginActions`, so this was a
// display-only regression, on the security explanation path.
describe("PluginDetailTab — revocation (§69)", () => {
  const revoked = {
    revoked: [
      {
        id: "risky",
        reason: "malicious build",
        severity: "malicious",
        versions: { eq: "1.0.0" },
      },
    ],
    version: 1,
  } as never;

  const riskyListing = {
    ...unlisted.manifest,
    checksum: "def",
    downloadUrl: "https://example.test/risky-1.0.0.zip",
    id: "risky",
    name: "Risky",
    version: "1.0.0",
  };

  it("explains a revocation for a plugin that is listed but not installed", async () => {
    // ‼️ Fixture validity first — `VersionRange` accepts "*" or {eq|gt|gte|lt|lte}, so a bare
    // string `versions` silently matches nothing and this test would pass for a build that
    // renders no notice at all.
    expect(revocationFor("risky", "1.0.0", revoked as never)?.severity).toBe(
      "malicious",
    );

    usePluginStore.setState({ installedPlugins: {}, revocations: revoked });
    listed.plugins = [riskyListing];
    render(<PluginDetailTab pluginId="risky" />);
    await settleRegistryFetch();

    expect(screen.getByText(/malicious build/iu)).toBeTruthy();
  });

  it("still explains it for an installed plugin", async () => {
    // The complement: without it, the assertion above passes for a build that reads the
    // revocation from the listing only and stopped resolving it for installs.
    usePluginStore.setState({
      installedPlugins: {
        risky: {
          ...unlisted,
          installPath: "/p/risky",
          manifest: { ...unlisted.manifest, id: "risky", version: "1.0.0" },
        } as unknown as InstalledPlugin,
      },
      revocations: revoked,
    });
    render(<PluginDetailTab pluginId="risky" />);
    await settleRegistryFetch();

    expect(screen.getByText(/malicious build/iu)).toBeTruthy();
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

describe("PluginDetailTab — the tab label follows the manifest (§69)", () => {
  it("corrects a stale title from the live manifest", async () => {
    // ‼️ The title is the only value `openPluginTab` snapshots at click time, which contradicts
    // this component's premise that a snapshot goes stale. An update that renames the plugin
    // left the old label on the tab.
    useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
    useEditorStore.getState().openPluginTab("sideloaded", "Old Name");

    render(<PluginDetailTab pluginId="sideloaded" />);
    await settleRegistryFetch();

    expect(useEditorStore.getState().tabs[0]?.title).toBe("Sideloaded");
  });

  it("relabels its OWN tab, not whichever tab is active", async () => {
    // ‼️ An earlier version of this test opened the file tab first and then the plugin tab —
    // but `openPluginTab` activates its own tab, so `activeTabId` was already the plugin tab
    // and keying the lookup on it made no observable difference. The active tab has to be a
    // DIFFERENT tab for the two implementations to diverge.
    useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
    const store = useEditorStore.getState();
    store.openPluginTab("sideloaded", "Old Name");
    store.openTab({
      contextId: "",
      filePath: "/vault/a.md",
      id: "f1",
      isDirty: false,
      isPinned: false,
      title: "a.md",
    });
    expect(useEditorStore.getState().activeTabId).toBe("f1");

    render(<PluginDetailTab pluginId="sideloaded" />);
    await settleRegistryFetch();

    const tabs = useEditorStore.getState().tabs;
    expect(tabs.find((t) => t.type === "plugin")?.title).toBe("Sideloaded");
    expect(tabs.find((t) => t.id === "f1")?.title).toBe("a.md");
  });
});

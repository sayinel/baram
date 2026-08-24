// §69 — the route from a row's Details button to the detail screen.
//
// The detail is an EDITOR TAB now, not a second return from this panel, so what this file
// asserts is the hand-off: the right plugin id lands in a tab, and the overlay that was
// covering the editor gets out of the way. The detail screen's own behaviour is asserted in
// `PluginDetailTab.test.tsx`, which renders that host directly.
import type { InstalledPlugin, RegistryIndex } from "../../../plugins/types";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: { loadPlugin: vi.fn(), unloadPlugin: vi.fn() },
}));
// `importOriginal` + spread — `plugin-lifecycle` exports far more than these two, and the
// marketplace's graph reaches several of them.
vi.mock("../../../plugins/plugin-lifecycle", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../plugins/plugin-lifecycle")
  >()),
  activateBuiltin: vi.fn(),
  deactivateBuiltin: vi.fn(),
}));
// The registry is deliberately EMPTY: a route that only worked for a listed plugin would
// pass here for the wrong reason.
vi.mock("../../../plugins/registry-client", () => ({
  checkForUpdates: () => Promise.resolve({}),
  fetchRegistryIndex: () =>
    Promise.resolve({ plugins: [] } satisfies RegistryIndex),
  searchRegistry: () => [],
}));

import { useEditorStore } from "../../../stores/editor/editor";
import { usePluginStore } from "../../../stores/system/plugin";
import { useUIStore } from "../../../stores/ui/ui";
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
async function clickDetails(name = "Sideloaded") {
  render(<PluginMarketplace />);
  fireEvent.click(screen.getByRole("button", { name: /^Installed / }));
  fireEvent.click(
    await screen.findByRole("button", { name: `View details for ${name}` }),
  );
}

function pluginTabs() {
  return useEditorStore.getState().tabs.filter((t) => t.type === "plugin");
}

describe("Installed tab detail route (§69)", () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null, mruOrder: [] });
    useUIStore.setState({ settingsOpen: false });
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

  it("opens an editor tab for that plugin and makes it active", async () => {
    await clickDetails();

    const tabs = pluginTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.pluginId).toBe("sideloaded");
    expect(tabs[0]?.title).toBe("Sideloaded");
    expect(useEditorStore.getState().activeTabId).toBe(tabs[0]?.id);
  });

  it("leaves the panel on its list instead of replacing it with the detail", async () => {
    // The panel used to return the detail view in place of the list. If it still did, the
    // tab would be redundant and the user would see the same screen twice.
    await clickDetails();

    expect(screen.queryByRole("button", { name: /Back/u })).toBeNull();
    expect(
      screen.getByRole("button", { name: "View details for Sideloaded" }),
    ).toBeTruthy();
  });

  it("closes the settings modal, which would otherwise cover the new tab", async () => {
    useUIStore.setState({ settingsOpen: true });

    await clickDetails();

    expect(useUIStore.getState().settingsOpen).toBe(false);
    expect(pluginTabs()).toHaveLength(1);
  });

  it("does not toggle the settings modal OPEN from the sidebar route", async () => {
    // ‼️ The complement of the test above, and the reason the close is conditional rather
    // than an unconditional `toggleSettings()`: this panel is also the `plugins` sidebar
    // panel, where there is no modal to close. A bare toggle would have OPENED one.
    expect(useUIStore.getState().settingsOpen).toBe(false);

    await clickDetails();

    expect(useUIStore.getState().settingsOpen).toBe(false);
  });

  it("reuses the tab when the same plugin's Details is pressed twice", async () => {
    await clickDetails();
    const firstId = pluginTabs()[0]?.id;
    fireEvent.click(
      screen.getByRole("button", { name: "View details for Sideloaded" }),
    );

    expect(pluginTabs()).toHaveLength(1);
    expect(pluginTabs()[0]?.id).toBe(firstId);
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

  it("routes a BUILT-IN row to a tab too", async () => {
    // Built-ins are listed on this tab and are the one source that is never in
    // `installedPlugins`; the old inline route needed a special case for them.
    usePluginStore.setState({ installedPlugins: {} });

    await clickDetails("Media Viewer");

    expect(pluginTabs()[0]?.pluginId).toBe("baram-media-viewer");
  });
});

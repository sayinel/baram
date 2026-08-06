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

vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: { loadPlugin: vi.fn(), unloadPlugin: vi.fn() },
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

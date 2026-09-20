// §361 Task 6 — what the Installed group shows: an update control when the registry lists
// a different version, and a withdrawal notice inside a shadow root when one applies.
//
// ‼️ THE NOTICE IS ASSERTED THROUGH `shadowRoot`, NOT `screen`. Testing Library's queries do
// not pierce a shadow root, so a `getByText` here would fail whether the notice rendered or
// not — the shape `shadow-isolation.test.tsx` records for the consent dialog.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRegistry = vi.fn();
vi.mock("../../../../ipc/plugin-invoke", () => ({
  pluginFetchRegistry: (url: string) => fetchRegistry(url),
}));

vi.mock("../../../../ipc/theme", () => ({
  themeUninstall: vi.fn(() => Promise.resolve()),
}));

import type { RevocationSeverity } from "../../../../plugins/revocation";
import type { RegistryEntry } from "../../../../plugins/types";
import type { InstalledTheme } from "../../../../themes/theme-install";

import { useSettingsStore } from "../../../../stores/settings/store";
import { usePluginStore } from "../../../../stores/system/plugin";
import { ThemeGallery } from "../theme-gallery";

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    author: "a",
    capabilities: [],
    checksum: "c".repeat(64),
    description: "d",
    downloadUrl: "https://reg.test/dracula.zip",
    engines: { baram: ">=0.7.0" },
    id: "dracula",
    kind: "theme",
    license: "MIT",
    name: "Dracula",
    version: "2.0.0",
    ...over,
  };
}

function gallery() {
  return <ThemeGallery onBrowseThemes={() => {}} onCustomize={() => {}} />;
}

function installedTheme(): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: "1.0.0",
    id: "dracula",
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: "/home/u/.baram/themes/dracula",
    manifest: {
      author: "a",
      description: "d",
      engines: { baram: ">=0.7.0" },
      id: "dracula",
      license: "MIT",
      modes: { light: { tokens: "light/tokens.json" } },
      name: "Dracula",
      version: "1.0.0",
    },
    modes: { light: { css: false } },
  };
}

function revoke(severity: RevocationSeverity) {
  usePluginStore.setState({
    revocations: {
      revoked: [
        { id: "dracula", reason: "compromised build", severity, versions: "*" },
      ],
      sequence: 1,
      version: 1,
    },
  });
}

/** The content node inside the single mounted security surface, or null when none is
 *  mounted at all. */
function surfaceContent(): Element | null {
  const host = document.querySelector(".security-surface-host");
  return host?.shadowRoot?.querySelector(".security-surface-content") ?? null;
}

beforeEach(() => {
  fetchRegistry.mockReset();
  fetchRegistry.mockResolvedValue({ plugins: [entry()] });
  useSettingsStore.setState({
    activeThemeId: "system",
    customThemes: [],
    installedThemes: { dracula: installedTheme() },
    locale: "en",
  });
  usePluginStore.setState({
    registryCache: null,
    registryCacheTime: 0,
    revocations: null,
  });
});

describe("the update control", () => {
  it("appears for an installed theme the registry lists at another version", async () => {
    render(gallery());
    const button = await screen.findByTitle("Update Dracula to v2.0.0");
    expect(button.textContent).toBe("Update to v2.0.0");
  });

  it("does not appear when the registry lists the installed version", async () => {
    fetchRegistry.mockResolvedValue({ plugins: [entry({ version: "1.0.0" })] });
    render(gallery());

    // Positive anchor first: the card really did render, so the absence below is about the
    // update control rather than about an empty gallery.
    expect(await screen.findByText("Dracula")).toBeTruthy();
    await waitFor(() => expect(fetchRegistry).toHaveBeenCalled());
    expect(screen.queryByTitle(/^Update Dracula/)).toBeNull();
  });

  it("offers it on the installed card only, when an installed id collides with a built-in", async () => {
    // ‼️ THE ONLY WAY THE `themeActions(source).update` GATE IS REACHABLE, and the first
    // version of this test missed it: `updates` is keyed by INSTALLED theme ids, and every
    // installed theme renders as `community`, so a built-in card can only ever be offered
    // an update when its id is also an installed id. Registry ids are unique across kinds
    // (`dropAmbiguousIds`) but nothing makes them distinct from the eight built-in ids, so a
    // theme published as `nord` puts two cards on screen — the shipped one, whose files are
    // in the binary and cannot be replaced, and the installed one.
    fetchRegistry.mockResolvedValue({
      plugins: [entry({ id: "nord", name: "Nord" })],
    });
    useSettingsStore.setState({
      installedThemes: {
        nord: {
          ...installedTheme(),
          id: "nord",
          manifest: { ...installedTheme().manifest, id: "nord", name: "Nord" },
        },
      },
    });
    render(gallery());

    // One update control, not two: the built-in card must not get one.
    const controls = await screen.findAllByTitle(/^Update Nord/);
    expect(controls).toHaveLength(1);
    // And two cards really are on screen, or the count above would be trivially right.
    expect(screen.getAllByText("Nord")).toHaveLength(2);
  });

  it("asks the registry nothing when no theme is installed", async () => {
    useSettingsStore.setState({ installedThemes: {} });
    render(gallery());

    expect(await screen.findByText("Default Light")).toBeTruthy();
    expect(fetchRegistry).not.toHaveBeenCalled();
  });
});

describe("the withdrawal notice", () => {
  it.each(["malicious", "vulnerable"] as const)(
    "renders inside a shadow root for a %s withdrawal",
    async (severity) => {
      revoke(severity);
      render(gallery());

      await waitFor(() => expect(surfaceContent()).not.toBeNull());
      const notice = surfaceContent()?.querySelector(".plugin-revoked");
      expect(notice).not.toBeNull();
      expect(notice?.textContent).toContain("compromised build");
      // Structural isolation: the notice is genuinely outside the document tree, which is
      // what a document stylesheet — a hostile theme's — cannot reach into.
      expect(document.querySelector(".plugin-revoked")).toBeNull();
      expect(document.body.contains(notice as Node)).toBe(false);
    },
  );

  it("uses the THEME wording, not the plugin wording", async () => {
    revoke("malicious");
    render(gallery());

    await waitFor(() => expect(surfaceContent()).not.toBeNull());
    const title = surfaceContent()?.querySelector(".plugin-revoked__title");
    expect(title?.textContent).toBe(
      "This theme has been withdrawn and is no longer applied.",
    );
  });

  it("shows nothing for an unlisted withdrawal", async () => {
    // `unlisted` is bookkeeping. The policy lives in `PluginRevokedNotice` and this asserts
    // the gallery did not route around it.
    revoke("unlisted");
    render(gallery());

    expect(await screen.findByText("Dracula")).toBeTruthy();
    expect(surfaceContent()).toBeNull();
  });

  it("shows nothing when no withdrawal list has been received", async () => {
    render(gallery());

    expect(await screen.findByText("Dracula")).toBeTruthy();
    expect(surfaceContent()).toBeNull();
  });
});

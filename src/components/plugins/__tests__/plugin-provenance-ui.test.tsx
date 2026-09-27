// §382 — the card and the detail view say who distributes a plugin (spec 0058 §9.3), and a
// registry-authored publisher reaches the screen only as a text node, only if it is a login.
import type { RegistryEntry } from "../../../plugins/types";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { communityEntry } from "../../../plugins/__tests__/community-fixture";
import { useSettingsStore } from "../../../stores/settings/store";
import { PluginCard } from "../PluginCard";
import { PluginDetail } from "../PluginDetail";

const COMMUNITY = communityEntry({ channel: "community" });
const FIRST_PARTY: RegistryEntry = {
  ...communityEntry({ channel: "first-party", id: "baram-word-count" }),
  author: "Baram",
  name: "Word Count",
  publisher: undefined,
  publisherId: undefined,
  repoId: undefined,
};
const noop = vi.fn();
const card = (entry: RegistryEntry) => (
  <PluginCard
    entry={entry}
    onInstall={noop}
    onSelect={noop}
    onUninstall={noop}
    onUpdate={noop}
    status="not-installed"
  />
);

afterEach(() => {
  useSettingsStore.setState({ locale: "en" });
});

describe("PluginCard provenance (§382)", () => {
  it("badges a first-party listing Baram, with no publisher", () => {
    const { container } = render(card(FIRST_PARTY));
    expect(container.querySelector(".plugin-channel-badge")?.textContent).toBe(
      "Baram",
    );
    expect(container.textContent).not.toContain("@");
  });

  it("shows a community listing's author, @publisher and the Community badge", () => {
    const { container } = render(card(COMMUNITY));
    expect(screen.getByText("Octo Cat")).toBeTruthy();
    expect(screen.getByText("@octocat")).toBeTruthy();
    expect(container.querySelector(".plugin-channel-badge")?.textContent).toBe(
      "Community",
    );
  });

  it("badges nothing for an entry that names no channel", () => {
    const { container } = render(card(communityEntry()));
    expect(container.querySelector(".plugin-channel-badge")).toBeNull();
  });

  it("never renders a publisher that is not a login — no element, no text", () => {
    // Normalization already drops this entry; the card must not depend on that.
    const { container } = render(
      card({ ...COMMUNITY, publisher: '<img src=x onerror="alert(1)">' }),
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toContain("onerror");
  });

  it("says Community in Korean under ko", () => {
    useSettingsStore.setState({ locale: "ko" });
    const { container } = render(card(COMMUNITY));
    expect(container.querySelector(".plugin-channel-badge")?.textContent).toBe(
      "커뮤니티",
    );
  });
});

describe("PluginDetail provenance (§382)", () => {
  const detail = (
    entry: RegistryEntry,
    provenance: Parameters<typeof PluginDetail>[0]["provenance"],
  ) =>
    render(
      <PluginDetail
        entry={entry}
        onBack={noop}
        onInstall={noop}
        onToggleEnabled={noop}
        onUninstall={noop}
        onUpdate={noop}
        provenance={provenance}
        status="not-installed"
      />,
    );

  it("links a community publisher to their GitHub profile", () => {
    const { container } = detail(COMMUNITY, {
      channel: "community",
      publisher: "octocat",
    });
    const link = screen.getByRole("link", { name: "@octocat" });
    expect(link.getAttribute("href")).toBe("https://github.com/octocat");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("Publisher")).toBeTruthy();
    expect(container.querySelector(".plugin-channel-badge")?.textContent).toBe(
      "Community",
    );
  });

  it("badges a first-party plugin Baram and shows no publisher row", () => {
    // By the badge's class, not `getByText("Baram")`: FIRST_PARTY's author is also "Baram".
    const { container } = detail(FIRST_PARTY, { channel: "first-party" });
    expect(container.querySelector(".plugin-channel-badge")?.textContent).toBe(
      "Baram",
    );
    expect(screen.queryByText("Publisher")).toBeNull();
  });

  it("shows neither when nothing says where the plugin came from", () => {
    const { container } = detail(COMMUNITY, null);
    expect(container.querySelector(".plugin-channel-badge")).toBeNull();
    expect(screen.queryByText("Publisher")).toBeNull();
  });
});

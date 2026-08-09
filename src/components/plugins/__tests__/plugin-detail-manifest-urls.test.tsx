// §69 — the manifest's own URLs are author-controlled too.
//
// `homepage` and `repository` went straight into `href`, while README links two sections below
// went through `safeLinkHref`. Neither `validateManifest` nor the registry client checks them.
// React 19 does neutralise `javascript:` on its own, so the exposure is odd schemes and
// phishing rather than script execution — which is why this is LOW and not HIGH, and why the
// fixture below uses a scheme React passes through untouched.
import type { RegistryEntry } from "../../../plugins/types";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PluginDetail } from "../PluginDetail";

function renderWith(over: Partial<RegistryEntry>) {
  render(
    <PluginDetail
      entry={
        {
          author: "Somebody",
          capabilities: [],
          checksum: "abc",
          dependencies: [],
          description: "d",
          downloadUrl: "",
          engines: { baram: "*" },
          id: "x",
          license: "MIT",
          main: "index.mjs",
          name: "X",
          trust: "sandboxed",
          version: "1.0.0",
          ...over,
        } as unknown as RegistryEntry
      }
      onBack={() => undefined}
      onInstall={() => undefined}
      onToggleEnabled={() => undefined}
      onUninstall={() => undefined}
      onUpdate={() => undefined}
      status="enabled"
    />,
  );
}

describe("manifest URLs go through the same allowlist as README links (§69)", () => {
  it("neutralises an odd-scheme homepage", () => {
    renderWith({ homepage: "file:///etc/passwd" });

    const link = screen.getByRole("link", { name: /Homepage/u });
    expect(link.getAttribute("href")).toBe("#");
  });

  it("neutralises an odd-scheme repository", () => {
    renderWith({ repository: "file:///etc/passwd" });

    const link = screen.getByRole("link", { name: /Repository/u });
    expect(link.getAttribute("href")).toBe("#");
  });

  it("leaves a normal https URL intact", () => {
    // ‼️ Non-vacuity: both assertions above pass for a build that hard-codes "#" and breaks
    // every legitimate link on the screen.
    renderWith({
      homepage: "https://example.test/home",
      repository: "https://example.test/repo",
    });

    expect(
      screen.getByRole("link", { name: /Homepage/u }).getAttribute("href"),
    ).toBe("https://example.test/home");
    expect(
      screen.getByRole("link", { name: /Repository/u }).getAttribute("href"),
    ).toBe("https://example.test/repo");
  });
});

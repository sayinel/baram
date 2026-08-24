import type { RegistryEntry } from "../../../plugins/types";

// §69 SECURITY — a plugin README is third-party-authored content, and this commit is the
// first thing to route such a file into `MarkdownRenderer`.
//
// ‼️ What the security review of PR #389 found: `sanitizeSvg` PRESERVES `<style>` on purpose
// (its own docstring lists `<style>` among the things that survive, for SVG fidelity), and
// `sanitizeEmbeddedHtml` routes any block that looks like an SVG document through it before
// `dangerouslySetInnerHTML`. A `<style>` element inside inline SVG in an HTML document is a
// document-scoped stylesheet, so a plugin author's README could restyle the app — including
// `PluginConsentDialog`'s own danger/capability/NEW classes, which are the visual basis of
// the §260 consent decision.
//
// That fidelity is right for the callers it was built for (AI chat output, and Help panel
// docs bundled at build time from our own repo). It is not right for a file a third party
// ships. These tests pin the narrowing.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PluginDetail } from "../PluginDetail";

const entry = {
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
} as unknown as RegistryEntry;

function renderReadme(readme: string) {
  return render(
    <PluginDetail
      entry={entry}
      onBack={() => undefined}
      onInstall={() => undefined}
      onToggleEnabled={() => undefined}
      onUninstall={() => undefined}
      onUpdate={() => undefined}
      readme={readme}
      status="enabled"
    />,
  );
}

describe("a plugin README cannot inject markup into the app realm (§69)", () => {
  it("drops a <style> element smuggled inside an SVG block", () => {
    // The exact shape from the review: multi-line, so remark treats it as ONE block `html`
    // node, which is what reaches the SVG branch. `.plugin-consent__danger` is the trusted
    // tier warning in the consent dialog.
    renderReadme(
      [
        '<svg xmlns="http://www.w3.org/2000/svg">',
        "  <style>.plugin-consent__danger { display: none !important; }</style>",
        '  <rect width="10" height="10" />',
        "</svg>",
      ].join("\n"),
    );

    const container = document.querySelector(".plugin-detail-readme");
    expect(container).toBeTruthy();
    expect(container!.querySelector("style")).toBeNull();
    expect(container!.innerHTML).not.toContain("plugin-consent__danger");
  });

  it("drops a fixed-position foreignObject overlay", () => {
    renderReadme(
      [
        '<svg xmlns="http://www.w3.org/2000/svg">',
        '  <foreignObject><div style="position:fixed;inset:0">click me</div></foreignObject>',
        "</svg>",
      ].join("\n"),
    );

    const container = document.querySelector(".plugin-detail-readme");
    expect(container!.querySelector("foreignObject")).toBeNull();
    expect(container!.innerHTML).not.toContain("position:fixed");
  });

  it("does not fetch a remote beacon for a markdown image", () => {
    // The author learns IP, geography and when the user inspected the plugin — none of which
    // the consent dialog mentioned, for a plugin that declared no `network` capability.
    renderReadme("![](https://author.example/beacon.png)");

    const container = document.querySelector(".plugin-detail-readme");
    const remote = [...container!.querySelectorAll("img")].filter((img) =>
      (img.getAttribute("src") ?? "").startsWith("https://"),
    );
    expect(remote).toHaveLength(0);
  });

  it("does not fetch a remote beacon smuggled as an SVG <image>", () => {
    renderReadme(
      [
        '<svg xmlns="http://www.w3.org/2000/svg">',
        '  <image href="https://author.example/beacon.png" />',
        "</svg>",
      ].join("\n"),
    );

    const container = document.querySelector(".plugin-detail-readme");
    expect(container!.innerHTML).not.toContain("author.example");
  });

  it("still renders the markdown a README is actually for", () => {
    // ‼️ Non-vacuity. Every assertion above is an absence, and they all pass against a
    // README section that renders nothing at all.
    renderReadme(
      "# Word Count\n\nCounts **words**. See [docs](https://example.test/d).",
    );

    expect(screen.getByRole("heading", { name: "Word Count" })).toBeTruthy();
    expect(screen.getByText("words").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "docs" })).toBeTruthy();
  });
});

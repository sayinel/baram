import type { RegistryEntry } from "../../../plugins/types";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PluginDetail } from "../PluginDetail";

function entry(trust: RegistryEntry["trust"]): RegistryEntry {
  return {
    author: "a",
    capabilities: [],
    checksum: "c",
    description: "d",
    downloadUrl: "https://example.com/p.zip",
    engines: { baram: "*" },
    id: "p",
    license: "MIT",
    name: "P",
    trust,
    version: "1.0.0",
  };
}

const noop = () => {};

describe("PluginDetail trust gating (§260)", () => {
  it("installs a sandboxed plugin without an extra confirm", () => {
    const onInstall = vi.fn();
    render(
      <PluginDetail
        entry={entry("sandboxed")}
        onBack={noop}
        onInstall={onInstall}
        onToggleEnabled={noop}
        onUninstall={noop}
        onUpdate={noop}
        status="not-installed"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  // §260 Phase 5 — this used to assert a two-click "Install anyway" warning owned by
  // PluginDetail. The full-trust gate MOVED to `PluginConsentDialog`, which is the step
  // that also records what the user agreed to; keeping a second, weaker warning here
  // would have been one more place for the two to drift apart. The gate itself is
  // asserted in `PluginConsentDialog.test.tsx` ("gates a trusted install behind an
  // explicit acknowledgement"). What PluginDetail still owes is below.
  it("delegates a trusted install to the caller, which raises the consent dialog", () => {
    const onInstall = vi.fn();
    render(
      <PluginDetail
        entry={entry("trusted")}
        onBack={noop}
        onInstall={onInstall}
        onToggleEnabled={noop}
        onUninstall={noop}
        onUpdate={noop}
        status="not-installed"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("refuses to offer Install for a legacy entry that declares no tier", () => {
    // A trust-less manifest is rejected by validateManifest, so an enabled button here
    // would only download first and fail second.
    const onInstall = vi.fn();
    render(
      <PluginDetail
        entry={entry(undefined)}
        onBack={noop}
        onInstall={onInstall}
        onToggleEnabled={noop}
        onUninstall={noop}
        onUpdate={noop}
        status="not-installed"
      />,
    );
    const install = screen.getByRole("button", { name: /^install$/i });
    expect(install.hasAttribute("disabled")).toBe(true);
    fireEvent.click(install);
    expect(onInstall).not.toHaveBeenCalled();
    expect(
      screen.getByText(/predates Baram's plugin trust model/i),
    ).toBeInTheDocument();
  });
});

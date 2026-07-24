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

  it("requires a full-trust confirm before installing a trusted plugin", () => {
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
    // First click reveals the warning; it does NOT install yet.
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    expect(onInstall).not.toHaveBeenCalled();
    expect(screen.getByText(/full app access/i)).toBeInTheDocument();
    // Confirming the warning installs.
    fireEvent.click(screen.getByRole("button", { name: /install anyway/i }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });
});

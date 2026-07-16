// §69 Plugin Card — error surfacing on marketplace list cards
import type { RegistryEntry } from "../../../plugins/types";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PluginCard } from "../PluginCard";

const entry: RegistryEntry = {
  author: "test-author",
  capabilities: [],
  checksum: "abc123",
  description: "A test plugin",
  downloadUrl: "https://example.com/plugin.zip",
  engines: { baram: "^1.0.0" },
  id: "baram-word-count",
  license: "MIT",
  name: "Word Count",
  version: "1.0.0",
};

const noop = vi.fn();

describe("PluginCard error surfacing", () => {
  it("renders the error text when the error prop is set", () => {
    render(
      <PluginCard
        entry={entry}
        error="Checksum mismatch: expected abc123, got def456"
        onInstall={noop}
        onSelect={noop}
        onUninstall={noop}
        onUpdate={noop}
        status="not-installed"
      />,
    );

    expect(
      screen.getByText(/Checksum mismatch: expected abc123, got def456/),
    ).toBeInTheDocument();
  });

  it("does not render an error line when the error prop is absent", () => {
    render(
      <PluginCard
        entry={entry}
        onInstall={noop}
        onSelect={noop}
        onUninstall={noop}
        onUpdate={noop}
        status="not-installed"
      />,
    );

    expect(screen.queryByText(/Checksum mismatch/)).not.toBeInTheDocument();
  });
});

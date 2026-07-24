import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PluginTrustBadge } from "../PluginTrustBadge";

describe("PluginTrustBadge (§260)", () => {
  it("labels a sandboxed plugin", () => {
    render(<PluginTrustBadge trust="sandboxed" />);
    expect(screen.getByText(/sandboxed/i)).toBeInTheDocument();
  });

  it("labels a trusted plugin as full trust", () => {
    render(<PluginTrustBadge trust="trusted" />);
    expect(screen.getByText(/full trust/i)).toBeInTheDocument();
  });

  it("labels a legacy (undefined trust) plugin as needing re-validation", () => {
    render(<PluginTrustBadge trust={undefined} />);
    expect(screen.getByText(/re-validation/i)).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import en from "../../../i18n/en.json";
import { PluginTrustBadge } from "../PluginTrustBadge";

// Asserted against the en.json VALUE, not a regex over the rendered text (#329).
//
// The labels moved from a literal map to i18n keys, and `t()` returns the key itself on
// a miss — so `getByText(/sandboxed/i)` matched the fallback string
// `"plugin.trust.sandboxed"` and passed on exactly the failure it was meant to catch.
// Looking the value up makes a deleted key a missing property, and the assertion fails.
const LABELS = en as Record<string, string>;

describe("PluginTrustBadge (§260)", () => {
  it("labels a sandboxed plugin", () => {
    render(<PluginTrustBadge trust="sandboxed" />);
    expect(
      screen.getByText(LABELS["plugin.trust.sandboxed"]),
    ).toBeInTheDocument();
  });

  it("labels a trusted plugin as full trust", () => {
    render(<PluginTrustBadge trust="trusted" />);
    expect(
      screen.getByText(LABELS["plugin.trust.trusted"]),
    ).toBeInTheDocument();
  });

  it("labels a legacy (undefined trust) plugin as needing re-validation", () => {
    render(<PluginTrustBadge trust={undefined} />);
    expect(screen.getByText(LABELS["plugin.trust.legacy"])).toBeInTheDocument();
  });

  it("does not accept the key itself as the label", () => {
    // The regression the three assertions above could not see: if a key goes missing,
    // `t()` renders its name, which still contains the word the old regex looked for.
    render(<PluginTrustBadge trust="sandboxed" />);
    expect(screen.queryByText("plugin.trust.sandboxed")).toBeNull();
  });
});

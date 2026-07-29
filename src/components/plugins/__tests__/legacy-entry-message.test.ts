// §260 Phase 6 code review round 2 — the message a user reads when an entry cannot be installed.
//
// One home for the sentence (both the marketplace and the detail view had their own copy), and
// the remedy has to match the CAUSE: "ask the author to declare a trust tier" is right for a
// plugin that predates the trust model and wrong for one naming a capability this build does not
// know, where the fix is to update Baram.
import type { RegistryEntry } from "../../../plugins/types";

import { describe, expect, it } from "vitest";

import { legacyEntryMessage } from "../legacy-entry-message";

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  author: "a",
  capabilities: ["events"],
  checksum: "a".repeat(64),
  description: "d",
  downloadUrl: "https://example.test/p.zip",
  engines: { baram: ">=0.5.0" },
  id: "p",
  license: "MIT",
  name: "P",
  version: "1.0.0",
  ...over,
});

describe("legacyEntryMessage (§260 Phase 6)", () => {
  it("tells the user to update Baram when the capability is unrecognised", () => {
    const message = legacyEntryMessage(
      entry({ demotedBecause: "unknown-capability" }),
    );
    expect(message).toContain("Update Baram");
    // …and NOT the other remedy, which would ask the author for something already done.
    expect(message).not.toContain("Ask the author");
  });

  it("tells the user to ask the author when the tier is unrecognised", () => {
    // An unknown tier really can mean a hand-written or hostile entry, so the author is the
    // right addressee here.
    expect(
      legacyEntryMessage(entry({ demotedBecause: "unknown-tier" })),
    ).toContain("Ask the author");
  });

  it("treats a genuinely legacy entry as the author's to fix", () => {
    // No reason recorded: it arrived with no tier at all, which is exactly "predates the trust
    // model".
    const message = legacyEntryMessage(entry());
    expect(message).toContain("predates");
    expect(message).toContain("Ask the author");
  });
});

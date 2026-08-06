// §260 Phase 6 code review round 2 — the message a user reads when an entry cannot be installed.
//
// One home for the sentence (both the marketplace and the detail view had their own copy), and
// the remedy has to match the CAUSE: "ask the author to declare a trust tier" is right for a
// plugin that predates the trust model and wrong for one naming a capability this build does not
// know, where the fix is to update Baram.
import type { RegistryEntry } from "../../../plugins/types";

import { describe, expect, it } from "vitest";

import { t as lookup } from "../../../i18n";
import { legacyEntryMessage } from "../legacy-entry-message";

// Bound to `en` deliberately: these cases are about which REMEDY each branch offers, and the
// remedies are English sentences. A store-bound translate would make the assertions depend on
// whatever locale a previous test left behind.
const t = (key: string, params?: Record<string, string>) =>
  lookup(key, "en", params);

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
      t,
    );
    expect(message).toContain("Update Baram");
    // …and NOT the other remedy, which would ask the author for something already done.
    expect(message).not.toContain("Ask the author");
  });

  it("tells the user to ask the author when the tier is unrecognised", () => {
    // An unknown tier really can mean a hand-written or hostile entry, so the author is the
    // right addressee here.
    expect(
      legacyEntryMessage(entry({ demotedBecause: "unknown-tier" }), t),
    ).toContain("Ask the author");
  });

  it("treats a genuinely legacy entry as the author's to fix", () => {
    // No reason recorded: it arrived with no tier at all, which is exactly "predates the trust
    // model".
    const message = legacyEntryMessage(entry(), t);
    expect(message).toContain("predates");
    expect(message).toContain("Ask the author");
  });
});

describe("legacyEntryMessage speaks the user's language", () => {
  // ‼️ THE CASES ABOVE CANNOT SEE A REGRESSION TO HARDCODED ENGLISH, because they ask for `en`
  // and English is what a hardcoded sentence returns. Written in §260 and never put through
  // i18n, both branches reached the Browse card, the detail view and the Installed row in
  // English whatever the locale was.
  const ko = (key: string, params?: Record<string, string>) =>
    lookup(key, "ko", params);

  it("resolves each branch through its own key", () => {
    expect(legacyEntryMessage(entry(), ko)).toBe(
      lookup("plugin.legacy.entry.noTier", "ko"),
    );
    expect(
      legacyEntryMessage(entry({ demotedBecause: "unknown-capability" }), ko),
    ).toBe(lookup("plugin.legacy.entry.unknownCapability", "ko"));
  });

  it("returns Korean, so a hardcoded sentence would fail", () => {
    const message = legacyEntryMessage(entry(), ko);
    expect(message).not.toContain("predates");
    expect(message).not.toContain("Ask the author");
    // A missing key falls back to the English value, and `t` returns the KEY itself when even
    // that is absent — both would pass the two assertions above.
    expect(message).not.toBe("plugin.legacy.entry.noTier");
    expect(message).not.toBe(lookup("plugin.legacy.entry.noTier", "en"));
  });

  it("keeps the two branches distinguishable in Korean too", () => {
    // The whole reason two branches exist is that the remedies differ. One key wired to both,
    // or one Korean value pasted over the other, is the defect.
    expect(legacyEntryMessage(entry(), ko)).not.toBe(
      legacyEntryMessage(entry({ demotedBecause: "unknown-capability" }), ko),
    );
  });
});

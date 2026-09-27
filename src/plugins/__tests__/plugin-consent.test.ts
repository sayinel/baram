import type { PluginCapability, PluginConsent } from "../types";

import { describe, expect, it } from "vitest";

import {
  claimedConsent,
  consentGaps,
  consentRequired,
  grantableCapabilities,
} from "../plugin-consent";
import { communityEntry } from "./community-fixture";

const sandboxed = (...capabilities: PluginCapability[]): PluginConsent => ({
  capabilities,
  trust: "sandboxed",
});

describe("consentRequired (§260 Phase 5)", () => {
  it("asks on a first install", () => {
    expect(
      consentRequired(undefined, { capabilities: [], trust: "sandboxed" }),
    ).toBe("first-install");
  });

  it("asks when the tier escalates to trusted", () => {
    expect(
      consentRequired(sandboxed("editor"), {
        capabilities: ["editor"],
        trust: "trusted",
      }),
    ).toBe("escalation");
  });

  it("asks when a capability is added", () => {
    expect(
      consentRequired(sandboxed("editor"), {
        capabilities: ["editor", "network"],
        trust: "sandboxed",
      }),
    ).toBe("escalation");
  });

  it("stays silent when nothing changed, whatever the order", () => {
    expect(
      consentRequired(sandboxed("editor", "network"), {
        capabilities: ["network", "editor"],
        trust: "sandboxed",
      }),
    ).toBeNull();
  });

  // The false positive a plain subset test produces: `files` already covers
  // `files:readonly`, so an update that NARROWS a grant must not prompt. Prompting
  // there teaches users that the consent dialog is noise.
  it("stays silent when a grant narrows to its readonly form", () => {
    expect(
      consentRequired(sandboxed("files"), {
        capabilities: ["files:readonly"],
        trust: "sandboxed",
      }),
    ).toBeNull();
    expect(
      consentRequired(sandboxed("editor"), {
        capabilities: ["editor:readonly"],
        trust: "sandboxed",
      }),
    ).toBeNull();
  });

  it("still asks when a readonly grant widens", () => {
    expect(
      consentRequired(sandboxed("files:readonly"), {
        capabilities: ["files"],
        trust: "sandboxed",
      }),
    ).toBe("escalation");
  });

  it("does not ask when the tier narrows to sandboxed", () => {
    expect(
      consentRequired(
        { capabilities: ["editor"], trust: "trusted" },
        { capabilities: ["editor"], trust: "sandboxed" },
      ),
    ).toBeNull();
  });

  it("does not treat a re-install at the same trusted tier as an escalation", () => {
    expect(
      consentRequired(
        { capabilities: ["editor"], trust: "trusted" },
        { capabilities: ["editor"], trust: "trusted" },
      ),
    ).toBeNull();
  });
});

describe("consentGaps (§260 Phase 5)", () => {
  it("names the tier and every uncovered capability", () => {
    const gaps = consentGaps(sandboxed("editor"), {
      capabilities: ["editor", "network", "files"],
      trust: "trusted",
    });
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toContain("trusted");
    expect(gaps[1]).toContain("network");
    expect(gaps[1]).toContain("files");
    // The covered one must not be listed as a gap.
    expect(gaps[1]).not.toContain("editor");
  });

  it("does not repeat a duplicated capability in the message", () => {
    // A manifest may legally list one twice; "network, network" in a user-facing error
    // reads like a bug in the app (§260 Phase 5 code review, L5).
    const gaps = consentGaps(sandboxed("editor"), {
      capabilities: ["network", "network"],
      trust: "sandboxed",
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("network");
    expect(gaps[0]).not.toContain("network, network");
  });

  it("is empty when the consent covers the request", () => {
    expect(
      consentGaps(sandboxed("files"), {
        capabilities: ["files:readonly"],
        trust: "sandboxed",
      }),
    ).toEqual([]);
  });

  it("reports the tier alone when only the tier exceeds", () => {
    const gaps = consentGaps(sandboxed("editor"), {
      capabilities: ["editor"],
      trust: "trusted",
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("trusted");
  });
});

describe("grantableCapabilities (§260 Phase 5 review, H3)", () => {
  it("drops a capability the manifest gained after consent was given", () => {
    // The escalation this closes: edit `baram-plugin.json` post-install and the next
    // start used to hand the Rust broker whatever the file now says.
    expect(
      grantableCapabilities(
        { capabilities: ["editor", "network"] },
        sandboxed("editor"),
      ),
    ).toEqual(["editor"]);
  });

  it("keeps a readonly form the consent covers by implication", () => {
    expect(
      grantableCapabilities(
        { capabilities: ["files:readonly"] },
        sandboxed("files"),
      ),
    ).toEqual(["files:readonly"]);
  });

  it("does not widen when the manifest asks for less than was approved", () => {
    expect(
      grantableCapabilities(
        { capabilities: ["editor"] },
        sandboxed("editor", "network"),
      ),
    ).toEqual(["editor"]);
  });

  it("grants the manifest unchanged when there is no consent record", () => {
    // Dev-folder plugins have none — choosing the directory IS the consent — so
    // narrowing here would break the dev loop while protecting no user.
    expect(
      grantableCapabilities({ capabilities: ["editor", "network"] }, undefined),
    ).toEqual(["editor", "network"]);
  });

  it("preserves manifest order, so the grant is stable across loads", () => {
    expect(
      grantableCapabilities(
        { capabilities: ["storage", "editor", "events"] },
        sandboxed("events", "editor", "storage"),
      ),
    ).toEqual(["storage", "editor", "events"]);
  });
});

describe("consentGaps — the publisher rule (§382)", () => {
  const approvedFrom = (
    publisherId: number | undefined,
    publisher = "octocat",
  ): PluginConsent => ({
    capabilities: ["events"],
    channel: "community",
    publisher,
    ...(publisherId === undefined ? {} : { publisherId }),
    trust: "sandboxed",
  });
  const listing = (
    channel: "community" | "first-party",
    publisherId?: number,
  ) => ({
    capabilities: ["events"] as PluginCapability[],
    channel,
    publisherId,
    trust: "sandboxed" as const,
  });

  it("asks when a community plugin's publisher ACCOUNT changes, capabilities unchanged", () => {
    expect(
      consentGaps(approvedFrom(583231), listing("community", 999001)),
    ).toHaveLength(1);
    expect(
      consentRequired(approvedFrom(583231), listing("community", 999001)),
    ).toBe("escalation");
  });

  it("does not ask when only the login changed — the id is the identity", () => {
    expect(
      consentGaps(
        approvedFrom(583231, "old-login"),
        listing("community", 583231),
      ),
    ).toEqual([]);
  });

  it("asks for a community listing when the record names no publisher (written before §382)", () => {
    // Spec 0058 §9.2: no migration, and no "every old install is first-party" assumption —
    // before 2026-08-04 an install could come from any registry.
    expect(
      consentRequired(
        { capabilities: ["events"], trust: "sandboxed" },
        listing("community", 583231),
      ),
    ).toBe("escalation");
  });

  it("asks when a first-party record meets a later community listing under the same id (plan 0104 P20)", () => {
    // A first-party record carries no publisherId (it never had one to carry) — so it is
    // exactly as "no id recorded" as a pre-§382 record, and a community listing under the
    // same id asks for the same reason.
    expect(
      consentRequired(
        {
          capabilities: ["events"],
          channel: "first-party",
          trust: "sandboxed",
        },
        listing("community", 583231),
      ),
    ).toBe("escalation");
  });

  it("never applies to a first-party listing, whatever the record says", () => {
    expect(
      consentGaps(
        { capabilities: ["events"], trust: "sandboxed" },
        listing("first-party"),
      ),
    ).toEqual([]);
    expect(consentGaps(approvedFrom(583231), listing("first-party"))).toEqual(
      [],
    );
  });

  it("never applies to a downloaded manifest, which names no channel", () => {
    // The post-download cross-check (`stageValidateAndCommit`) passes the manifest, and a
    // manifest does not know its publisher — the rule must stay out of that comparison.
    expect(
      consentGaps(approvedFrom(583231), {
        capabilities: ["events"],
        trust: "sandboxed",
      }),
    ).toEqual([]);
  });
});

describe("claimedConsent (§382)", () => {
  it("records channel and publisher for a community listing", () => {
    const entry = communityEntry({
      capabilities: ["network", "editor"],
      channel: "community",
    });
    expect(claimedConsent(entry, "sandboxed")).toEqual({
      capabilities: ["editor", "network"],
      channel: "community",
      publisher: "octocat",
      publisherId: 583231,
      trust: "sandboxed",
    });
  });

  it("records the first-party channel and no publisher", () => {
    // `publisher` on a first-party entry cannot come through Rust (and `registry-client.ts`
    // strips it besides); if it ever did, it must not reach the record, or a later community
    // listing carrying the same id would switch channel without asking.
    const entry = communityEntry({ channel: "first-party", id: "baram-demo" });
    expect(Object.keys(claimedConsent(entry, "sandboxed")).sort()).toEqual([
      "capabilities",
      "channel",
      "trust",
    ]);
  });

  it("records no channel for an entry that names none", () => {
    const entry = communityEntry({ channel: undefined });
    expect(Object.keys(claimedConsent(entry, "sandboxed")).sort()).toEqual([
      "capabilities",
      "trust",
    ]);
  });
});

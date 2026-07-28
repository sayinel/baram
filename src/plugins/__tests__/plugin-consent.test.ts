import type { PluginCapability, PluginConsent } from "../types";

import { describe, expect, it } from "vitest";

import {
  consentGaps,
  consentRequired,
  grantableCapabilities,
} from "../plugin-consent";

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

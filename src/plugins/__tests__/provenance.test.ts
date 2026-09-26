// §382 — the one function every screen asks "where did this come from?".
import { describe, expect, it } from "vitest";

import {
  consentProvenance,
  provenanceOf,
  publisherProfileUrl,
} from "../provenance";

describe("provenanceOf (§382)", () => {
  it("names Baram for a first-party source", () => {
    expect(provenanceOf({ channel: "first-party" })).toEqual({
      channel: "first-party",
    });
  });

  it("names the publisher for a community source", () => {
    expect(
      provenanceOf({ channel: "community", publisher: "octocat" }),
    ).toEqual({
      channel: "community",
      publisher: "octocat",
    });
  });

  it("says nothing when no channel is recorded", () => {
    // An install from before §382, a dev folder, a built-in: spec 0058 §9.3 gives these no
    // badge rather than a guess.
    expect(provenanceOf({})).toBeNull();
    expect(provenanceOf(undefined)).toBeNull();
  });

  it("refuses a community publisher that is not a GitHub login", () => {
    // The consent record comes back from `config.json`, which the webview can write — the
    // ingest's login check does not cover it, so this one must.
    for (const publisher of [
      undefined,
      "",
      "-octocat",
      "octo--cat",
      "a".repeat(40),
      "<b>x</b>",
      "octo cat",
    ]) {
      expect(provenanceOf({ channel: "community", publisher })).toBeNull();
    }
  });
});

describe("publisherProfileUrl (§382)", () => {
  it("is the publisher's GitHub profile", () => {
    expect(publisherProfileUrl("octocat")).toBe("https://github.com/octocat");
  });
});

describe("consentProvenance (§382)", () => {
  const fromOctocat = {
    capabilities: [],
    channel: "community" as const,
    publisher: "octocat",
    publisherId: 583231,
    trust: "sandboxed" as const,
  };

  it("names the publisher the update replaces when the ACCOUNT changed", () => {
    expect(
      consentProvenance(
        { ...fromOctocat, publisher: "new-owner", publisherId: 999001 },
        fromOctocat,
      ),
    ).toEqual({
      channel: "community",
      previousPublisher: "octocat",
      publisher: "new-owner",
    });
  });

  it("names no previous publisher when only the login changed", () => {
    expect(
      consentProvenance(
        { ...fromOctocat, publisher: "octocat-renamed" },
        fromOctocat,
      ),
    ).toEqual({ channel: "community", publisher: "octocat-renamed" });
  });

  it("names none when the prior record shows no publisher to compare", () => {
    expect(
      consentProvenance(fromOctocat, { capabilities: [], trust: "sandboxed" }),
    ).toEqual({ channel: "community", publisher: "octocat" });
  });

  it("is undefined for a consent with no channel — a dev folder", () => {
    expect(
      consentProvenance({ capabilities: [], trust: "sandboxed" }),
    ).toBeUndefined();
  });
});

// §382 — the one function every screen asks "where did this come from?".
import { describe, expect, it } from "vitest";

import { provenanceOf, publisherProfileUrl } from "../provenance";

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

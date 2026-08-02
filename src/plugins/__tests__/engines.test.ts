// §69 — `engines.baram`, which was declared by every plugin and evaluated by nothing.
import { describe, expect, it } from "vitest";

import { parseBaramFloor, unmetBaramFloor } from "../engines";

describe("parseBaramFloor", () => {
  it("reads the one grammar the publish gate also reads", () => {
    expect(parseBaramFloor(">=0.5.0")).toBe("0.5.0");
    // `">= 0.5.0"` is the same statement to someone typing it by hand.
    expect(parseBaramFloor(">= 0.5.0")).toBe("0.5.0");
    expect(parseBaramFloor("  >=1.10.2  ")).toBe("1.10.2");
  });

  it.each([
    "^0.5.0",
    "~0.5.0",
    "0.5.0",
    ">0.5.0",
    ">=0.5",
    ">=0.5.0 <1.0.0",
    ">=0.5.0-beta.1",
    "*",
    "",
    "latest",
  ])("states no evaluable floor: %s", (raw) => {
    // Not an error — "no opinion". A grammar this cannot read must not deny anyone a
    // plugin, because neither the app nor the user can fix the author's manifest.
    expect(parseBaramFloor(raw)).toBeNull();
  });

  it("is anchored at both ends", () => {
    // A prefix match would read a floor out of prose and enforce it.
    expect(parseBaramFloor("needs >=0.5.0")).toBeNull();
    expect(parseBaramFloor(">=0.5.0 or newer")).toBeNull();
  });

  it("treats a missing field as no floor", () => {
    expect(parseBaramFloor(undefined)).toBeNull();
  });
});

describe("unmetBaramFloor", () => {
  it("names the floor when the app is below it", () => {
    expect(unmetBaramFloor("0.5.1", { baram: ">=0.6.0" })).toBe("0.6.0");
    // The comparison is numeric per field, not lexical: "0.9.0" < "0.10.0".
    expect(unmetBaramFloor("0.9.0", { baram: ">=0.10.0" })).toBe("0.10.0");
  });

  it("permits an app at or above the floor", () => {
    expect(unmetBaramFloor("0.5.0", { baram: ">=0.5.0" })).toBeNull();
    expect(unmetBaramFloor("0.5.1", { baram: ">=0.5.0" })).toBeNull();
    expect(unmetBaramFloor("1.0.0", { baram: ">=0.5.0" })).toBeNull();
    expect(unmetBaramFloor("0.10.0", { baram: ">=0.9.0" })).toBeNull();
  });

  it("holds a prerelease app below the release it precedes", () => {
    // Plain semver precedence, and the same answer the publish gate gives: a prerelease
    // is not the release that ships the floor.
    expect(unmetBaramFloor("0.6.0-beta.1", { baram: ">=0.6.0" })).toBe("0.6.0");
    expect(unmetBaramFloor("0.6.0-beta.1", { baram: ">=0.5.0" })).toBeNull();
  });

  it("has no opinion when either side is unreadable", () => {
    // Every one of these would, if it refused instead, break installing over something
    // the user cannot correct. `getVersion()` returning nothing under a mocked IPC is
    // the realistic case for the first two.
    expect(unmetBaramFloor(null, { baram: ">=99.0.0" })).toBeNull();
    expect(unmetBaramFloor(undefined, { baram: ">=99.0.0" })).toBeNull();
    expect(unmetBaramFloor("", { baram: ">=99.0.0" })).toBeNull();
    expect(unmetBaramFloor("not-a-version", { baram: ">=99.0.0" })).toBeNull();
    expect(unmetBaramFloor("0.5.1", undefined)).toBeNull();
    expect(unmetBaramFloor("0.5.1", { baram: "^99.0.0" })).toBeNull();
  });
});

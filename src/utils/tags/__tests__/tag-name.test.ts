// §56m A tag's name.
import { describe, expect, it } from "vitest";

import { tagName } from "../tag-name";

describe("tagName", () => {
  it("removes every leading #", () => {
    expect(tagName("#solo")).toBe("solo");
    expect(tagName("##solo")).toBe("solo");
  });

  // Positive partner of the two above: a bare name passes through, and a `#` that does not
  // lead is part of the name.
  it("leaves a bare name and an inner # alone", () => {
    expect(tagName("solo")).toBe("solo");
    expect(tagName("c#/notes")).toBe("c#/notes");
  });

  it("is empty for a spelling made only of #", () => {
    expect(tagName("##")).toBe("");
  });
});

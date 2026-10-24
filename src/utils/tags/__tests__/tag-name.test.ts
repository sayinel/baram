// §56m A tag's name and the vault tag list merged by name.
import { describe, expect, it } from "vitest";

import { tagEntriesByName, tagName } from "../tag-name";

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

describe("tagEntriesByName", () => {
  // What turns this red: listing the index rows as they come. A front-matter item spelled
  // `"#solo"` is indexed as `#solo`, beside the body's `solo` — one tag shown as two rows,
  // one of them `##solo`.
  it("merges rows whose names differ only by leading #, adding their counts", () => {
    expect(
      tagEntriesByName([
        { count: 3, tag: "solo" },
        { count: 2, tag: "#solo" },
        { count: 1, tag: "##solo" },
      ]),
    ).toEqual([{ count: 6, tag: "solo" }]);
  });

  it("keeps distinct names apart and sorts by count, then name", () => {
    expect(
      tagEntriesByName([
        { count: 1, tag: "b" },
        { count: 1, tag: "#a" },
        { count: 4, tag: "c" },
      ]),
    ).toEqual([
      { count: 4, tag: "c" },
      { count: 1, tag: "a" },
      { count: 1, tag: "b" },
    ]);
  });

  it("drops a row with no name left", () => {
    expect(
      tagEntriesByName([
        { count: 1, tag: "#" },
        { count: 2, tag: "x" },
      ]),
    ).toEqual([{ count: 2, tag: "x" }]);
  });
});

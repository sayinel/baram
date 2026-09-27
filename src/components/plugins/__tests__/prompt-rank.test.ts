// §385 spec 0061 §4 — label matches first, description-only matches after, each by score.
import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareItems, rankItems } from "../prompt-rank";

const items = [
  { description: "journal/meeting", id: "d", label: "Daily" },
  { id: "m2", label: "Team Meeting notes" },
  { id: "m1", label: "Meeting" },
  { id: "x", label: "Unrelated" },
];

describe("rankItems", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the plugin's order for an empty query, up to the limit", () => {
    expect(rankItems("", prepareItems(items), 2).map((i) => i.id)).toEqual([
      "d",
      "m2",
    ]);
  });

  it("puts label matches first, best score first, then description-only matches", () => {
    expect(rankItems("meet", prepareItems(items), 50).map((i) => i.id)).toEqual(
      ["m1", "m2", "d"],
    );
  });

  it("matches without regard to case", () => {
    expect(rankItems("MEET", prepareItems(items), 50).map((i) => i.id)).toEqual(
      ["m1", "m2", "d"],
    );
  });

  it("lowercases the query once per call and the items not at all", () => {
    // The count is the performance pin (spec 0061 §7): per-keystroke lowercasing of every item
    // is exactly what `prepareItems` exists to move out of the keystroke.
    const prepared = prepareItems(items);
    const lower = vi.spyOn(String.prototype, "toLowerCase");
    rankItems("meet", prepared, 50);
    expect(lower).toHaveBeenCalledTimes(1);
  });
});

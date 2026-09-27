// §385 spec 0061 §7 — the lowercase-input scorer must score exactly as fuzzyScore does.
import { describe, expect, it } from "vitest";

import { fuzzyScore, fuzzyScoreLower } from "../file-search";

describe("fuzzyScoreLower", () => {
  it.each([
    ["mtg", "Meeting notes"],
    ["노트", "회의 노트"],
    ["abc", "a/b-c"],
    ["zzz", "Meeting"],
    ["", "anything"],
  ])("scores %s in %s like fuzzyScore", (query, text) => {
    expect(fuzzyScoreLower(query.toLowerCase(), text.toLowerCase())).toBe(
      fuzzyScore(query, text),
    );
  });
});

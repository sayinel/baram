// §390 spec 0069 §3.3 — fuzzy matching folds both sides (foldName), so a name
// stored decomposed (NFD) is found by the composed query typed. Matching walks
// code units, and a composed syllable is one code unit where its decomposed
// spelling is two or three.
import { describe, expect, it } from "vitest";

import { fuzzyMatch, fuzzyScore } from "../file-search";

const MEETING = "회의록";
const MEETING_NFD = MEETING.normalize("NFD");

describe("§390 fuzzy matching across normalization", () => {
  it("the two spellings differ", () => {
    expect(MEETING_NFD).not.toBe(MEETING);
  });

  it("fuzzyMatch finds a decomposed name from a composed query, and not another name", () => {
    // What fails this: fuzzyMatch folding the text by toLowerCase alone.
    expect(fuzzyMatch("회의", `${MEETING_NFD} 2026.md`)).toBe(true);
    expect(fuzzyMatch("회의", "계획.md")).toBe(false);
  });

  it("a query typed decomposed finds a composed name too", () => {
    // What fails this: fuzzyMatch folding the query by toLowerCase alone.
    expect(fuzzyMatch("회의".normalize("NFD"), `${MEETING}.md`)).toBe(true);
  });

  it("fuzzyScore scores the decomposed name as it scores the composed one", () => {
    // What fails this: fuzzyScore folding by toLowerCase alone — Infinity.
    const composed = fuzzyScore("회의", `${MEETING}.md`);
    expect(composed).toBeLessThan(Infinity);
    expect(fuzzyScore("회의", `${MEETING_NFD}.md`)).toBe(composed);
  });
});

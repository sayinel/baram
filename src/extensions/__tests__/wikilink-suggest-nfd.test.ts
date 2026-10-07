// §390 spec 0069 §3.3 · D7 — the [[ menu over names some tool stored
// decomposed (NFD): its rows are built composed (NFC), so what a row inserts
// and what Tab completes is composed, and typed names compare under foldName.
import { beforeEach, describe, expect, it } from "vitest";

import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
import { hasExactMatch } from "../plugins/wikilink-suggest";
import {
  buildFileSuggestionItem,
  completionCandidates,
  crossVaultItem,
  longestCommonPrefix,
  namespaceItems,
} from "../plugins/wikilink-suggest-utils";

const MEETING = "회의록";
const MEETING_NFD = MEETING.normalize("NFD");
const PROJECT = "프로젝트";
const PROJECT_NFD = PROJECT.normalize("NFD");
// Capital J with a caron has no composed form: lowercased it is `j` + caron,
// which NFC composes to U+01F0 — a pair foldName joins and lowercasing alone
// keeps apart, though both spellings are composed (NFC) already.
const J_CARON = String.fromCodePoint(0x4a, 0x30c);
const J_CARON_LOWER = String.fromCodePoint(0x1f0);

function row(name: string, dir = "/v") {
  return buildFileSuggestionItem({ name, path: `${dir}/${name}` }, name);
}

beforeEach(() => useZettelIndexStore.getState().clear());

it("the spellings differ", () => {
  expect(MEETING_NFD).not.toBe(MEETING);
  expect(PROJECT_NFD).not.toBe(PROJECT);
  expect(J_CARON.toLowerCase()).not.toBe(J_CARON_LOWER);
});

describe("§390 rows are built composed (D7)", () => {
  it("a note's row draws and inserts its name composed, its path as stored", () => {
    // What fails this: buildFileSuggestionItem keeping the stored spelling.
    const r = row(`${MEETING_NFD}.md`);
    expect(r.label).toBe(MEETING);
    expect(r.target).toBe(MEETING);
    expect(r.path).toBe(`/v/${MEETING_NFD}.md`);
  });

  it("a zettel note's title is composed, and its id is inserted as it is", () => {
    // What fails this: the zettel branch keeping the index's spelling.
    useZettelIndexStore.getState().setAll([
      {
        id: "202610061200",
        path: `/v/notes/202610061200 ${MEETING_NFD}.md`,
        title: MEETING_NFD,
      },
    ]);
    const r = row(`202610061200 ${MEETING_NFD}.md`, "/v/notes");
    expect(r.label).toBe(MEETING);
    expect(r.searchText).toBe(MEETING);
    expect(r.target).toBe("202610061200");
  });

  it("another vault's row too", () => {
    // What fails this: crossVaultItem keeping the stored spelling.
    const r = crossVaultItem(
      { name: `${MEETING_NFD}.md`, path: `/w/${MEETING_NFD}.md` },
      "x",
      "w",
    );
    expect(r.label).toBe(MEETING);
    expect(r.target).toBe(MEETING);
  });
});

describe("§390 Tab completion", () => {
  it("completes two decomposed names to their common prefix, composed", () => {
    // spec 0069 §7: NFD 회의록 2026 and 회의록 2027 complete to 회의록 202, NFC.
    // What fails this: rows keeping the stored spelling — the composed query
    // matches no candidate, and Tab completes nothing.
    const rows = [row(`${MEETING_NFD} 2026.md`), row(`${MEETING_NFD} 2027.md`)];
    expect(longestCommonPrefix(completionCandidates(rows, "회의"))).toBe(
      `${MEETING} 202`,
    );
  });

  it("a candidate is matched under foldName, not lowercase alone", () => {
    // What fails this: completionCandidates comparing by toLowerCase.
    expect(
      completionCandidates([row(`${J_CARON}ournal.md`)], `${J_CARON_LOWER}our`),
    ).toEqual([`${J_CARON}ournal`]);
  });

  it("cuts the first candidate where the candidates part, measured on it", () => {
    // What fails this: an index found on lowercased or folded copies cutting
    // the original. `İ` lowercases to two code units, so such a cut lands one
    // unit late and keeps the `l`; NFC joins a decomposed syllable, so a cut
    // measured on folded copies lands early (spec 0069 §3.3's review example).
    const dotted = String.fromCodePoint(0x130);
    const stroke = String.fromCodePoint(0x142);
    expect(
      longestCommonPrefix([`${dotted}stanbul`, `${dotted}stanbu${stroke}`]),
    ).toBe(`${dotted}stanbu`);
    expect(
      longestCommonPrefix([`${MEETING_NFD} 2026`, `${MEETING_NFD} 2027`]),
    ).toBe(`${MEETING_NFD} 202`);
    expect(longestCommonPrefix(["Architecture", "architect"])).toBe(
      "Architect",
    );
  });

  it("a decomposed query still completes against the composed rows", () => {
    // What fails this: completionCandidates folding the row but not the typed
    // query — a name pasted from Finder is decomposed (NFD), the rows composed.
    expect(
      completionCandidates(
        [row(`${MEETING} 2026.md`)],
        "회의".normalize("NFD"),
      ),
    ).toEqual([`${MEETING} 2026`]);
  });
});

describe("§390 a typed name against the rows", () => {
  it("hasExactMatch sees a stored decomposed name in the composed query", () => {
    // What fails this: rows keeping the stored spelling — the query then
    // matches nothing, and the menu offers to create a note that exists.
    expect(hasExactMatch([row(`${MEETING_NFD}.md`)], MEETING)).toBe(true);
    expect(hasExactMatch([row(`${MEETING_NFD}.md`)], `${MEETING} 2`)).toBe(
      false,
    );
  });

  it("hasExactMatch compares under foldName, not lowercase alone", () => {
    // What fails this: hasExactMatch comparing by toLowerCase.
    expect(
      hasExactMatch([row(`${J_CARON}ournal.md`)], `${J_CARON_LOWER}ournal`),
    ).toBe(true);
  });

  it("hasExactMatch folds the typed query too, not only the rows", () => {
    // What fails this: hasExactMatch folding the row but not the query — a
    // name pasted from Finder is decomposed (NFD), the row composed.
    expect(hasExactMatch([row(`${MEETING}.md`)], MEETING_NFD)).toBe(true);
    expect(hasExactMatch([row(`${MEETING}.md`)], `${MEETING_NFD} 2`)).toBe(
      false,
    );
  });

  it("namespace mode lists a folder stored decomposed for the folder typed", () => {
    // What fails this: namespaceItems comparing the folder byte for byte.
    const inside = row(`${MEETING_NFD}.md`, `/v/${PROJECT_NFD}`);
    const outside = row("other.md", "/v/else");
    const rows = namespaceItems(
      [inside, outside],
      `/v/${PROJECT}`,
      `../${PROJECT}/`,
    );
    expect(rows.map((r) => r.label)).toEqual([`../${PROJECT}/${MEETING}`]);
  });

  it("namespace mode folds the folder it was given, not only the stored one", () => {
    // What fails this: namespaceItems folding the stored folder but not
    // `targetDir` — the folder typed `Notes` is the stored `notes`. (The test
    // above cannot tell: its `targetDir` is already its own fold.)
    const rows = namespaceItems(
      [row("plan.md", "/v/notes")],
      "/v/Notes",
      "../Notes/",
    );
    expect(rows.map((r) => r.label)).toEqual(["../Notes/plan"]);
  });
});

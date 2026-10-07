// §34 · §390 — the edit the backlinks panel's "link" button makes to one line.
import { describe, expect, it } from "vitest";

import { linkifyMention } from "../linkify-mention";

const NOTE = "노트";
const NOTE_NFD = NOTE.normalize("NFD");

describe("§390 linkifyMention", () => {
  it("links a composed mention of a note stored decomposed by its composed name", () => {
    // What fails this: the stem written as stored (D7), or the mention and
    // the stem compared byte for byte — `[[노트|노트]]` with the stored stem.
    expect(NOTE_NFD).not.toBe(NOTE);
    expect(linkifyMention(`see ${NOTE} here`, NOTE, NOTE_NFD)).toBe(
      `see [[${NOTE}]] here`,
    );
  });

  it("keeps a mention in another case as the link's text", () => {
    // spec 0069 §3.3: compared in NFC only, not under foldName — folding
    // would write `[[Baram]]` over the user's `baram`, in another note, past
    // undo. What fails this: comparing the two case-insensitively.
    expect(linkifyMention("about baram today", "baram", "Baram")).toBe(
      "about [[Baram|baram]] today",
    );
  });

  it("links a decomposed mention by the composed name too", () => {
    // The backend matches the name composed and as stored
    // (`find_unlinked_mentions`), so the mention it reports can be
    // decomposed. What fails this: comparing the mention without composing it
    // first — `[[노트|<the decomposed mention>]]`.
    expect(linkifyMention(`see ${NOTE_NFD} here`, NOTE_NFD, NOTE_NFD)).toBe(
      `see [[${NOTE}]] here`,
    );
  });

  it("keeps the mention's own spelling as the link's text", () => {
    // The mention is the user's text, and the link shows it as written. The
    // stem is stored decomposed too: the backend's pattern is the name
    // composed or as stored (`find_unlinked_mentions`), so a decomposed
    // mention is reported only beside a decomposed stem (spec 0069 §8). What
    // fails this: composing the alias along with the name.
    const mention = `baram${NOTE_NFD}`;
    expect(
      linkifyMention(`about ${mention}`, mention, `Baram${NOTE_NFD}`),
    ).toBe(`about [[Baram${NOTE}|${mention}]]`);
  });

  it("finds the mention as it is, and cuts the line where it is", () => {
    // What fails this: searching a lowercased copy — `İ` lowercases to two
    // code units, so the index found there cuts the line two units late.
    const dotted = String.fromCodePoint(0x130);
    expect(linkifyMention(`${dotted}${dotted} Baram`, "Baram", "Baram")).toBe(
      `${dotted}${dotted} [[Baram]]`,
    );
  });

  it("returns null for a line that no longer holds the mention", () => {
    // No write without the mention — the other tests here assert the link
    // when it is there. What fails this: deleting `if (at === -1) return
    // null;` — the splice then runs at index -1 and returns a line, not null.
    expect(linkifyMention("nothing here", "Baram", "Baram")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  extractLeadingId,
  isZettelId,
  parseNoteTitle,
} from "../parse-note-title";

describe("isZettelId", () => {
  it("matches 12-14 digit ids only", () => {
    expect(isZettelId("202607051530")).toBe(true);
    expect(isZettelId("20260705153012")).toBe(true);
    expect(isZettelId("2026")).toBe(false);
    expect(isZettelId("202607051530 x")).toBe(false);
    expect(isZettelId("architecture")).toBe(false);
  });
});

describe("extractLeadingId — mirrors Rust extract_id_from_stem (§95/§99 M3)", () => {
  it("extracts a 12-digit id followed by a space", () => {
    expect(extractLeadingId("202607051530 원자적 노트.md")).toBe(
      "202607051530",
    );
  });
  it("extracts a 14-digit id followed by a space", () => {
    expect(extractLeadingId("20260705153012 note.md")).toBe("20260705153012");
  });
  it("extracts a bare id filename (id is the whole stem)", () => {
    expect(extractLeadingId("202607051530.md")).toBe("202607051530");
  });
  it("extracts from a stem with no extension", () => {
    expect(extractLeadingId("202607051530 title")).toBe("202607051530");
  });
  it("strips .markdown too", () => {
    expect(extractLeadingId("202607051530.markdown")).toBe("202607051530");
  });
  it("returns null when the digit run is followed by a hyphen, not a space", () => {
    expect(extractLeadingId("202607051530-note.md")).toBeNull();
  });
  it("returns null for a non-id filename", () => {
    expect(extractLeadingId("architecture.md")).toBeNull();
  });
  it("returns null when the digit run is too short", () => {
    expect(extractLeadingId("2026 draft.md")).toBeNull();
  });
});

describe("parseNoteTitle", () => {
  it("prefers frontmatter title", () => {
    expect(
      parseNoteTitle(
        "202607051530 원자적 노트.md",
        "---\nid: 202607051530\ntitle: 실제 제목\n---\n\n# x",
      ),
    ).toBe("실제 제목");
  });
  it("unwraps a quoted frontmatter title", () => {
    expect(
      parseNoteTitle("202607051530.md", '---\ntitle: "TCP/IP: 정리"\n---\n'),
    ).toBe("TCP/IP: 정리");
  });
  it("falls back to filename title (id prefix stripped)", () => {
    expect(
      parseNoteTitle("202607051530 원자적 노트.md", "no frontmatter"),
    ).toBe("원자적 노트");
  });
  it("falls back to the id when only an id filename + no title", () => {
    expect(parseNoteTitle("202607051530.md", "just body")).toBe("202607051530");
  });
});

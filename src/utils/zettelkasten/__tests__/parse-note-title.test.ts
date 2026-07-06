import { describe, expect, it } from "vitest";

import { isZettelId, parseNoteTitle } from "../parse-note-title";

describe("isZettelId", () => {
  it("matches 12-14 digit ids only", () => {
    expect(isZettelId("202607051530")).toBe(true);
    expect(isZettelId("20260705153012")).toBe(true);
    expect(isZettelId("2026")).toBe(false);
    expect(isZettelId("202607051530 x")).toBe(false);
    expect(isZettelId("architecture")).toBe(false);
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

// §56 Journal utils — isJournalPath (gates journal-sidebar refresh on save)
import { describe, expect, it } from "vitest";

import { isJournalPath } from "../journal";

const DIR = "/vault/journal";

describe("isJournalPath (§56)", () => {
  it("matches a flat entry inside the journal dir", () => {
    expect(isJournalPath(`${DIR}/2026-07-17.md`, "/vault", DIR)).toBe(true);
  });

  it("matches a hierarchical entry inside the journal dir", () => {
    expect(
      isJournalPath(`${DIR}/daily/2026/07/2026-07-17.md`, "/vault", DIR),
    ).toBe(true);
  });

  it("matches the journal dir itself", () => {
    expect(isJournalPath(DIR, "/vault", DIR)).toBe(true);
  });

  it("does not match a file outside the journal dir", () => {
    expect(isJournalPath("/vault/notes/todo.md", "/vault", DIR)).toBe(false);
  });

  it("does not match a sibling dir sharing the prefix (no trailing-slash trap)", () => {
    expect(isJournalPath("/vault/journal-archive/x.md", "/vault", DIR)).toBe(
      false,
    );
  });

  it("returns false for a null/empty file path", () => {
    expect(isJournalPath(null, "/vault", DIR)).toBe(false);
    expect(isJournalPath(undefined, "/vault", DIR)).toBe(false);
  });

  it("returns false when the journal dir is unset/relative", () => {
    expect(isJournalPath(`${DIR}/2026-07-17.md`, "/vault", "")).toBe(false);
    expect(
      isJournalPath("/vault/journal/x.md", "/vault", "relative/journal"),
    ).toBe(false);
  });
});

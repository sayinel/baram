// §95 Zettelkasten export — resolve [[id]] to title in export output only.
import { beforeEach, describe, expect, it } from "vitest";

import { serializeWikilink } from "../../../pipeline/transformers/wikilink-transformer";
import { useZettelIndexStore } from "../../../stores/zettelkasten/zettel-index";
import { resolveZettelLinksForExport } from "../zettel-link-resolve";

describe("resolveZettelLinksForExport", () => {
  beforeEach(() => {
    useZettelIndexStore.getState().clear();
  });

  it("rewrites a bare zettel id link to [[id|title]] when the index has a title", () => {
    useZettelIndexStore
      .getState()
      .setAll([{ id: "202607051530", path: "p", title: "원자적 노트" }]);
    const result = resolveZettelLinksForExport("see [[202607051530]]");
    expect(result).toContain("원자적 노트");
    expect(result).toBe("see [[202607051530|원자적 노트]]");
  });

  it("leaves a non-id wikilink target unchanged", () => {
    useZettelIndexStore
      .getState()
      .setAll([{ id: "202607051530", path: "p", title: "원자적 노트" }]);
    const result = resolveZettelLinksForExport("see [[Architecture]]");
    expect(result).toBe("see [[Architecture]]");
  });

  it("leaves an already-aliased [[id|display]] link unchanged", () => {
    useZettelIndexStore
      .getState()
      .setAll([{ id: "202607051530", path: "p", title: "원자적 노트" }]);
    const result = resolveZettelLinksForExport(
      "see [[202607051530|My Custom Alias]]",
    );
    expect(result).toBe("see [[202607051530|My Custom Alias]]");
  });

  it("leaves a bare id unchanged when the index has no matching entry", () => {
    const result = resolveZettelLinksForExport("see [[202607051530]]");
    expect(result).toBe("see [[202607051530]]");
  });

  it("leaves a cross-vault aliased link unchanged even if target looks like an id", () => {
    useZettelIndexStore
      .getState()
      .setAll([{ id: "202607051530", path: "p", title: "원자적 노트" }]);
    const result = resolveZettelLinksForExport("see [[work::202607051530]]");
    expect(result).toBe("see [[work::202607051530]]");
  });

  it("leaves a heading-anchored bare id link unchanged (matches in-app NodeView gating)", () => {
    useZettelIndexStore
      .getState()
      .setAll([{ id: "202607051530", path: "p", title: "원자적 노트" }]);
    const result = resolveZettelLinksForExport("see [[202607051530#Section]]");
    expect(result).toBe("see [[202607051530#Section]]");
  });

  it("does not affect the round-trip .md serializer — serializeWikilink still emits bare [[id]]", () => {
    useZettelIndexStore
      .getState()
      .setAll([{ id: "202607051530", path: "p", title: "원자적 노트" }]);
    expect(serializeWikilink({ target: "202607051530" })).toBe(
      "[[202607051530]]",
    );
  });
});

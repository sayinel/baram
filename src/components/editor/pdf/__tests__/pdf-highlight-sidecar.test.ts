import { describe, expect, it } from "vitest";

import {
  companionPathFor,
  parseSidecar,
  sidecarPathFor,
} from "../pdf-highlight-sidecar";

const validHighlight = {
  color: "yellow",
  id: "h7k2m9",
  kind: "text",
  page: 3,
  rects: [{ h: 12.4, w: 380.5, x: 72.1, y: 540.3 }],
};

function sidecarJson(highlights: unknown[]): string {
  return JSON.stringify({
    companion: "highlights/papers/attention.md",
    highlights,
    pdf: "papers/attention.pdf",
    version: 1,
  });
}

describe("path derivation", () => {
  it("mirrors the PDF path under highlights/ for the companion note", () => {
    expect(companionPathFor("papers/attention.pdf")).toBe(
      "highlights/papers/attention.md",
    );
    expect(companionPathFor("research/nlp/bert.pdf")).toBe(
      "highlights/research/nlp/bert.md",
    );
  });

  it("mirrors the PDF path under .baram/pdf-highlights/ for the sidecar", () => {
    expect(sidecarPathFor("papers/attention.pdf")).toBe(
      ".baram/pdf-highlights/papers/attention.json",
    );
  });

  it("handles a PDF at the vault root", () => {
    expect(companionPathFor("attention.pdf")).toBe("highlights/attention.md");
    expect(sidecarPathFor("attention.pdf")).toBe(
      ".baram/pdf-highlights/attention.json",
    );
  });
});

describe("parseSidecar", () => {
  it("parses a well-formed sidecar", () => {
    const { sidecar, dropped } = parseSidecar(sidecarJson([validHighlight]));

    expect(dropped).toBe(0);
    expect(sidecar?.highlights).toHaveLength(1);
    expect(sidecar?.highlights[0].id).toBe("h7k2m9");
  });

  it("drops only the malformed entries and keeps the rest", () => {
    const { sidecar, dropped } = parseSidecar(
      sidecarJson([
        validHighlight,
        { id: "broken" }, // page/rects/color 없음
        { ...validHighlight, id: "p3n8q1", page: 4 },
        { ...validHighlight, id: "bad-color", color: "chartreuse" },
        { ...validHighlight, id: "bad-kind", kind: "bogus" }, // kind validation
        { ...validHighlight, id: "bad-page-zero", page: 0 }, // page >= 1 validation
        { ...validHighlight, id: "bad-page-neg", page: -1 }, // page >= 1 validation
        { ...validHighlight, id: "bad-rects-empty", rects: [] }, // rects.length > 0 validation
      ]),
    );

    expect(dropped).toBe(6);
    expect(sidecar?.highlights.map((h) => h.id)).toEqual(["h7k2m9", "p3n8q1"]);
  });

  it("returns null for unparseable JSON", () => {
    expect(parseSidecar("{not json").sidecar).toBeNull();
  });

  it("returns null for an unknown schema version", () => {
    const raw = JSON.stringify({
      companion: "x.md",
      highlights: [],
      pdf: "x.pdf",
      version: 99,
    });
    expect(parseSidecar(raw).sidecar).toBeNull();
  });

  it("returns an empty highlight list rather than null when highlights is absent", () => {
    const raw = JSON.stringify({
      companion: "x.md",
      pdf: "x.pdf",
      version: 1,
    });
    const { sidecar } = parseSidecar(raw);
    expect(sidecar?.highlights).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import {
  companionPathFor,
  isDeletedHighlight,
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

// §277.2 삭제 표시. 이 필드를 파일에서 못 읽으면 삭제가 앱을 다시 켤 때마다
// 풀리고, 반대로 판정이 헐거우면 살아 있는 하이라이트가 사라진다.
describe("§277.2 deletedAt", () => {
  const deletedAt = "2026-08-17T01:23:45.000Z";

  it("keeps deletedAt through a parse", () => {
    const { sidecar } = parseSidecar(
      sidecarJson([{ ...validHighlight, deletedAt }]),
    );
    expect(sidecar?.highlights[0].deletedAt).toBe(deletedAt);
  });

  it("accepts a highlight with no deletedAt at all", () => {
    const { dropped, sidecar } = parseSidecar(sidecarJson([validHighlight]));
    expect(dropped).toBe(0);
    expect(sidecar?.highlights[0].deletedAt).toBeUndefined();
  });

  // 나쁜 `page`·나쁜 `rects`와 똑같이 다룬다 — "삭제 여부를 알 수 없는
  // 하이라이트"라는 세 번째 상태를 만들지 않는 것이 요점이다.
  it.each([
    ["a number", 1755393825000],
    ["null", null],
    ["an empty string", ""],
    ["an object", { at: deletedAt }],
  ])("drops an entry whose deletedAt is %s", (_label, bad) => {
    const { dropped, sidecar } = parseSidecar(
      sidecarJson([{ ...validHighlight, deletedAt: bad }, validHighlight]),
    );
    expect(dropped).toBe(1);
    expect(sidecar?.highlights).toHaveLength(1);
  });

  // ‼️ 구버전 빌드 호환의 근거다 — parseSidecar가 map이 아니라 filter라
  // 원본 객체가 그대로 통과하므로, 이 필드를 모르는 코드가 읽고 다시 써도
  // (스프레드로 나르는 한) 살아남는다. map으로 바꾸면 조용히 사라진다.
  it("passes the original object through, so unknown fields survive", () => {
    const { sidecar } = parseSidecar(
      sidecarJson([{ ...validHighlight, deletedAt, someFutureField: 7 }]),
    );
    expect(
      (sidecar?.highlights[0] as unknown as { someFutureField: number })
        .someFutureField,
    ).toBe(7);
  });
});

describe("isDeletedHighlight", () => {
  it("is false for a highlight with no deletedAt", () => {
    const { sidecar } = parseSidecar(sidecarJson([validHighlight]));
    expect(isDeletedHighlight(sidecar!.highlights[0])).toBe(false);
  });

  it("is true once deletedAt is present", () => {
    const { sidecar } = parseSidecar(
      sidecarJson([{ ...validHighlight, deletedAt: "2026-08-17T00:00:00Z" }]),
    );
    expect(isDeletedHighlight(sidecar!.highlights[0])).toBe(true);
  });
});

// ‼️ 봉투(최상위 키)의 라운드트립. 항목 수준만 지키는 것으로는 부족하다 —
// 모든 쓰기가 파일을 통째로 다시 쓰므로, 파서가 네 필드만 열거해 새 객체를
// 만들면 우리가 모르는 최상위 키는 **첫 쓰기 한 번에** 영구히 사라진다.
describe("§277.2 envelope round-trip", () => {
  it("carries unknown top-level keys through a parse", () => {
    const raw = JSON.stringify({
      companion: "highlights/papers/attention.md",
      highlights: [validHighlight],
      lastPurgedAt: "2026-08-17T00:00:00Z",
      pdf: "papers/attention.pdf",
      version: 1,
    });

    const { sidecar } = parseSidecar(raw);

    expect((sidecar as unknown as { lastPurgedAt: string }).lastPurgedAt).toBe(
      "2026-08-17T00:00:00Z",
    );
  });

  // 펼치기가 알려진 필드를 덮으면 안 된다 — highlights는 **검증을 거친**
  // 배열이어야지 원본 그대로가 아니다.
  it("still replaces highlights with the validated list, not the raw one", () => {
    const { dropped, sidecar } = parseSidecar(
      sidecarJson([validHighlight, { id: "broken" }]),
    );

    expect(dropped).toBe(1);
    expect(sidecar?.highlights).toHaveLength(1);
  });
});

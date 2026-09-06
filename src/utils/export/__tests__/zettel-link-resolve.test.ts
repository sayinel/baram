// §95 Zettelkasten export — resolve [[id]] to title in export output only.
import { beforeEach, describe, expect, it } from "vitest";

import {
  serializeWikilink,
  WIKILINK_RE,
} from "../../../pipeline/transformers/wikilink-transformer";
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

  /**
   * §99 fleeting 노트의 제목은 이제 **본문 첫 줄**이다 — 사용자가 프론트매터에
   * 일부러 적은 이름이 아니라 임의의 캡처 텍스트다. 그런데 `WIKILINK_RE`의 display
   * 캡처는 `(?:\|([^\]]+))?`라 `]`를 담지 못한다. 이스케이프 없이 넣으면 내보낸
   * 마크다운이 **다시 파싱되지 않는다**: 링크가 리터럴 텍스트가 되거나(체크박스
   * `- [ ]`), 조각으로 잘려 쓰레기 꼬리를 남긴다(`[[다른 노트]] 참고`).
   *
   * 재작성을 포기하면 출력은 `[[id]]` 그대로 — 사람이 읽기엔 덜 좋지만 **손상되지
   * 않는다**. 재작성은 편의이고 파싱 가능성은 계약이다.
   */
  describe("§99 a title that cannot survive the display slot is not written into it", () => {
    const withTitle = (title: string) =>
      useZettelIndexStore
        .getState()
        .setAll([{ id: "202607051530", path: "p", title }]);

    it("leaves the link bare when the title contains ] (checkbox capture)", () => {
      withTitle("- [ ] 장보기");
      expect(resolveZettelLinksForExport("보라: [[202607051530]] 끝")).toBe(
        "보라: [[202607051530]] 끝",
      );
    });

    it("leaves the link bare when the title contains a wikilink", () => {
      withTitle("[[다른 노트]] 참고");
      expect(resolveZettelLinksForExport("보라: [[202607051530]] 끝")).toBe(
        "보라: [[202607051530]] 끝",
      );
    });

    it("output stays re-parseable as exactly one wikilink", () => {
      withTitle("- [ ] 장보기");
      const out = resolveZettelLinksForExport("보라: [[202607051530]] 끝");
      const re = new RegExp(WIKILINK_RE.source, "g");
      expect([...out.matchAll(re)]).toHaveLength(1);
    });

    it("still rewrites a title with [ but no ] — that one round-trips", () => {
      withTitle("[draft 회의록");
      expect(resolveZettelLinksForExport("보라: [[202607051530]] 끝")).toBe(
        "보라: [[202607051530|[draft 회의록]] 끝",
      );
    });
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

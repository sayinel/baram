import { describe, expect, it } from "vitest";

import {
  buildFleetingNote,
  buildPermanentNote,
  parseFrontmatterAliases,
  parseFrontmatterTags,
  sanitizeZettelTitle,
} from "../zettel-note";

describe("sanitizeZettelTitle", () => {
  it("strips filesystem-reserved chars and collapses whitespace", () => {
    expect(sanitizeZettelTitle('a/b:c*?"<>|#  d')).toBe("abc d");
  });
  it("falls back to Untitled when empty", () => {
    expect(sanitizeZettelTitle("  ///  ")).toBe("Untitled");
  });
});

describe("buildPermanentNote", () => {
  it("builds {id title}.md with frontmatter + H1", () => {
    const { filename, content } = buildPermanentNote({
      id: "202607051530",
      title: "원자적 노트",
      created: "2026-07-05T15:30",
    });
    expect(filename).toBe("202607051530 원자적 노트.md");
    expect(content).toContain("id: 202607051530");
    expect(content).toContain("title: 원자적 노트");
    expect(content).toContain("created: 2026-07-05T15:30");
    expect(content).toContain("# 원자적 노트");
    expect(content.startsWith("---\n")).toBe(true);
  });
  it("sanitizes the title in the filename but keeps it raw in frontmatter/H1", () => {
    const { filename, content } = buildPermanentNote({
      id: "202607051530",
      title: "TCP/IP 정리",
      created: "2026-07-05T15:30",
    });
    expect(filename).toBe("202607051530 TCPIP 정리.md");
    expect(content).toContain("title: TCP/IP 정리");
    expect(content).toContain("# TCP/IP 정리");
  });
});

describe("buildFleetingNote", () => {
  it("builds {id}.md with minimal frontmatter + body", () => {
    const { filename, content } = buildFleetingNote({
      id: "202607051530",
      body: "quick thought",
      created: "2026-07-05T15:30",
    });
    expect(filename).toBe("202607051530.md");
    expect(content).toContain("id: 202607051530");
    expect(content).toContain("quick thought");
    expect(content).not.toContain("title:");
    // §99 A: fleeting notes never carry a capture `type:` field
    expect(content).not.toContain("type:");
    // no tags given → empty array
    expect(content).toContain("tags: []");
  });

  it("§99 A: writes given tags into the frontmatter array (not the body)", () => {
    const { content } = buildFleetingNote({
      id: "202607051530",
      body: "tagged thought",
      created: "2026-07-05T15:30",
      tags: ["idea", "zettel/inbox"],
    });
    expect(content).toContain("tags: [idea, zettel/inbox]");
    expect(content).not.toContain("#idea");
  });
});

describe("parseFrontmatterTags", () => {
  it("parses an inline tags array", () => {
    expect(parseFrontmatterTags("---\ntags: [a, b/c]\n---\n\nx")).toEqual([
      "a",
      "b/c",
    ]);
  });

  it("parses a block-list tags field", () => {
    expect(
      parseFrontmatterTags("---\ntags:\n  - one\n  - two\n---\n\nx"),
    ).toEqual(["one", "two"]);
  });

  it("returns [] when there is no frontmatter or no tags field", () => {
    expect(parseFrontmatterTags("no frontmatter")).toEqual([]);
    expect(parseFrontmatterTags("---\nid: 1\n---\n")).toEqual([]);
  });

  // ‼️ 반대 방향 핀: `aliases:`를 읽지 않는 것. 공용 코어를 쓰므로 필드 이름 파라미터가
  // 없어지면 이 테스트만 잡는다.
  it("does not read the aliases field", () => {
    const md = `---\ntags: []\naliases: [Note, 영감노트]\n---\n`;
    expect(parseFrontmatterTags(md)).toEqual([]);
  });
});

describe("parseFrontmatterAliases", () => {
  it("reads the inline array form", () => {
    const md = `---\ntitle: Baram Dev Note\naliases: [Baram-Dev-Note, BDN]\n---\n\n# x\n`;
    expect(parseFrontmatterAliases(md)).toEqual(["Baram-Dev-Note", "BDN"]);
  });

  it("reads the block-list form", () => {
    const md = `---\ntitle: x\naliases:\n  - one\n  - two\n---\n`;
    expect(parseFrontmatterAliases(md)).toEqual(["one", "two"]);
  });

  it("returns [] for an empty array, no field, and no frontmatter", () => {
    expect(parseFrontmatterAliases(`---\naliases: []\n---\n`)).toEqual([]);
    expect(parseFrontmatterAliases(`---\ntitle: x\n---\n`)).toEqual([]);
    expect(parseFrontmatterAliases(`# just a body\n`)).toEqual([]);
  });

  // ‼️ `tags:`를 읽지 않는 것. 두 필드가 같은 코어를 쓰므로 필드 이름을 넘기는 것을
  // 잊으면 이 테스트만 잡는다.
  it("does not read the tags field", () => {
    const md = `---\ntags: [Note, 영감노트]\naliases: []\n---\n`;
    expect(parseFrontmatterAliases(md)).toEqual([]);
  });
});

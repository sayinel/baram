import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  buildFleetingNote,
  buildPermanentNote,
  carriedTagList,
  parseFrontmatterAliases,
  sanitizeZettelTitle,
} from "../zettel-note";

/** The YAML a note's front matter holds. */
function frontmatter(md: string): unknown {
  return parse(/^---\n([\s\S]*?)\n---/.exec(md)![1]);
}

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

  // What turns this red: joining the tags with `, ` — `tags: [#solo, idea]` is a YAML parse
  // error (the `#` opens a comment), so the note's whole front matter is lost to every reader.
  it("writes a tag YAML cannot hold plain quoted (§56m)", () => {
    const { content } = buildFleetingNote({
      id: "202607051530",
      body: "x",
      created: "2026-07-05T15:30",
      tags: ["#solo", "idea"],
    });
    expect(content).toContain(`tags: ["#solo", idea]`);
    expect(frontmatter(content)).toMatchObject({ tags: ["#solo", "idea"] });
  });
});

describe("carriedTagList", () => {
  it("reads an inline tags array", () => {
    expect(carriedTagList("---\ntags: [a, b/c]\n---\n\nx")).toBe("[a, b/c]");
  });

  it("reads a block-list tags field", () => {
    expect(carriedTagList("---\ntags:\n  - one\n  - two\n---\n\nx")).toBe(
      "[one, two]",
    );
  });

  it("is [] when there is no frontmatter or no tags field", () => {
    expect(carriedTagList("no frontmatter")).toBe("[]");
    expect(carriedTagList("---\nid: 1\n---\n")).toBe("[]");
  });

  // ‼️ 반대 방향 핀: `aliases:`를 읽지 않는 것. 공용 코어를 쓰므로 필드 이름 파라미터가
  // 없어지면 이 테스트만 잡는다.
  it("does not read the aliases field", () => {
    const md = `---\ntags: []\naliases: [Note, 영감노트]\n---\n`;
    expect(carriedTagList(md)).toBe("[]");
  });

  // §56m What turns these red: carrying the values instead of the items — `"#solo"` lost its
  // quotes and `tags: [#solo]` stopped parsing.
  it("keeps each item as written", () => {
    expect(carriedTagList(`---\ntags: ["#solo", 'sq', plain]\n---\n`)).toBe(
      `["#solo", 'sq', plain]`,
    );
  });

  it("carries a block list's quoted items into a list YAML reads", () => {
    const list = carriedTagList(`---\ntags:\n  - "#solo"\n  - idea\n---\n`);
    expect(list).toBe(`["#solo", idea]`);
    expect(parse(`tags: ${list}`)).toEqual({ tags: ["#solo", "idea"] });
  });

  it("quotes an item whose spelling YAML cannot read", () => {
    expect(carriedTagList("---\ntags: [#unq]\n---\n")).toBe(`["#unq"]`);
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

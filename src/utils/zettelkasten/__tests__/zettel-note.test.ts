import { describe, expect, it } from "vitest";

import {
  buildFleetingNote,
  buildPermanentNote,
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
    expect(content).not.toContain("type:");
  });

  it("writes the capture type to frontmatter when given (§99 M4)", () => {
    const { content } = buildFleetingNote({
      id: "202607051530",
      body: "an idea",
      created: "2026-07-05T15:30",
      type: "idea",
    });
    expect(content).toContain("type: idea");
  });

  it("omits type: frontmatter when no type is given", () => {
    const { content } = buildFleetingNote({
      id: "202607051530",
      body: "an idea",
      created: "2026-07-05T15:30",
    });
    expect(content).not.toContain("type:");
  });
});

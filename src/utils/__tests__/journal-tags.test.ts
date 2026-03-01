import { describe, it, expect } from "vitest";
import { extractTagsFromContent, buildTagIndex, filterTags } from "../journal-tags";

describe("extractTagsFromContent", () => {
  it("extracts inline #tags from body text", () => {
    const content = "Hello #world and #coding today";
    expect(extractTagsFromContent(content)).toEqual(["coding", "world"]);
  });

  it("extracts tags from frontmatter inline array", () => {
    const content = `---
tags: [일기, 코딩, travel]
---

No inline tags here.`;
    expect(extractTagsFromContent(content)).toEqual(["travel", "일기", "코딩"]);
  });

  it("extracts tags from frontmatter block list", () => {
    const content = `---
tags:
  - kotlin
  - rust
  - typescript
---

Body text.`;
    expect(extractTagsFromContent(content)).toEqual(["kotlin", "rust", "typescript"]);
  });

  it("skips #tags inside fenced code blocks", () => {
    const content = `Normal #visible tag\n\`\`\`\n#hidden inside code\n\`\`\``;
    expect(extractTagsFromContent(content)).toEqual(["visible"]);
  });

  it("skips #tags inside inline code", () => {
    const content = "Use \`#notATag\` in code but #realTag outside";
    expect(extractTagsFromContent(content)).toEqual(["realtag"]);
  });

  it("returns unique sorted tags", () => {
    const content = "#alpha #beta #alpha #gamma #beta";
    expect(extractTagsFromContent(content)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("supports Korean tags", () => {
    const content = "오늘 #일기 쓰기 #코딩 공부";
    expect(extractTagsFromContent(content)).toEqual(["일기", "코딩"]);
  });

  it("returns empty array for content with no tags", () => {
    const content = "Just plain text with no tags.";
    expect(extractTagsFromContent(content)).toEqual([]);
  });

  it("extracts nested tags with / separator", () => {
    const content = "Working on #project/baram and #status/done today";
    expect(extractTagsFromContent(content)).toEqual(["project/baram", "status/done"]);
  });

  it("extracts deeply nested tags", () => {
    const content = "#work/project/baram/v2 is progressing";
    expect(extractTagsFromContent(content)).toEqual(["work/project/baram/v2"]);
  });

  it("extracts Korean nested tags", () => {
    const content = "#프로젝트/바람 에디터 개발 중";
    expect(extractTagsFromContent(content)).toEqual(["프로젝트/바람"]);
  });

  it("combines frontmatter and inline tags deduped", () => {
    const content = `---
tags: [shared, frontonly]
---

#shared #inlineonly`;
    expect(extractTagsFromContent(content)).toEqual(["frontonly", "inlineonly", "shared"]);
  });
});

describe("buildTagIndex", () => {
  it("counts tags across multiple files", () => {
    const files = [
      { path: "a.md", content: "#rust #coding" },
      { path: "b.md", content: "#rust #design" },
      { path: "c.md", content: "#rust" },
    ];
    const index = buildTagIndex(files);
    expect(index.get("rust")).toBe(3);
    expect(index.get("coding")).toBe(1);
    expect(index.get("design")).toBe(1);
  });

  it("returns empty map for empty file list", () => {
    expect(buildTagIndex([])).toEqual(new Map());
  });

  it("handles files with no tags", () => {
    const files = [
      { path: "a.md", content: "plain text" },
      { path: "b.md", content: "#only" },
    ];
    const index = buildTagIndex(files);
    expect(index.size).toBe(1);
    expect(index.get("only")).toBe(1);
  });
});

describe("filterTags", () => {
  const index = new Map<string, number>([
    ["rust", 10],
    ["react", 8],
    ["readme", 3],
    ["design", 5],
    ["daily", 7],
    ["coding", 2],
  ]);

  it("filters by prefix and sorts by frequency", () => {
    const result = filterTags("r", index);
    expect(result[0]).toBe("rust");
    expect(result[1]).toBe("react");
    expect(result[2]).toBe("readme");
  });

  it("strips leading # from query", () => {
    const result = filterTags("#d", index);
    expect(result).toContain("daily");
    expect(result).toContain("design");
  });

  it("returns top 10 by frequency when query is empty", () => {
    const bigIndex = new Map<string, number>();
    for (let i = 0; i < 15; i++) bigIndex.set(`tag${i}`, i);
    const result = filterTags("", bigIndex);
    expect(result).toHaveLength(10);
    expect(result[0]).toBe("tag14");
  });

  it("returns empty array when no tags match", () => {
    expect(filterTags("xyz", index)).toEqual([]);
  });

  it("is case-insensitive", () => {
    const result = filterTags("RUST", index);
    expect(result).toContain("rust");
  });

  it("matches nested tag prefix", () => {
    const nestedIndex = new Map<string, number>([
      ["project/baram", 5],
      ["project/other", 3],
      ["status/done", 2],
      ["coding", 8],
    ]);
    const result = filterTags("project", nestedIndex);
    expect(result).toEqual(["project/baram", "project/other"]);
  });

  it("matches nested tag segment prefix", () => {
    const nestedIndex = new Map<string, number>([
      ["project/baram", 5],
      ["project/other", 3],
      ["baram", 10],
    ]);
    // "baram" matches both the top-level tag (prefix) and nested segment
    const result = filterTags("baram", nestedIndex);
    expect(result[0]).toBe("baram"); // prefix match first
    expect(result).toContain("project/baram"); // segment match
  });

  it("matches nested tag with / in query", () => {
    const nestedIndex = new Map<string, number>([
      ["project/baram", 5],
      ["project/other", 3],
      ["status/done", 2],
    ]);
    const result = filterTags("project/b", nestedIndex);
    expect(result).toEqual(["project/baram"]);
  });
});

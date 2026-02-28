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
});

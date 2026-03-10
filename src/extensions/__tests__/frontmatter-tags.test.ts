// §56m Frontmatter tag parsing tests
import { describe, expect, it } from "vitest";

import {
  parseFrontmatterTags,
  updateFrontmatterTags,
} from "../nodes/frontmatter-view";

describe("parseFrontmatterTags", () => {
  it("parses inline array format", () => {
    const yaml = "title: Test\ntags: [rust, react, coding]\ndate: 2026-03-01";
    expect(parseFrontmatterTags(yaml)).toEqual(["rust", "react", "coding"]);
  });

  it("parses inline array with quotes", () => {
    const yaml = "tags: [\"hello world\", 'coding', rust]";
    expect(parseFrontmatterTags(yaml)).toEqual([
      "hello world",
      "coding",
      "rust",
    ]);
  });

  it("parses block list format", () => {
    const yaml =
      "title: Test\ntags:\n  - kotlin\n  - rust\n  - typescript\ndate: 2026-03-01";
    expect(parseFrontmatterTags(yaml)).toEqual([
      "kotlin",
      "rust",
      "typescript",
    ]);
  });

  it("returns empty array when no tags field", () => {
    const yaml = "title: Test\ndate: 2026-03-01";
    expect(parseFrontmatterTags(yaml)).toEqual([]);
  });

  it("returns empty array for empty inline array", () => {
    const yaml = "tags: []";
    expect(parseFrontmatterTags(yaml)).toEqual([]);
  });

  it("handles Korean tags", () => {
    const yaml = "tags: [일기, 코딩, travel]";
    expect(parseFrontmatterTags(yaml)).toEqual(["일기", "코딩", "travel"]);
  });

  it("handles nested tags in inline array", () => {
    const yaml = "tags: [project/baram, status/done]";
    expect(parseFrontmatterTags(yaml)).toEqual([
      "project/baram",
      "status/done",
    ]);
  });

  it("handles nested tags in block list", () => {
    const yaml = "tags:\n  - project/baram\n  - status/done";
    expect(parseFrontmatterTags(yaml)).toEqual([
      "project/baram",
      "status/done",
    ]);
  });
});

describe("updateFrontmatterTags", () => {
  it("updates inline array format", () => {
    const yaml = "title: Test\ntags: [rust, react]\ndate: 2026-03-01";
    const result = updateFrontmatterTags(yaml, ["rust", "react", "go"]);
    expect(result).toBe(
      "title: Test\ntags: [rust, react, go]\ndate: 2026-03-01",
    );
  });

  it("updates block list format", () => {
    const yaml = "title: Test\ntags:\n  - rust\n  - react\ndate: 2026-03-01";
    const result = updateFrontmatterTags(yaml, ["rust", "react", "go"]);
    expect(result).toBe(
      "title: Test\ntags:\n  - rust\n  - react\n  - go\ndate: 2026-03-01",
    );
  });

  it("adds tags field when none exists", () => {
    const yaml = "title: Test\ndate: 2026-03-01";
    const result = updateFrontmatterTags(yaml, ["rust", "coding"]);
    expect(result).toBe("title: Test\ntags: [rust, coding]\ndate: 2026-03-01");
  });

  it("clears inline array to empty", () => {
    const yaml = "title: Test\ntags: [rust, react]\ndate: 2026-03-01";
    const result = updateFrontmatterTags(yaml, []);
    expect(result).toBe("title: Test\ntags: []\ndate: 2026-03-01");
  });

  it("preserves other YAML fields", () => {
    const yaml = "title: My Note\nauthor: John\ntags: [old]\ncategory: dev";
    const result = updateFrontmatterTags(yaml, ["new1", "new2"]);
    expect(result).toContain("title: My Note");
    expect(result).toContain("author: John");
    expect(result).toContain("category: dev");
    expect(result).toContain("tags: [new1, new2]");
  });
});

// §31 wikilink autocomplete — search/filter logic tests
import { describe, it, expect } from "vitest";
import {
  filterFiles,
  fileNameWithoutExtension,
  type WikilinkSuggestionItem,
} from "../plugins/wikilink-suggest-utils";

const testFiles: WikilinkSuggestionItem[] = [
  { id: "1", target: "architecture", label: "architecture.md", path: "/vault/architecture.md" },
  { id: "2", target: "architecture-decisions", label: "architecture-decisions.md", path: "/vault/architecture-decisions.md" },
  { id: "3", target: "roadmap", label: "roadmap.md", path: "/vault/roadmap.md" },
  { id: "4", target: "meeting-notes", label: "meeting-notes.md", path: "/vault/notes/meeting-notes.md" },
  { id: "5", target: "api-design", label: "api-design.md", path: "/vault/docs/api-design.md" },
  { id: "6", target: "getting-started", label: "getting-started.md", path: "/vault/docs/getting-started.md" },
];

describe("filterFiles", () => {
  it("returns all files for empty query", () => {
    const result = filterFiles(testFiles, "");
    expect(result).toHaveLength(testFiles.length);
  });

  it("filters by exact prefix match", () => {
    const result = filterFiles(testFiles, "arch");
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].target).toBe("architecture");
  });

  it("fuzzy matches across word boundaries", () => {
    const result = filterFiles(testFiles, "mn");
    const targets = result.map((r) => r.target);
    expect(targets).toContain("meeting-notes");
  });

  it("ranks exact prefix higher than fuzzy", () => {
    const result = filterFiles(testFiles, "road");
    expect(result[0].target).toBe("roadmap");
  });

  it("returns empty for no match", () => {
    const result = filterFiles(testFiles, "zzzzxyz");
    expect(result).toHaveLength(0);
  });

  it("is case insensitive", () => {
    const result = filterFiles(testFiles, "API");
    const targets = result.map((r) => r.target);
    expect(targets).toContain("api-design");
  });

  it("limits results", () => {
    const result = filterFiles(testFiles, "", 3);
    expect(result).toHaveLength(3);
  });
});

describe("fileNameWithoutExtension", () => {
  it("removes .md extension", () => {
    expect(fileNameWithoutExtension("architecture.md")).toBe("architecture");
  });

  it("removes .markdown extension", () => {
    expect(fileNameWithoutExtension("notes.markdown")).toBe("notes");
  });

  it("returns name as-is if no known extension", () => {
    expect(fileNameWithoutExtension("readme")).toBe("readme");
  });

  it("handles names with dots", () => {
    expect(fileNameWithoutExtension("v1.0-notes.md")).toBe("v1.0-notes");
  });
});

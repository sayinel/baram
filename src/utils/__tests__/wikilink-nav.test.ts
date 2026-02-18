// §28 Wikilink navigation — resolveWikilinkTarget tests
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveWikilinkTarget } from "../wikilink-nav";

// Mock file store
vi.mock("../../stores/file-store", () => ({
  useFileStore: {
    getState: vi.fn(),
  },
}));

import { useFileStore } from "../../stores/file-store";

const mockFileTree = [
  {
    name: "architecture.md",
    path: "/vault/architecture.md",
    isDir: false,
  },
  {
    name: "notes",
    path: "/vault/notes",
    isDir: true,
    children: [
      {
        name: "meeting-notes.md",
        path: "/vault/notes/meeting-notes.md",
        isDir: false,
      },
      {
        name: "ideas.markdown",
        path: "/vault/notes/ideas.markdown",
        isDir: false,
      },
    ],
  },
  {
    name: "readme.txt",
    path: "/vault/readme.txt",
    isDir: false,
  },
];

beforeEach(() => {
  vi.mocked(useFileStore.getState).mockReturnValue({
    rootPath: "/vault",
    fileTree: mockFileTree,
  } as ReturnType<typeof useFileStore.getState>);
});

describe("resolveWikilinkTarget", () => {
  it("resolves exact match (case-insensitive)", () => {
    const result = resolveWikilinkTarget("Architecture");
    expect(result).toEqual({
      path: "/vault/architecture.md",
      name: "architecture.md",
    });
  });

  it("resolves lowercase match", () => {
    const result = resolveWikilinkTarget("architecture");
    expect(result).toEqual({
      path: "/vault/architecture.md",
      name: "architecture.md",
    });
  });

  it("resolves nested file", () => {
    const result = resolveWikilinkTarget("meeting-notes");
    expect(result).toEqual({
      path: "/vault/notes/meeting-notes.md",
      name: "meeting-notes.md",
    });
  });

  it("resolves .markdown extension files", () => {
    const result = resolveWikilinkTarget("ideas");
    expect(result).toEqual({
      path: "/vault/notes/ideas.markdown",
      name: "ideas.markdown",
    });
  });

  it("returns null for non-existent target", () => {
    const result = resolveWikilinkTarget("nonexistent");
    expect(result).toBeNull();
  });

  it("skips non-markdown files", () => {
    const result = resolveWikilinkTarget("readme");
    expect(result).toBeNull();
  });

  it("returns null when no rootPath", () => {
    vi.mocked(useFileStore.getState).mockReturnValue({
      rootPath: null,
      fileTree: [],
    } as unknown as ReturnType<typeof useFileStore.getState>);
    const result = resolveWikilinkTarget("architecture");
    expect(result).toBeNull();
  });
});

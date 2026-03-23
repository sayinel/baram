// §28 Wikilink navigation — resolveWikilinkTarget tests
// §61 Namespace — relative path resolution tests
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveRelativeTarget,
  resolveWikilinkTarget,
} from "../editor/wikilink-nav";

// Mock context store (must be before file store mock since file.ts imports it)
vi.mock("../../stores/context/context", () => ({
  useContextStore: {
    getState: vi.fn(() => ({
      activeContext: () => null,
    })),
    subscribe: vi.fn(),
  },
}));

// Mock file store
vi.mock("../../stores/file/file", async () => {
  const { useContextStore } = await import("../../stores/context/context");
  return {
    useFileStore: {
      getState: vi.fn(),
    },
    isActiveContextJournal: vi.fn(() => {
      const ctx = useContextStore.getState().activeContext();
      return ctx?.vaultType === "journal";
    }),
  };
});

// Mock editor store
vi.mock("../../stores/editor/editor", () => ({
  useEditorStore: {
    getState: vi.fn(),
  },
}));

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";

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
      {
        name: "ai",
        path: "/vault/notes/ai",
        isDir: true,
        children: [
          {
            name: "prompt.md",
            path: "/vault/notes/ai/prompt.md",
            isDir: false,
          },
          {
            name: "models.md",
            path: "/vault/notes/ai/models.md",
            isDir: false,
          },
        ],
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
  vi.mocked(useEditorStore.getState).mockReturnValue({
    activeTabId: "tab-1",
    tabs: [
      {
        id: "tab-1",
        filePath: "/vault/notes/ai/prompt.md",
        title: "prompt.md",
        isDirty: false,
        isPinned: false,
      },
    ],
  } as unknown as ReturnType<typeof useEditorStore.getState>);
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

describe("§61 resolveRelativeTarget", () => {
  it("resolves ./sibling from same directory", () => {
    const result = resolveRelativeTarget(
      "./models",
      "/vault/notes/ai/prompt.md",
    );
    expect(result).toBe("/vault/notes/ai/models.md");
  });

  it("resolves ../sibling from parent directory", () => {
    const result = resolveRelativeTarget(
      "../meeting-notes",
      "/vault/notes/ai/prompt.md",
    );
    expect(result).toBe("/vault/notes/meeting-notes.md");
  });

  it("resolves ../ai/models with nested relative path", () => {
    // From /vault/notes/meeting-notes.md: ../ goes to /vault, then ai/models
    const result = resolveRelativeTarget(
      "../ai/models",
      "/vault/notes/meeting-notes.md",
    );
    expect(result).toBe("/vault/ai/models.md");
  });

  it("resolves ./sub/file with subdirectory", () => {
    const result = resolveRelativeTarget(
      "./ai/prompt",
      "/vault/notes/meeting-notes.md",
    );
    expect(result).toBe("/vault/notes/ai/prompt.md");
  });

  it("handles multiple ../ levels", () => {
    const result = resolveRelativeTarget(
      "../../architecture",
      "/vault/notes/ai/prompt.md",
    );
    expect(result).toBe("/vault/architecture.md");
  });
});

describe("§61 resolveWikilinkTarget with relative paths", () => {
  it("resolves [[./models]] to same-directory file", () => {
    const result = resolveWikilinkTarget("./models");
    expect(result).toEqual({
      path: "/vault/notes/ai/models.md",
      name: "models.md",
    });
  });

  it("resolves [[../meeting-notes]] to parent-directory file", () => {
    const result = resolveWikilinkTarget("../meeting-notes");
    expect(result).toEqual({
      path: "/vault/notes/meeting-notes.md",
      name: "meeting-notes.md",
    });
  });

  it("returns null for non-existent relative target", () => {
    const result = resolveWikilinkTarget("./nonexistent");
    expect(result).toBeNull();
  });

  it("returns null for relative target when no active tab", () => {
    vi.mocked(useEditorStore.getState).mockReturnValue({
      activeTabId: null,
      tabs: [],
    } as unknown as ReturnType<typeof useEditorStore.getState>);
    const result = resolveWikilinkTarget("./models");
    expect(result).toBeNull();
  });

  it("does not fall back to global search for relative targets", () => {
    // "architecture" exists globally, but "./architecture" should not resolve
    // from /vault/notes/ai/ since there's no architecture.md in that directory
    const result = resolveWikilinkTarget("./architecture");
    expect(result).toBeNull();
  });

  it("global [[target]] still works unchanged", () => {
    const result = resolveWikilinkTarget("architecture");
    expect(result).toEqual({
      path: "/vault/architecture.md",
      name: "architecture.md",
    });
  });
});

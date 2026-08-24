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
  {
    // §278 fixture: the real collision. companionPathFor() maps
    // "papers/attention.pdf" onto "highlights/papers/attention.md" (below), so
    // the PDF and its companion note share a bare stem BY CONSTRUCTION — our
    // own naming rule creates the ambiguity this feature has to resolve.
    name: "papers",
    path: "/vault/papers",
    isDir: true,
    children: [
      {
        name: "attention.pdf",
        path: "/vault/papers/attention.pdf",
        isDir: false,
      },
      {
        // Upper-case extension — a case-sensitive filesystem (Linux) will not
        // open a lower-cased path, and companionPathFor's strip is /\.pdf$/i.
        name: "Survey.PDF",
        path: "/vault/papers/Survey.PDF",
        isDir: false,
      },
      {
        // §69 gives images, SVG and HTML their own viewers. Nothing about this
        // file is enumerated anywhere in the resolver — that is the point.
        name: "figure-1.png",
        path: "/vault/papers/figure-1.png",
        isDir: false,
      },
    ],
  },
  {
    // §275.4 fixture: two files sharing the bare stem "attention" in
    // different folders — the exact ambiguity path-qualified targets exist
    // to resolve (mirrors the design doc's own example, part15 §275.4).
    name: "highlights",
    path: "/vault/highlights",
    isDir: true,
    children: [
      {
        name: "papers",
        path: "/vault/highlights/papers",
        isDir: true,
        children: [
          {
            name: "attention.md",
            path: "/vault/highlights/papers/attention.md",
            isDir: false,
          },
        ],
      },
      {
        name: "notes",
        path: "/vault/highlights/notes",
        isDir: true,
        children: [
          {
            name: "attention.md",
            path: "/vault/highlights/notes/attention.md",
            isDir: false,
          },
        ],
      },
    ],
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

describe("§275.4 resolveWikilinkTarget with path-qualified targets", () => {
  it("resolves [[highlights/papers/attention]] to that exact file, not the first stem match anywhere in the tree", () => {
    const result = resolveWikilinkTarget("highlights/papers/attention");
    expect(result).toEqual({
      path: "/vault/highlights/papers/attention.md",
      name: "attention.md",
    });
  });

  it("resolves the sibling with the same stem in a different folder distinctly", () => {
    const result = resolveWikilinkTarget("highlights/notes/attention");
    expect(result).toEqual({
      path: "/vault/highlights/notes/attention.md",
      name: "attention.md",
    });
  });

  it("is case-insensitive on the path-qualified form", () => {
    const result = resolveWikilinkTarget("Highlights/Papers/Attention");
    expect(result).toEqual({
      path: "/vault/highlights/papers/attention.md",
      name: "attention.md",
    });
  });

  it("returns null for a path-qualified target that doesn't exist", () => {
    const result = resolveWikilinkTarget("highlights/papers/nonexistent");
    expect(result).toBeNull();
  });

  it("bare [[attention]] still falls back to stem-only matching (first match wins, unchanged)", () => {
    // No path segment in the target — the new branch must not run at all,
    // so this keeps its pre-existing (ambiguous) stem-only behavior.
    const result = resolveWikilinkTarget("attention");
    expect(result).toEqual({
      path: "/vault/highlights/papers/attention.md",
      name: "attention.md",
    });
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

describe("§278 file targets — [[Paper.pdf]] and friends", () => {
  it("확장자를 적으면 그 파일로 간다", () => {
    const r = resolveWikilinkTarget("attention.pdf");
    expect(r?.path).toBe("/vault/papers/attention.pdf");
  });

  it("‼️ bare 타깃의 의미는 바뀌지 않는다", () => {
    // 이것이 이 기능의 안전 성질이다. [[attention]]은 예전처럼 마크다운 노트로
    // 간다 — 동반 노트를 후보에서 빼면 이미 그 링크를 쓰던 문서가 조용히 끊긴다.
    // 발견 함수를 더 엄격하게 만드는 방향은 위험하다. 모호함은 자동완성이
    // 둘 다 보여주는 것으로 푼다.
    const r = resolveWikilinkTarget("attention");
    expect(r?.path.endsWith(".md")).toBe(true);
  });

  it("확장자 대소문자를 가리지 않는다", () => {
    // 실제 파일은 "Survey.PDF"다. 대소문자 구분 파일시스템에서 소문자 경로로는
    // 열리지 않으므로, 돌려주는 것은 **트리에 있는 실제 경로**여야 한다.
    const r = resolveWikilinkTarget("survey.pdf");
    expect(r?.path).toBe("/vault/papers/Survey.PDF");
  });

  it("확장자 allowlist가 없다 — 뷰어가 생기면 그냥 따라온다", () => {
    // png는 리졸버 어디에도 열거돼 있지 않다.
    expect(resolveWikilinkTarget("figure-1.png")?.path).toBe(
      "/vault/papers/figure-1.png",
    );
    // 기존 픽스처의 .txt도 마찬가지 — 이 규칙은 특정 타입을 위한 것이 아니다.
    expect(resolveWikilinkTarget("readme.txt")?.path).toBe("/vault/readme.txt");
  });

  it("경로를 적은 타깃도 맞는다", () => {
    expect(resolveWikilinkTarget("papers/attention.pdf")?.path).toBe(
      "/vault/papers/attention.pdf",
    );
  });

  it("없는 파일은 여전히 null", () => {
    expect(resolveWikilinkTarget("nope.pdf")).toBeNull();
  });

  it("md 해석이 먼저다 — 정확 일치는 그것이 실패한 뒤에만 시도된다", () => {
    // 순서가 안전장치다. 이름이 "architecture.md"인 파일을 [[architecture.md]]로
    // 가리키면 stem 규칙이 아니라 정확 일치가 잡지만, 어느 쪽이든 같은 파일이다.
    // 중요한 것은 md 후보가 있을 때 그것이 이긴다는 것.
    expect(resolveWikilinkTarget("architecture")?.path).toBe(
      "/vault/architecture.md",
    );
    expect(resolveWikilinkTarget("architecture.md")?.path).toBe(
      "/vault/architecture.md",
    );
  });
});

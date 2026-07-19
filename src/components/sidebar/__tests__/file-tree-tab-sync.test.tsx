// §4.5 Regression guard: the "sync selectedPaths with active tab" effect in
// FileTree.tsx must react ONLY to activeFilePath (tab switch), not to
// searchQuery/tagFilter. Before the fix, searchQuery/tagFilter were in the
// effect's deps array, so it re-ran on every filter keystroke and called
// selectSingle(activeFilePath) unconditionally — collapsing a multi-file
// selection down to just the active file. See FileTree.tsx `searchQueryRef`.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// FileTree.tsx (and its hooks) pull in a few Tauri plugin bindings that are
// only invoked from click/menu handlers we never trigger below; stub them so
// importing the real component doesn't require a live Tauri runtime.
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { FileTree } from "../FileTree";

describe("FileTree tab-sync vs. filter keystrokes (§4.5)", () => {
  beforeEach(() => {
    useFileStore.setState({
      rootPath: "/r",
      fileTree: [
        { name: "a.md", path: "/r/a.md", isDir: false },
        { name: "b.md", path: "/r/b.md", isDir: false },
      ],
      expandedDirs: new Set<string>(),
      tagFilter: null,
      loadError: null,
    });
    useEditorStore.setState({
      tabs: [
        {
          id: "t1",
          filePath: "/r/a.md",
          title: "a.md",
          isDirty: false,
          isPinned: false,
          contextId: "",
        },
        {
          id: "t2",
          filePath: "/r/b.md",
          title: "b.md",
          isDirty: false,
          isPinned: false,
          contextId: "",
        },
      ],
      activeTabId: "t1",
    });
  });

  it("타이핑으로 인한 필터 변경은 기존 멀티 셀렉션을 단일 선택으로 무너뜨리지 않는다", () => {
    render(<FileTree />);

    // Mount ran the tab-sync effect for the initial active tab (t1 -> a.md),
    // establishing a single-file selection on a.md.
    const rowA = screen.getByText("a.md").closest('[role="treeitem"]')!;
    const rowB = screen.getByText("b.md").closest('[role="treeitem"]')!;
    expect(rowA.getAttribute("aria-selected")).toBe("true");
    expect(rowB.getAttribute("aria-selected")).toBe("false");

    // Ctrl/Cmd-click b.md to build a multi-selection {a.md, b.md}.
    fireEvent.click(rowB, { ctrlKey: true });
    expect(
      screen
        .getByText("a.md")
        .closest('[role="treeitem"]')!
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByText("b.md")
        .closest('[role="treeitem"]')!
        .getAttribute("aria-selected"),
    ).toBe("true");

    // Type into the filter box. Query "m" fuzzy-subsequence-matches both
    // "a.md" and "b.md", so both remain visible in the search-results list.
    const searchInput = screen.getByPlaceholderText("Filter files…");
    fireEvent.change(searchInput, { target: { value: "m" } });

    // Regression: pre-fix, the tab-sync effect re-ran on this keystroke
    // (searchQuery was in its deps) and called selectSingle(activeFilePath),
    // collapsing the selection to {a.md} only — b.md would lose its active
    // class here. Post-fix, both remain selected.
    // (selector scopes the match to the name span — the result row also
    // renders a nested `.file-tree-result-path` span with the same text.)
    const resultA = screen
      .getByText("a.md", { selector: ".file-tree-name" })
      .closest(".file-tree-item")!;
    const resultB = screen
      .getByText("b.md", { selector: ".file-tree-name" })
      .closest(".file-tree-item")!;
    expect(resultA.classList.contains("file-tree-item-active")).toBe(true);
    expect(resultB.classList.contains("file-tree-item-active")).toBe(true);
  });
});

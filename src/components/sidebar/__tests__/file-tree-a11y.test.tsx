import type { FileEntry } from "../../../stores/file/file";
import type { FileTreeContextValue } from "../FileTreeContext";

import { act, fireEvent, render, screen } from "@testing-library/react";
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
import { FileTreeProvider } from "../FileTreeContext";
import { FileTreeNode } from "../FileTreeNode";

const ctx: FileTreeContextValue = {
  creatingEntry: null,
  dragOverPath: null,
  dragSourcePaths: [],
  expandedDirs: new Set<string>(["/r/docs"]),
  focusedPath: "/r/docs",
  renamingPath: null,
  selectedPaths: new Set<string>(["/r/docs"]),
};

const noop = (): void => {};

function renderNode(
  entry: FileEntry,
  ctxOverride: Partial<FileTreeContextValue> = {},
): void {
  render(
    <FileTreeProvider value={{ ...ctx, ...ctxOverride }}>
      <FileTreeNode
        depth={0}
        entry={entry}
        onCancelCreate={noop}
        onCancelRename={noop}
        onConfirmCreate={noop}
        onConfirmRename={noop}
        onContextMenu={noop}
        onDirClick={noop}
        onFileClick={noop}
        onStartRename={noop}
      />
    </FileTreeProvider>,
  );
}

describe("FileTreeNode accessibility", () => {
  it("폴더 행은 role=treeitem + aria-expanded를 가진다", () => {
    const dir: FileEntry = {
      name: "docs",
      path: "/r/docs",
      isDir: true,
      children: [],
    };
    renderNode(dir);
    const item = screen.getByText("docs").closest('[role="treeitem"]')!;
    expect(item).not.toBeNull();
    expect(item.getAttribute("aria-expanded")).toBe("true");
  });

  it("선택된 행은 aria-selected=true", () => {
    const file: FileEntry = { name: "a.md", path: "/r/docs", isDir: false };
    renderNode(file, { selectedPaths: new Set(["/r/docs"]) });
    const item = screen.getByText("a.md").closest('[role="treeitem"]')!;
    expect(item.getAttribute("aria-selected")).toBe("true");
  });

  it("focused 행은 tabindex=0, 나머지는 -1 (roving)", () => {
    const file: FileEntry = { name: "a.md", path: "/r/docs", isDir: false };
    renderNode(file, { focusedPath: "/r/docs" });
    const item = screen.getByText("a.md").closest('[role="treeitem"]')!;
    expect(item.getAttribute("tabindex")).toBe("0");
  });

  it("focus 안 된 행은 tabindex=-1", () => {
    const file: FileEntry = { name: "a.md", path: "/r/other.md", isDir: false };
    renderNode(file, { focusedPath: "/r/docs" });
    const item = screen.getByText("a.md").closest('[role="treeitem"]')!;
    expect(item.getAttribute("tabindex")).toBe("-1");
  });
});

// Regression guard: tab-sync (active tab change from a wikilink click, Quick
// Switcher, journal, git file-open, app-restore, ...) must only update the
// roving-tabindex `focusedPath` STATE, never steal real DOM focus into the
// sidebar. Only actual keyboard navigation (ArrowDown/Up/Left/Right) may move
// DOM focus. See FileTree.tsx `shouldStealFocusRef`.
describe("FileTree focus-steal on tab-sync vs. keyboard nav (§4.4)", () => {
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

  it("tab-sync으로 인한 focusedPath 변경은 DOM 포커스를 훔치지 않는다", () => {
    render(<FileTree />);

    // Mount itself already ran the tab-sync effect for the initial active
    // tab (t1 -> /r/a.md) -- that must not have stolen focus either.
    const rowA = screen.getByText("a.md").closest('[role="treeitem"]')!;
    expect(document.activeElement).not.toBe(rowA);

    // Simulate switching the active tab from somewhere OTHER than the tree
    // (wikilink click, Quick Switcher, journal, git file-open, ...).
    act(() => {
      useEditorStore.setState({ activeTabId: "t2" });
    });

    const rowB = screen.getByText("b.md").closest('[role="treeitem"]')!;
    expect(document.activeElement).not.toBe(rowB);
    expect(document.activeElement).not.toBe(rowA);
  });

  it("ArrowDown 키보드 내비게이션은 새로 focus된 행에 실제 DOM 포커스를 준다", () => {
    render(<FileTree />);
    const tree = screen.getByRole("tree", { name: "File tree" });

    fireEvent.keyDown(tree, { key: "ArrowDown" });

    const rowB = screen.getByText("b.md").closest('[role="treeitem"]')!;
    expect(document.activeElement).toBe(rowB);
  });
});

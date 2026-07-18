import type { FileEntry } from "../../../stores/file/file";
import type { FileTreeContextValue } from "../FileTreeContext";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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

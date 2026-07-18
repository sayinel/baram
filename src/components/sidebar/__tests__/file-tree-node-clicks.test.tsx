import type { FileEntry } from "../../../stores/file/file";
import type { FileTreeContextValue } from "../FileTreeContext";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileTreeProvider } from "../FileTreeContext";
import { FileTreeNode } from "../FileTreeNode";

const ctx: FileTreeContextValue = {
  creatingEntry: null,
  dragOverPath: null,
  dragSourcePaths: [],
  expandedDirs: new Set<string>(),
  focusedPath: null,
  renamingPath: null,
  selectedPaths: new Set<string>(),
};

const noop = (): void => {};

function renderNode(
  entry: FileEntry,
  handlers: {
    onDirClick?: (entry: FileEntry, e: React.MouseEvent) => void;
    onFileClick?: (entry: FileEntry, e: React.MouseEvent) => void;
  },
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
        onDirClick={handlers.onDirClick ?? noop}
        onFileClick={handlers.onFileClick ?? noop}
        onStartRename={noop}
      />
    </FileTreeProvider>,
  );
}

describe("FileTreeNode click wiring", () => {
  it("파일 클릭은 entry와 modifier가 담긴 이벤트를 전달한다", () => {
    const onFileClick = vi.fn();
    const entry: FileEntry = { name: "a.md", path: "/r/a.md", isDir: false };
    renderNode(entry, { onFileClick });
    fireEvent.click(screen.getByText("a.md"), { metaKey: true });
    expect(onFileClick).toHaveBeenCalledTimes(1);
    expect(onFileClick.mock.calls[0][0]).toEqual(entry);
    expect(onFileClick.mock.calls[0][1].metaKey).toBe(true);
  });

  it("폴더 클릭은 onDirClick으로 entry와 이벤트를 전달한다", () => {
    const onDirClick = vi.fn();
    const entry: FileEntry = {
      name: "docs",
      path: "/r/docs",
      isDir: true,
      children: [],
    };
    renderNode(entry, { onDirClick });
    fireEvent.click(screen.getByText("docs"), { shiftKey: true });
    expect(onDirClick).toHaveBeenCalledTimes(1);
    expect(onDirClick.mock.calls[0][1].shiftKey).toBe(true);
  });

  it("selectedPaths에 있는 파일 행은 active 클래스를 가진다", () => {
    const file: FileEntry = { name: "a.md", path: "/r/a.md", isDir: false };
    renderNode(file, {}, { selectedPaths: new Set(["/r/a.md"]) });
    expect(
      screen.getByText("a.md").closest(".file-tree-item")!.className,
    ).toContain("file-tree-item-active");
  });

  it("selectedPaths에 있는 폴더 행도 active 클래스를 가진다", () => {
    const dir: FileEntry = {
      name: "docs",
      path: "/r/docs",
      isDir: true,
      children: [],
    };
    renderNode(dir, {}, { selectedPaths: new Set(["/r/docs"]) });
    expect(
      screen.getByText("docs").closest(".file-tree-item")!.className,
    ).toContain("file-tree-item-active");
  });
});

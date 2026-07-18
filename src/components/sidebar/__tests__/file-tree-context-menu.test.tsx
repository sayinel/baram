import type { ContextMenuState } from "../file-tree-types";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileTreeContextMenu } from "../file-tree-context-menu";

const base: ContextMenuState = {
  x: 10,
  y: 20,
  targetPath: null,
  targetIsDir: false,
  selectionCount: 1,
  selectionHasDir: false,
};

describe("FileTreeContextMenu (baseline actions)", () => {
  it("빈 영역(targetPath=null)은 New File/New Folder만 보여준다", () => {
    render(<FileTreeContextMenu menu={base} onAction={vi.fn()} />);
    expect(screen.getByText("New File")).toBeInTheDocument();
    expect(screen.getByText("New Folder")).toBeInTheDocument();
    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("파일 대상은 Rename/Delete를 보여주고 New File/New Folder는 숨긴다", () => {
    render(
      <FileTreeContextMenu
        menu={{ ...base, targetPath: "/r/a.md", targetIsDir: false }}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.queryByText("New File")).not.toBeInTheDocument();
  });

  it("폴더 대상은 New File/New Folder + Rename/Delete를 모두 보여준다", () => {
    render(
      <FileTreeContextMenu
        menu={{ ...base, targetPath: "/r/docs", targetIsDir: true }}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("New File")).toBeInTheDocument();
    expect(screen.getByText("Rename")).toBeInTheDocument();
  });

  it("항목 클릭이 onAction으로 액션 문자열을 전달한다", () => {
    const onAction = vi.fn();
    render(
      <FileTreeContextMenu
        menu={{ ...base, targetPath: "/r/a.md", targetIsDir: false }}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onAction).toHaveBeenCalledWith("delete");
  });

  it("메뉴가 x/y 좌표에 위치한다", () => {
    const { container } = render(
      <FileTreeContextMenu
        menu={{ ...base, x: 42, y: 99 }}
        onAction={vi.fn()}
      />,
    );
    const el = container.querySelector<HTMLElement>(".file-tree-context-menu")!;
    expect(el.style.left).toBe("42px");
    expect(el.style.top).toBe("99px");
  });
});

describe("FileTreeContextMenu (multi-selection)", () => {
  it("selectionCount>1이면 축소 세트(Duplicate/Move/Delete/Copy Path)만 보여주고 Rename은 숨긴다", () => {
    render(
      <FileTreeContextMenu
        menu={{
          x: 0,
          y: 0,
          targetPath: "/r/a.md",
          targetIsDir: false,
          selectionCount: 3,
          selectionHasDir: false,
        }}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("Move to…")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("Copy Path")).toBeInTheDocument();
    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    expect(screen.queryByText("Open in New Tab")).not.toBeInTheDocument();
  });

  it("selectionCount>1이고 폴더 포함이면 Duplicate를 비활성(disabled)으로 표시한다", () => {
    render(
      <FileTreeContextMenu
        menu={{
          x: 0,
          y: 0,
          targetPath: "/r/docs",
          targetIsDir: true,
          selectionCount: 2,
          selectionHasDir: true,
        }}
        onAction={vi.fn()}
      />,
    );
    const dup = screen.getByText("Duplicate");
    expect(dup.className).toContain("file-tree-context-menu-item-disabled");
  });

  it("selectionHasDir일 때 Duplicate 클릭은 onAction을 호출하지 않는다", () => {
    const onAction = vi.fn();
    render(
      <FileTreeContextMenu
        menu={{
          x: 0,
          y: 0,
          targetPath: "/r/docs",
          targetIsDir: true,
          selectionCount: 2,
          selectionHasDir: true,
        }}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByText("Duplicate"));
    expect(onAction).not.toHaveBeenCalledWith("duplicate");
  });
});

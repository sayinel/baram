import type { ContextMenuState } from "../file-tree-types";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// §312 창 밖으로 잘리던 컨텍스트 메뉴 — 태스크 정리 메뉴와 **같은 결함**이고 같은
// 산술(`utils/menu-placement.ts`)을 탄다. 규칙을 두 벌 적어 두면 한쪽만 고쳐진다.
//
// 이 메뉴의 앵커는 행이 아니라 커서 점이므로 위/아래가 같은 값이다 — 뒤집으면 메뉴의
// 아래끝이 커서에 온다(네이티브 컨텍스트 메뉴와 같은 동작). 좌표 산술 자체는
// `utils/__tests__/menu-placement.test.ts`가 시험하고, 여기서는 **연결**만 본다.
// jsdom에는 레이아웃이 없어 rect가 전부 0이므로 메뉴 크기를 스텁으로 지어낸다.
describe("FileTreeContextMenu (viewport clamping, §312)", () => {
  const MENU_HEIGHT = 150;
  const MENU_WIDTH = 180;
  const realRect = Element.prototype.getBoundingClientRect;

  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect;
  });

  beforeEach(() => {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains("file-tree-context-menu")) {
        return {
          bottom: 0,
          height: MENU_HEIGHT,
          left: 0,
          right: 0,
          toJSON: () => ({}),
          top: 0,
          width: MENU_WIDTH,
          x: 0,
          y: 0,
        } as DOMRect;
      }
      return realRect.call(this);
    };
  });

  function menuElement(menu: ContextMenuState): HTMLElement {
    const { container } = render(
      <FileTreeContextMenu menu={menu} onAction={vi.fn()} />,
    );
    return container.querySelector<HTMLElement>(".file-tree-context-menu")!;
  }

  it("창 아래쪽에서 눌리면 커서 위로 뒤집힌다", () => {
    // 740 + 150 = 890 > 768(jsdom 기본 창 높이).
    const el = menuElement({ ...base, targetPath: "/r/a.md", x: 10, y: 740 });
    expect(el.style.top).toBe(`${740 - MENU_HEIGHT}px`);
  });

  it("오른쪽 끝에서 눌리면 왼쪽으로 민다", () => {
    const el = menuElement({ ...base, targetPath: "/r/a.md", x: 1000, y: 10 });
    expect(el.style.left).toBe(`${window.innerWidth - 4 - MENU_WIDTH}px`);
  });

  it("다중 선택 메뉴도 같은 배치를 받는다 — 분기가 둘이라 한쪽만 고쳐지기 쉽다", () => {
    const el = menuElement({
      ...base,
      selectionCount: 3,
      targetPath: "/r/a.md",
      x: 10,
      y: 740,
    });
    expect(screen.getByText("Move to…")).toBeInTheDocument();
    expect(el.style.top).toBe(`${740 - MENU_HEIGHT}px`);
  });
});

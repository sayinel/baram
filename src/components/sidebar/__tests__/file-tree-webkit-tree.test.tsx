// §4.4 — WebKit only treats `role="tree"` as a tree when every element child of it passes its validity walk;
// one bad child demotes the tree to a generic element and every row is then read as an unnamed "group"
// (what VoiceOver said on a row: "M, 및 2개의 항목, group").
//
// `isValidTree` below is a transcription of `AccessibilityNodeObject::isValidTree()` in
// Source/WebCore/accessibility/AccessibilityNodeObject.cpp, WebKit main as of 2026-11-01: it walks the tree
// element's children breadth-first; an element child with role `treeitem` is accepted and not descended;
// one with role `group` or `presentation` is accepted and its children are queued; any other element child
// makes the tree invalid. Role matching follows `hasRole` / `hasAnyRole` in
// Source/WebCore/accessibility/AXUtilities.cpp (same date): the `role` attribute is lowercased and matched
// as any one of its space-separated tokens.
//
// Testing Library computes accessible names with dom-accessibility-api on jsdom. jsdom does not load the
// app's CSS, so it joins a row's parts without the spaces WebKit adds (`shouldPrependSpace` for blockified
// flex children). WebKit's own naming of the rows is checked by VoiceOver, not here.
import type { FileEntry } from "../../../stores/file/file";
import type { FileTreeContextValue } from "../FileTreeContext";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FileTree.tsx pulls in Tauri plugin bindings that only click/menu handlers call; stub them (same as
// file-tree-a11y.test.tsx).
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

import {
  __resetFileDecorations,
  applyDecorations,
} from "../../../plugins/file-decorations/file-decoration-store";
import { useFileStore } from "../../../stores/file/file";
import { EMPTY_GIT_BADGE_INDEX } from "../../../stores/system/git-badges";
import { FileTree } from "../FileTree";
import { FileTreeContext } from "../FileTreeContext";
import { FileTreeNode } from "../FileTreeNode";

function isValidTree(tree: Element): boolean {
  const queue: Element[] = [tree];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const child of Array.from(parent.children)) {
      const roles = (child.getAttribute("role") ?? "")
        .toLowerCase()
        .split(/\s+/);
      if (roles.includes("treeitem")) continue;
      if (roles.some((r) => r === "group" || r === "presentation")) {
        queue.push(child);
        continue;
      }
      return false;
    }
  }
  return true;
}

const noop = (): void => {};

const FILE: FileEntry = { isDir: false, name: "top.md", path: "/r/top.md" };
const DIR: FileEntry = {
  children: [
    { isDir: false, name: "a.md", path: "/r/docs/a.md" },
    {
      children: [{ isDir: false, name: "b.md", path: "/r/docs/sub/b.md" }],
      isDir: true,
      name: "sub",
      path: "/r/docs/sub",
    },
  ],
  isDir: true,
  name: "docs",
  path: "/r/docs",
};

function html(markup: string): Element {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host.firstElementChild!;
}

function mount(
  entries: FileEntry[],
  override: Partial<FileTreeContextValue> = {},
): HTMLElement {
  render(
    <FileTreeContext
      value={{
        creatingEntry: null,
        dragOverPath: null,
        dragSourcePaths: [],
        expandedDirs: new Set(["/r/docs", "/r/docs/sub"]),
        focusedPath: null,
        gitBadges: EMPTY_GIT_BADGE_INDEX,
        renamingPath: null,
        selectedPaths: new Set(),
        ...override,
      }}
    >
      <div aria-label="File tree" role="tree">
        {entries.map((entry) => (
          <FileTreeNode
            depth={0}
            entry={entry}
            key={entry.path}
            onCancelCreate={noop}
            onCancelRename={noop}
            onConfirmCreate={noop}
            onConfirmRename={noop}
            onContextMenu={noop}
            onDirClick={noop}
            onFileClick={noop}
            onStartRename={noop}
          />
        ))}
      </div>
    </FileTreeContext>,
  );
  return screen.getByRole("tree");
}

afterEach(() => {
  cleanup();
  __resetFileDecorations();
});

describe("isValidTree helper (positive control)", () => {
  it("accepts treeitems, and treeitems under a presentation or group wrapper", () => {
    expect(
      isValidTree(
        html(
          `<div role="tree"><div role="treeitem"></div><div role="presentation"><div role="treeitem"></div><div role="group"><div role="treeitem"></div></div></div></div>`,
        ),
      ),
    ).toBe(true);
  });

  it("does not descend into a treeitem, and rejects a role-less child under a group", () => {
    expect(
      isValidTree(
        html(`<div role="tree"><div role="treeitem"><div></div></div></div>`),
      ),
    ).toBe(true);
    expect(
      isValidTree(
        html(`<div role="tree"><div role="group"><div></div></div></div>`),
      ),
    ).toBe(false);
  });

  it("rejects a tree with one role-less child, even deep under a wrapper", () => {
    expect(
      isValidTree(
        html(`<div role="tree"><div role="treeitem"></div><div></div></div>`),
      ),
    ).toBe(false);
    expect(
      isValidTree(
        html(
          `<div role="tree"><div role="presentation"><div role="treeitem"></div><div></div></div></div>`,
        ),
      ),
    ).toBe(false);
  });
});

describe("FileTreeNode output under a synthetic role=tree is a valid tree to WebKit", () => {
  it("a root file", () => {
    expect(isValidTree(mount([FILE]))).toBe(true);
  });

  it("an expanded folder holding a file and a nested folder", () => {
    const tree = mount([DIR, FILE]);
    expect(screen.getAllByRole("treeitem")).toHaveLength(5);
    expect(isValidTree(tree)).toBe(true);
  });

  it("a create row open inside a folder", () => {
    const tree = mount([DIR], {
      creatingEntry: { isDir: false, parentPath: "/r/docs" },
    });
    expect(tree.querySelector(".file-tree-rename-input")).not.toBeNull();
    expect(isValidTree(tree)).toBe(true);
  });
});

describe("decorative icons are hidden from assistive technology", () => {
  it("file icon, folder icon and chevron", () => {
    const tree = mount([DIR]);
    const icons = Array.from(tree.querySelectorAll(".file-tree-icon"));
    // docs (chevron + icon), a.md (icon), sub (chevron + icon), b.md (icon) = 6
    expect(icons).toHaveLength(6);
    for (const icon of icons)
      expect(icon.getAttribute("aria-hidden")).toBe("true");
  });

  it("the create row's icon", () => {
    const tree = mount([DIR], {
      creatingEntry: { isDir: true, parentPath: "/r/docs" },
    });
    const input = tree.querySelector(".file-tree-rename-input")!;
    const icon = input.parentElement!.querySelector(".file-tree-icon")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("a row's accessible name (ARIA algorithm in jsdom, not WebKit's)", () => {
  it("holds the file name and the badge label, and not the icon letter M", () => {
    applyDecorations("p", "Tree Badges", [
      {
        decoration: { badge: "1", tooltip: "1 open task" },
        where: { absolute: "/r/top.md" },
      },
    ]);
    mount([FILE]);
    expect(
      screen.getByRole("treeitem", {
        name: /^top\.md\s*Tree Badges: 1 open task$/,
      }),
    ).not.toBeNull();
  });
});

describe("the app's own <FileTree /> role=tree element is a valid tree to WebKit", () => {
  function setTree(fileTree: FileEntry[]): void {
    useFileStore.setState({
      expandedDirs: new Set(["/r/docs", "/r/docs/sub"]),
      fileTree,
      loadError: null,
      rootPath: "/r",
      tagFilter: null,
    });
  }

  beforeEach(() => {
    setTree([]);
  });

  it("with an expanded folder and a root file (the folder wrapper fails without role=presentation)", () => {
    setTree([DIR, FILE]);
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    expect(within(tree).getAllByRole("treeitem")).toHaveLength(5);
    expect(isValidTree(tree)).toBe(true);
  });

  it("with an empty vault", () => {
    render(<FileTree />);
    expect(isValidTree(screen.getByRole("tree"))).toBe(true);
  });

  it("with the root create row open: it sits outside the tree", () => {
    setTree([DIR]);
    render(<FileTree />);
    fireEvent.click(screen.getByTitle("New File"));
    const input = screen.getByPlaceholderText("file name");
    const tree = screen.getByRole("tree");
    expect(tree.contains(input)).toBe(false);
    expect(isValidTree(tree)).toBe(true);
    expect(
      input
        .parentElement!.querySelector(".file-tree-icon")!
        .getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("search-result rows hide their icon letter", () => {
    setTree([FILE]);
    render(<FileTree />);
    fireEvent.change(screen.getByPlaceholderText("Filter files…"), {
      target: { value: "top" },
    });
    // The tree is replaced by the result list while a query is set, so the only row is the result.
    expect(screen.queryByRole("tree")).toBeNull();
    const icon = document.querySelector(".file-tree-item .file-tree-icon")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  });
});

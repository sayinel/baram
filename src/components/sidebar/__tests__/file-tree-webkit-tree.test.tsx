// §4.4 — WebKit only treats `role="tree"` as a tree when every element child of it passes its validity walk;
// one bad child demotes the tree to a generic element and every row is then read as an unnamed "group"
// (what VoiceOver said on a row: "M, 및 2개의 항목, group").
//
// `isValidTree` below is a transcription of `AccessibilityNodeObject::isValidTree()` in
// Source/WebCore/accessibility/AccessibilityNodeObject.cpp, WebKit main as of 2026-11-01: it walks the tree
// element's children breadth-first; an element child with role `treeitem` is accepted and not descended;
// one with role `group` or `presentation` is accepted and its children are queued; any other element child
// makes the tree invalid. It reads the explicit `role` attribute only — the one implicit role it would
// matter for (a `<div>` has none) is the failing case in the corpus below.
//
// jsdom implements the ARIA accessible-name algorithm (dom-accessibility-api), not WebKit's; WebKit's own
// naming of the rows is checked by VoiceOver, not here.
import type { FileEntry } from "../../../stores/file/file";
import type { FileTreeContextValue } from "../FileTreeContext";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  __resetFileDecorations,
  applyDecorations,
} from "../../../plugins/file-decorations/file-decoration-store";
import { EMPTY_GIT_BADGE_INDEX } from "../../../stores/system/git-badges";
import { FileTreeContext } from "../FileTreeContext";
import { FileTreeNode } from "../FileTreeNode";

function isValidTree(tree: Element): boolean {
  const queue: Element[] = [tree];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const child of Array.from(parent.children)) {
      const role = child.getAttribute("role");
      if (role === "treeitem") continue;
      if (role === "group" || role === "presentation") {
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

describe("the rendered file tree is a valid tree to WebKit", () => {
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
    const row = screen.getByRole("treeitem", { name: /top\.md/ });
    const name = row.textContent;
    expect(name).toContain("top.md");
    expect(
      screen.getByRole("treeitem", {
        name: /^top\.md\s*Tree Badges: 1 open task$/,
      }),
    ).toBe(row);
    expect(screen.queryByRole("treeitem", { name: /^M\b/ })).toBeNull();
  });
});

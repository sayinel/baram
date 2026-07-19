import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EMPTY_GIT_BADGE_INDEX } from "../../../stores/system/git-badges";
import { FileTreeProvider } from "../FileTreeContext";
import { FileTreeNode } from "../FileTreeNode";

const noop = () => {};
const baseCtx = {
  creatingEntry: null,
  dragOverPath: null,
  dragSourcePaths: [],
  expandedDirs: new Set<string>(),
  focusedPath: null,
  renamingPath: null,
  selectedPaths: new Set<string>(),
  gitBadges: EMPTY_GIT_BADGE_INDEX,
};

const handlers = {
  onDirClick: noop,
  onFileClick: noop,
  onContextMenu: noop,
  onStartRename: noop,
  onConfirmRename: noop,
  onCancelRename: noop,
  onConfirmCreate: noop,
  onCancelCreate: noop,
};

function renderNode(ctx: typeof baseCtx, path = "/r/a.md") {
  return render(
    <FileTreeProvider value={ctx}>
      <FileTreeNode
        depth={0}
        entry={{ name: "a.md", path, isDir: false }}
        {...handlers}
      />
    </FileTreeProvider>,
  );
}

describe("FileTreeNode git badge", () => {
  it("renders no badge when the path has no git change", () => {
    const { container } = renderNode(baseCtx);
    expect(container.querySelector(".file-tree-git-badge")).toBeNull();
  });

  it("renders a modified badge for a modified file", () => {
    const files = new Map([["/r/a.md", "modified" as const]]);
    const { container } = renderNode({
      ...baseCtx,
      gitBadges: { files, dirs: new Set() },
    });
    const dot = container.querySelector(".file-tree-git-badge");
    expect(dot).not.toBeNull();
    expect(dot!.classList.contains("file-tree-git-badge-modified")).toBe(true);
  });

  it("renders an added badge for an untracked/added file", () => {
    const files = new Map([["/r/a.md", "added" as const]]);
    const { container } = renderNode({
      ...baseCtx,
      gitBadges: { files, dirs: new Set() },
    });
    expect(
      container
        .querySelector(".file-tree-git-badge")
        ?.classList.contains("file-tree-git-badge-added"),
    ).toBe(true);
  });
});

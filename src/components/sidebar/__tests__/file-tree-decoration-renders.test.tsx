// §395 spec 0074 D9 · §7 "다시 그리기 횟수" — a decoration change re-renders the one leaf that shows it.
// Counted, never timed: leaf renders by path (a wrapper around `FileTreeRowBody`) and row renders (calls of
// `useFileTreeContext`, which only `FileTreeNode` makes — `git grep -n useFileTreeContext -- src` at
// ab5028ff: `FileTreeContext.tsx` (definition) and `FileTreeNode.tsx`).
//
// The defect the folder row catches (probe, plan 0127 Task 5 Step 4): move the store subscription from
// the leaf into `FileTreeNode`, and a folder's decoration re-renders the folder row and its 30 mounted
// children — rows 31 instead of 0.
import type { FileEntry } from "../../../stores/file/file";

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const counts = vi.hoisted(() => ({ leaves: [] as string[], rows: 0 }));

vi.mock("../file-tree-row-body", async (importOriginal) => {
  const real = await importOriginal<typeof import("../file-tree-row-body")>();
  return {
    ...real,
    FileTreeRowBody: (props: Parameters<typeof real.FileTreeRowBody>[0]) => {
      counts.leaves.push(props.entry.path);
      return real.FileTreeRowBody(props);
    },
  };
});
vi.mock("../FileTreeContext", async (importOriginal) => {
  const real = await importOriginal<typeof import("../FileTreeContext")>();
  return {
    ...real,
    useFileTreeContext: () => {
      counts.rows += 1;
      return real.useFileTreeContext();
    },
  };
});

import {
  __resetFileDecorations,
  applyDecorations,
  useFileDecorationStore,
} from "../../../plugins/file-decorations/file-decoration-store";
import { EMPTY_GIT_BADGE_INDEX } from "../../../stores/system/git-badges";
import { FileTreeContext } from "../FileTreeContext";
import { FileTreeNode } from "../FileTreeNode";

const noop = () => {};
const CHILDREN: FileEntry[] = Array.from({ length: 30 }, (_, i) => ({
  isDir: false,
  name: `f${i}.md`,
  path: `/v/dir/f${i}.md`,
}));
const TREE: FileEntry[] = [
  { children: CHILDREN, isDir: true, name: "dir", path: "/v/dir" },
  {
    children: [{ isDir: false, name: "x.md", path: "/v/closed/x.md" }],
    isDir: true,
    name: "closed",
    path: "/v/closed",
  },
  { isDir: false, name: "top.md", path: "/v/top.md" },
];

function decorate(path: string, badge: string): void {
  act(() => {
    applyDecorations("p", "P", [
      { decoration: { badge }, where: { absolute: path } },
    ]);
  });
}

function mountTree(): void {
  render(
    <FileTreeContext
      value={{
        creatingEntry: null,
        dragOverPath: null,
        dragSourcePaths: [],
        expandedDirs: new Set(["/v/dir"]),
        focusedPath: null,
        gitBadges: EMPTY_GIT_BADGE_INDEX,
        renamingPath: null,
        selectedPaths: new Set(),
      }}
    >
      {TREE.map((entry) => (
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
    </FileTreeContext>,
  );
  // 33 rows mounted: dir, its 30 children, closed (collapsed — x.md is not mounted), top.md.
  expect(counts.rows).toBe(33);
  counts.leaves.length = 0;
  counts.rows = 0;
}

beforeEach(() => {
  counts.leaves.length = 0;
  counts.rows = 0;
});
afterEach(() => {
  __resetFileDecorations();
});

describe("re-renders after a decoration change (D9)", () => {
  it("re-renders the one file leaf, and no other leaf or row", () => {
    mountTree();
    decorate("/v/dir/f3.md", "1");
    expect(counts.leaves).toEqual(["/v/dir/f3.md"]);
    expect(counts.rows).toBe(0);
  });

  /** The probe in this file's header turns `rows` into 31 here. */
  it("re-renders a folder's leaf alone, not its 30 mounted children", () => {
    mountTree();
    decorate("/v/dir", "F");
    expect(counts.leaves).toEqual(["/v/dir"]);
    expect(counts.rows).toBe(0);
  });

  /** The pair of the first row: a path with no mounted row re-renders nothing. */
  it("re-renders nothing for a path inside a collapsed folder", () => {
    mountTree();
    decorate("/v/closed/x.md", "1");
    expect(counts.leaves).toEqual([]);
    expect(counts.rows).toBe(0);
  });

  /** §7 — the same decoration again: no store notification and no render; a different one: one each. */
  it("re-renders nothing when the same decoration comes again", () => {
    mountTree();
    decorate("/v/top.md", "1");
    counts.leaves.length = 0;
    const listener = vi.fn();
    const stop = useFileDecorationStore.subscribe(listener);
    decorate("/v/top.md", "1");
    expect(listener).toHaveBeenCalledTimes(0);
    expect(counts.leaves).toEqual([]);
    decorate("/v/top.md", "2");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(counts.leaves).toEqual(["/v/top.md"]);
    stop();
  });
});

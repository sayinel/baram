import { beforeEach, describe, expect, it } from "vitest";

import { useFileStore } from "../file/file";

beforeEach(() => {
  useFileStore.setState({
    rootPath: null, // skip vault-config persistence in unit test
    fileTree: [],
    expandedDirs: new Set(),
    fileTreeSortOrder: "name-asc",
  });
});

describe("file store — sort order", () => {
  it("collapseAllDirs clears expandedDirs", () => {
    useFileStore.setState({ expandedDirs: new Set(["/r/a", "/r/b"]) });
    useFileStore.getState().collapseAllDirs();
    expect(useFileStore.getState().expandedDirs.size).toBe(0);
  });

  it("expandAllDirs collects every directory path at every depth, excluding files", () => {
    useFileStore.setState({
      fileTree: [
        {
          isDir: true,
          name: "a",
          path: "/r/a",
          children: [
            {
              isDir: true,
              name: "b",
              path: "/r/a/b",
              children: [],
            },
            {
              isDir: false,
              name: "nested.md",
              path: "/r/a/nested.md",
            },
          ],
        },
        {
          isDir: false,
          name: "top.md",
          path: "/r/top.md",
        },
      ],
      expandedDirs: new Set(),
    });
    useFileStore.getState().expandAllDirs();
    const { expandedDirs } = useFileStore.getState();
    expect(expandedDirs.has("/r/a")).toBe(true);
    expect(expandedDirs.has("/r/a/b")).toBe(true);
    expect(expandedDirs.size).toBe(2);
    expect(expandedDirs.has("/r/a/nested.md")).toBe(false);
    expect(expandedDirs.has("/r/top.md")).toBe(false);
  });

  it("setFileTreeSortOrder resorts the existing tree (dirs stay first)", () => {
    // seed a tree ordered name-asc
    useFileStore.setState({
      fileTree: [
        { isDir: true, name: "a-dir", path: "/r/a-dir", modifiedAt: 20 },
        { isDir: true, name: "b-dir", path: "/r/b-dir", modifiedAt: 10 },
        { isDir: false, name: "new.md", path: "/r/new.md", modifiedAt: 99 },
        { isDir: false, name: "old.md", path: "/r/old.md", modifiedAt: 1 },
      ],
    });
    useFileStore.getState().setFileTreeSortOrder("mtime-desc");
    const names = useFileStore.getState().fileTree.map((n) => n.name);
    // dirs first (newest dir first: a-dir mtime=20 > b-dir mtime=10),
    // then files newest first (new.md mtime=99 > old.md mtime=1)
    expect(names).toEqual(["a-dir", "b-dir", "new.md", "old.md"]);
    expect(useFileStore.getState().fileTreeSortOrder).toBe("mtime-desc");
  });
});
